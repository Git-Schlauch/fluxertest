/*
 * Copyright (C) 2026 Fluxer Contributors
 *
 * This file is part of Fluxer.
 *
 * Fluxer is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Fluxer is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Fluxer. If not, see <https://www.gnu.org/licenses/>.
 */

import {spawn, spawnSync, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createGuildID, type ChannelID, type GuildID, type UserID} from '@fluxer/api/src/BrandedTypes';
import type {ChannelRepository} from '@fluxer/api/src/channel/ChannelRepository';
import {toHttpUrl} from '@fluxer/api/src/infrastructure/LiveKitService';
import {Logger} from '@fluxer/api/src/Logger';
import type {IGatewayService} from '@fluxer/api/src/infrastructure/IGatewayService';
import type {ILiveKitService} from '@fluxer/api/src/infrastructure/ILiveKitService';
import type {IVoiceRoomStore} from '@fluxer/api/src/infrastructure/IVoiceRoomStore';
import {ChannelTypes, Permissions} from '@fluxer/constants/src/ChannelConstants';
import {FeatureTemporarilyDisabledError} from '@fluxer/errors/src/domains/core/FeatureTemporarilyDisabledError';
import {InputValidationError} from '@fluxer/errors/src/domains/core/InputValidationError';
import {MissingPermissionsError} from '@fluxer/errors/src/domains/core/MissingPermissionsError';
import {UnknownChannelError} from '@fluxer/errors/src/domains/channel/UnknownChannelError';
import {UserNotInVoiceError} from '@fluxer/errors/src/domains/user/UserNotInVoiceError';
import type {IKVProvider} from '@fluxer/kv_client/src/IKVProvider';

type PlaylistEntry = {
	name: string;
	url: string;
	logo?: string;
	group?: string;
};

type IptvPlaylistConfigSource = 'inline' | 'url';

type IptvPlaylistConfig = {
	guildId: GuildID;
	source: IptvPlaylistConfigSource;
	playlist: string | null;
	playlistChunkCount: number | null;
	playlistUrl: string | null;
	updatedAt: string;
	updatedBy: string;
};

type ActiveIptvSession = {
	channelId: ChannelID;
	guildId: GuildID;
	sourceUrl: string;
	streamName: string;
	startedAt: string;
	ingressId: string;
	ingressClient: unknown;
	ffmpegProcess: ChildProcessWithoutNullStreams;
	ffmpegTarget: string;
};

type IngressProtocol = 'rtmp' | 'whip';
let cachedWhipMuxerSupport: boolean | null = null;
// KV backends often enforce ~4KB value limits. Base64 expands payload by ~33%,
// so keep raw chunks below this threshold to avoid storage write failures.
const INLINE_PLAYLIST_CHUNK_BYTES = 2_800;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseBooleanFlag(value: string | undefined): boolean | null {
	if (!value) return null;
	const normalized = value.trim().toLowerCase();
	if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
	if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
	return null;
}

function isWhipEnabledForFfmpeg(): boolean {
	const explicit = parseBooleanFlag(process.env.FLUXER_IPTV_ENABLE_WHIP);
	if (explicit !== null) {
		return explicit;
	}

	if (cachedWhipMuxerSupport !== null) {
		return cachedWhipMuxerSupport;
	}

	const ffmpegPath = process.env.FLUXER_IPTV_FFMPEG_PATH ?? 'ffmpeg';
	const result = spawnSync(ffmpegPath, ['-hide_banner', '-muxers'], {encoding: 'utf8'});
	const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
	cachedWhipMuxerSupport = /\bwhip\b/i.test(output);

	if (!cachedWhipMuxerSupport) {
		Logger.warn({ffmpegPath}, '[iptv] ffmpeg has no WHIP muxer; falling back to RTMP ingress');
	}

	return cachedWhipMuxerSupport;
}

async function ensureFfmpegDidNotExitImmediately(
	ffmpegProcess: ChildProcessWithoutNullStreams,
	timeoutMs = 5_000,
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			ffmpegProcess.off('exit', onExit);
			resolve();
		}, timeoutMs);

		const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(
				InputValidationError.create(
					'source_url',
					`IPTV source could not be published (ffmpeg exited early: code=${code ?? 'null'}, signal=${signal ?? 'null'}).`,
				),
			);
		};

		ffmpegProcess.once('exit', onExit);
	});
}

function parsePlaylist(playlist: string): Array<PlaylistEntry> {
	const lines = playlist
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const entries: Array<PlaylistEntry> = [];
	let pending: {name: string; logo?: string; group?: string} | null = null;

	for (const line of lines) {
		if (line.startsWith('#EXTINF:')) {
			const namePart = line.split(',').slice(1).join(',').trim();
			const tvgLogoMatch = /tvg-logo="([^"]+)"/i.exec(line);
			const groupMatch = /group-title="([^"]+)"/i.exec(line);
			pending = {
				name: namePart || 'IPTV Channel',
				logo: tvgLogoMatch?.[1],
				group: groupMatch?.[1],
			};
			continue;
		}

		if (line.startsWith('#')) {
			continue;
		}

		if (!/^https?:\/\//i.test(line)) {
			continue;
		}

		const fallbackName = line.split('/').filter(Boolean).pop() ?? 'IPTV Channel';
		entries.push({
			name: pending?.name ?? fallbackName,
			url: line,
			logo: pending?.logo,
			group: pending?.group,
		});
		pending = null;
	}

	return entries;
}

function scorePlaylistMatch(entry: PlaylistEntry, searchQuery: string): number {
	const query = searchQuery.toLowerCase().trim();
	const name = entry.name.toLowerCase();
	const group = (entry.group ?? '').toLowerCase();
	if (name === query) return 100;
	if (name.startsWith(query)) return 90;
	if (name.includes(query)) return 80;
	if (group === query) return 70;
	if (group.includes(query)) return 60;
	return 0;
}

function resolvePlaylistEntry(entries: Array<PlaylistEntry>, channelName: string): PlaylistEntry | null {
	let bestEntry: PlaylistEntry | null = null;
	let bestScore = -1;
	for (const entry of entries) {
		const score = scorePlaylistMatch(entry, channelName);
		if (score > bestScore) {
			bestScore = score;
			bestEntry = entry;
		}
	}

	if (!bestEntry || bestScore <= 0) {
		return null;
	}

	return bestEntry;
}

function splitUtf8TextByBytes(input: string, chunkByteSize: number): Array<string> {
	if (input.length === 0) {
		return [];
	}

	const parts: Array<string> = [];
	let start = 0;
	while (start < input.length) {
		let low = start + 1;
		let high = input.length;
		let best = start + 1;

		while (low <= high) {
			const mid = Math.floor((low + high) / 2);
			const candidate = input.slice(start, mid);
			const byteLength = new TextEncoder().encode(candidate).length;
			if (byteLength <= chunkByteSize) {
				best = mid;
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}

		parts.push(input.slice(start, best));
		start = best;
	}

	return parts;
}

function buildRoomName(guildId: GuildID, channelId: ChannelID): string {
	return `guild_${guildId}_channel_${channelId}`;
}

function buildParticipantIdentity(channelId: ChannelID): string {
	return `iptv_${channelId}`;
}

function buildFfmpegTarget(ingressUrl: string, streamKey: string | null): string {
	if (!streamKey || ingressUrl.includes(streamKey)) {
		return ingressUrl;
	}
	return `${ingressUrl.replace(/\/$/, '')}/${streamKey}`;
}

function deriveIngressUrlFromStreamKey(params: {
	protocol: IngressProtocol;
	endpoint: string;
	streamKey: string;
}): string | null {
	const baseHttpUrl = toHttpUrl(params.endpoint).replace(/\/$/, '');
	let endpointHost: string;
	try {
		endpointHost = new URL(baseHttpUrl).host;
	} catch {
		return null;
	}

	if (params.protocol === 'whip') {
		const whipBase = (process.env.FLUXER_IPTV_INGRESS_WHIP_BASE_URL ?? `${baseHttpUrl}/whip`).replace(/\/$/, '');
		return `${whipBase}/${params.streamKey}`;
	}

	const rtmpBase = (process.env.FLUXER_IPTV_INGRESS_RTMP_BASE_URL ?? `rtmp://${endpointHost}/live`).replace(/\/$/, '');
	return `${rtmpBase}/${params.streamKey}`;
}

async function createIngress(params: {
	endpoint: string;
	apiKey: string;
	apiSecret: string;
	roomName: string;
	participantIdentity: string;
	participantName: string;
}): Promise<{
	ingressClient: unknown;
	ingressId: string;
	ingestUrl: string;
	streamKey: string | null;
	protocol: IngressProtocol;
}> {
	const sdk = (await import('livekit-server-sdk')) as Record<string, unknown>;
	const IngressClient = sdk['IngressClient'] as
		| (new (url: string, key: string, secret: string) => {createIngress: (...args: Array<unknown>) => Promise<unknown>})
		| undefined;
	const IngressInput = sdk['IngressInput'] as Record<string, unknown> | undefined;

	if (!IngressClient || !IngressInput) {
		throw new FeatureTemporarilyDisabledError();
	}

	const ingressClient = new IngressClient(toHttpUrl(params.endpoint), params.apiKey, params.apiSecret);
	// livekit-server-sdk IngressClient may ignore URL path prefixes.
	// When endpoint is proxied under "/livekit", force Twirp RPC prefix accordingly.
	try {
		const parsed = new URL(toHttpUrl(params.endpoint));
		const pathPrefix = parsed.pathname.replace(/\/+$/, '');
		if (pathPrefix) {
			const client = ingressClient as {rpc?: {prefix?: string}};
			const currentPrefix = client.rpc?.prefix;
			if (typeof currentPrefix === 'string') {
				client.rpc!.prefix = `${pathPrefix}${currentPrefix}`;
			}
		}
	} catch {
		// Keep default ingress client behavior if endpoint URL parsing fails.
	}

	const candidates: Array<{input: unknown; protocol: IngressProtocol}> = [];
	const whipEnabled = isWhipEnabledForFfmpeg();
	if (IngressInput['WHIP_INPUT'] !== undefined && whipEnabled) {
		candidates.push({input: IngressInput['WHIP_INPUT'], protocol: 'whip'});
	}
	if (IngressInput['RTMP_INPUT'] !== undefined) {
		candidates.push({input: IngressInput['RTMP_INPUT'], protocol: 'rtmp'});
	}

	if (IngressInput['WHIP_INPUT'] !== undefined && !whipEnabled && IngressInput['RTMP_INPUT'] === undefined) {
		throw InputValidationError.create(
			'source_url',
			'WHIP ingress is available, but local ffmpeg does not support WHIP output. Enable WHIP-capable ffmpeg or RTMP ingress.',
		);
	}

	if (candidates.length === 0) {
		throw new FeatureTemporarilyDisabledError();
	}

	for (const candidate of candidates) {
		const created = (await ingressClient.createIngress(candidate.input, {
			name: params.participantName,
			roomName: params.roomName,
			participantIdentity: params.participantIdentity,
			participantName: params.participantName,
		})) as Record<string, unknown>;

		const ingressIdRaw = (created['ingressId'] ?? created['ingress_id']) as string | undefined;
		const ingestUrlRaw = (created['url'] ?? created['ingressUrl'] ?? created['ingest_url']) as string | undefined;
		const streamKeyRaw = (created['streamKey'] ?? created['stream_key']) as string | undefined;

		const ingressId = ingressIdRaw?.trim() || undefined;
		let ingestUrl = ingestUrlRaw?.trim() || undefined;
		const streamKey = streamKeyRaw?.trim() || undefined;

		if (!ingestUrl && streamKey) {
			ingestUrl = deriveIngressUrlFromStreamKey({
				protocol: candidate.protocol,
				endpoint: params.endpoint,
				streamKey,
			}) ?? undefined;
		}

		Logger.debug(
			{
				protocol: candidate.protocol,
				inputTypeValue: String(candidate.input),
				ingressId: ingressId ?? null,
				hasIngestUrl: Boolean(ingestUrl),
				hasStreamKey: Boolean(streamKey),
			},
			'[iptv] createIngress response',
		);

		if (ingressId && ingestUrl) {
			return {
				ingressClient,
				ingressId,
				ingestUrl,
				streamKey: streamKey ?? null,
				protocol: candidate.protocol,
			};
		}

		// Clean up partial ingresses and try next protocol variant.
		if (ingressId) {
			await deleteIngress(ingressClient, ingressId).catch(() => {});
		}
	}

	throw new FeatureTemporarilyDisabledError();
}

async function deleteIngress(ingressClient: unknown, ingressId: string): Promise<void> {
	const client = ingressClient as {deleteIngress?: (ingressId: string) => Promise<void>};
	if (!client.deleteIngress) {
		return;
	}
	await client.deleteIngress(ingressId);
}

function spawnFfmpeg(sourceUrl: string, targetUrl: string, protocol: IngressProtocol): ChildProcessWithoutNullStreams {
	const ffmpegPath = process.env.FLUXER_IPTV_FFMPEG_PATH ?? 'ffmpeg';
	const videoCodec = (process.env.FLUXER_IPTV_VIDEO_CODEC ?? 'libx264').trim().toLowerCase();
	const vaapiDevice = process.env.FLUXER_IPTV_VAAPI_DEVICE?.trim() || '/dev/dri/renderD128';
	const isHttpSource = /^https?:\/\//i.test(sourceUrl);
	const userAgent = process.env.FLUXER_IPTV_FFMPEG_USER_AGENT?.trim();
	const referer = process.env.FLUXER_IPTV_FFMPEG_REFERER?.trim();
	const rawHeaders = process.env.FLUXER_IPTV_FFMPEG_HEADERS?.trim();
	const normalizedHeaders = rawHeaders
		? rawHeaders
				.split('\n')
				.map((line) => line.trim())
				.filter((line) => line.length > 0)
				.join('\r\n')
		: '';
	const inputHeaderArgs: Array<string> = [];

	if (isHttpSource && userAgent) {
		inputHeaderArgs.push('-user_agent', userAgent);
	}
	if (isHttpSource && referer) {
		inputHeaderArgs.push('-referer', referer);
	}
	if (isHttpSource && normalizedHeaders) {
		inputHeaderArgs.push('-headers', `${normalizedHeaders}\r\n`);
	}

	const preInputArgs: Array<string> = [];
	if (videoCodec === 'h264_vaapi') {
		preInputArgs.push('-vaapi_device', vaapiDevice);
	}

	const videoArgs =
		videoCodec === 'h264_vaapi'
			? [
					'-vf',
					'format=nv12,hwupload',
					'-c:v',
					'h264_vaapi',
					'-profile:v',
					'high',
					'-level:v',
					'4.1',
					'-b:v',
					process.env.FLUXER_IPTV_VAAPI_BITRATE ?? '2500k',
					'-maxrate',
					process.env.FLUXER_IPTV_VAAPI_MAXRATE ?? '3000k',
					'-bufsize',
					process.env.FLUXER_IPTV_VAAPI_BUFSIZE ?? '6000k',
					'-g',
					'60',
					'-keyint_min',
					'60',
					'-bf',
					'0',
				]
			: [
					'-c:v',
					'libx264',
					'-preset',
					process.env.FLUXER_IPTV_X264_PRESET ?? 'veryfast',
					'-tune',
					'zerolatency',
					'-pix_fmt',
					'yuv420p',
					'-g',
					'60',
					'-keyint_min',
					'60',
					'-sc_threshold',
					'0',
				];

	const baseArgs = [
		'-hide_banner',
		'-loglevel',
		'warning',
		'-reconnect',
		'1',
		'-reconnect_streamed',
		'1',
		'-reconnect_delay_max',
		'10',
		...preInputArgs,
		...inputHeaderArgs,
		'-i',
		sourceUrl,
		'-map',
		'0:v:0',
		'-map',
		'0:a:0?',
		...videoArgs,
		'-c:a',
		'aac',
		'-b:a',
		'128k',
		'-ar',
		'48000',
		'-ac',
		'2',
	];

	const outputArgs =
		protocol === 'whip'
			? [
					'-f',
					'whip',
					targetUrl,
				]
			: [
					'-f',
					'flv',
					targetUrl,
				];

	const ffmpegArgs = [...baseArgs, ...outputArgs];

	return spawn(ffmpegPath, ffmpegArgs, {stdio: 'pipe'});
}

export class IPTVService {
	private static readonly activeSessions = new Map<string, ActiveIptvSession>();
	private static readonly playlistConfigKeyPrefix = 'iptv:playlist:config:guild';
	private static readonly playlistDataKeyPrefix = 'iptv:playlist:data:guild';

	constructor(
		private readonly channelRepository: ChannelRepository,
		private readonly gatewayService: IGatewayService,
		private readonly liveKitService: ILiveKitService,
		private readonly voiceRoomStore: IVoiceRoomStore,
		private readonly kvClient: IKVProvider,
	) {}

	private getSessionKey(channelId: ChannelID): string {
		return channelId.toString();
	}

	private async assertUserInVoiceChannel(params: {
		guildId: GuildID;
		channelId: ChannelID;
		userId: UserID;
	}): Promise<void> {
		const expectedChannelId = params.channelId.toString();
		const expectedUserId = params.userId.toString();

		// Voice state updates can lag briefly behind UI actions; retry to avoid false negatives.
		for (let attempt = 0; attempt < 6; attempt++) {
			const voiceState = await this.gatewayService.getVoiceState({
				guildId: params.guildId,
				userId: params.userId,
			});

			if (voiceState?.channel_id && voiceState.channel_id === expectedChannelId) {
				return;
			}

			// Fallback: verify against channel-scoped voice state list.
			const channelStates = await this.gatewayService.getVoiceStatesForChannel({
				guildId: params.guildId,
				channelId: params.channelId,
			});
			if (
				channelStates.voiceStates.some(
					(voiceStateEntry) =>
						voiceStateEntry.userId === expectedUserId && voiceStateEntry.channelId === expectedChannelId,
				)
			) {
				return;
			}

			if (attempt < 5) {
				await sleep(200);
			}
		}

		throw new UserNotInVoiceError();
	}

	private async getChannelContext(channelId: ChannelID): Promise<{guildId: GuildID}> {
		const channel = await this.channelRepository.findUnique(channelId);
		if (!channel) {
			throw new UnknownChannelError();
		}

		if (channel.type !== ChannelTypes.GUILD_VOICE || !channel.guildId) {
			throw InputValidationError.create('channel_id', 'Channel must be a guild voice channel.');
		}

		return {guildId: channel.guildId};
	}

	private getPlaylistConfigKey(guildId: GuildID): string {
		return `${IPTVService.playlistConfigKeyPrefix}:${guildId.toString()}`;
	}

	private getPlaylistDataKey(guildId: GuildID, index: number): string {
		return `${IPTVService.playlistDataKeyPrefix}:${guildId.toString()}:${index}`;
	}

	private async loadInlinePlaylist(config: IptvPlaylistConfig): Promise<string | null> {
		if (config.source !== 'inline') {
			return null;
		}

		if (typeof config.playlist === 'string' && config.playlist.length > 0) {
			return config.playlist;
		}

		const chunkCount = config.playlistChunkCount ?? 0;
		if (chunkCount <= 0) {
			return null;
		}

		const chunks: Array<string> = [];
		for (let index = 0; index < chunkCount; index++) {
			const chunk = await this.kvClient.get(this.getPlaylistDataKey(config.guildId, index));
			if (chunk == null) {
				return null;
			}
			if (chunk.startsWith('b64:')) {
				chunks.push(Buffer.from(chunk.slice(4), 'base64').toString('utf8'));
			} else {
				// Backward compatibility for older plain-text chunks.
				chunks.push(chunk);
			}
		}

		return chunks.join('');
	}

	private async clearInlinePlaylistChunks(guildId: GuildID, existingCount: number | null | undefined): Promise<void> {
		const total = existingCount ?? 0;
		if (total <= 0) {
			return;
		}

		for (let index = 0; index < total; index++) {
			await this.kvClient.del(this.getPlaylistDataKey(guildId, index));
		}
	}

	private parsePlaylistConfig(raw: string | null): IptvPlaylistConfig | null {
		if (!raw) {
			return null;
		}

		try {
			const parsed = JSON.parse(raw) as {
				guildId?: string;
				source?: IptvPlaylistConfigSource;
				playlist?: string | null;
				playlistChunkCount?: number | null;
				playlistUrl?: string | null;
				updatedAt?: string;
				updatedBy?: string;
			};

			if (!parsed.guildId || !parsed.source || !parsed.updatedAt || !parsed.updatedBy) {
				return null;
			}

			if (parsed.source !== 'inline' && parsed.source !== 'url') {
				return null;
			}

			const guild = createGuildID(BigInt(parsed.guildId));
			return {
				guildId: guild,
				source: parsed.source,
				playlist: parsed.playlist ?? null,
				playlistChunkCount:
					typeof parsed.playlistChunkCount === 'number' && parsed.playlistChunkCount > 0
						? parsed.playlistChunkCount
						: null,
				playlistUrl: parsed.playlistUrl ?? null,
				updatedAt: parsed.updatedAt,
				updatedBy: parsed.updatedBy,
			};
		} catch {
			return null;
		}
	}

	private async getGuildPlaylistConfigInternal(guildId: GuildID): Promise<IptvPlaylistConfig | null> {
		const raw = await this.kvClient.get(this.getPlaylistConfigKey(guildId));
		const parsed = this.parsePlaylistConfig(raw);
		if (!parsed) {
			return null;
		}

		if (parsed.source === 'inline' && !parsed.playlist) {
			const playlist = await this.loadInlinePlaylist(parsed);
			return {
				...parsed,
				playlist,
			};
		}

		return parsed;
	}

	private async requireManageGuildPermission(params: {
		guildId: GuildID;
		userId: UserID;
	}): Promise<void> {
		try {
			const permissions = await this.gatewayService.getUserPermissions({
				guildId: params.guildId,
				userId: params.userId,
			});

			const hasAdministrator = (permissions & Permissions.ADMINISTRATOR) !== 0n;
			const canManageGuild = (permissions & Permissions.MANAGE_GUILD) !== 0n;
			const canManageChannels = (permissions & Permissions.MANAGE_CHANNELS) !== 0n;

			Logger.debug(
				{
					guildId: params.guildId,
					userId: params.userId,
					permissions: permissions.toString(),
					hasAdministrator,
					canManageGuild,
					canManageChannels,
				},
				'[iptv] evaluated playlist management permissions',
			);

			if (hasAdministrator || canManageGuild || canManageChannels) {
				return;
			}
		} catch (error) {
			Logger.error(
				{
					error,
					guildId: params.guildId,
					userId: params.userId,
				},
				'[iptv] failed to evaluate playlist management permissions',
			);
			throw error;
		}

		throw new MissingPermissionsError();
	}

	private async buildStreamSession(params: {
		guildId: GuildID;
		channelId: ChannelID;
		sourceUrl: string;
		streamName: string;
	}): Promise<ActiveIptvSession> {
		const pinned = await this.voiceRoomStore.getPinnedRoomServer(params.guildId, params.channelId);
		if (!pinned) {
			Logger.warn(
				{channelId: params.channelId, guildId: params.guildId},
				'[iptv] no pinned voice room server found for channel',
			);
			throw new FeatureTemporarilyDisabledError();
		}

		const server = this.liveKitService.getServer(pinned.regionId, pinned.serverId);
		if (!server) {
			Logger.warn(
				{
					channelId: params.channelId,
					guildId: params.guildId,
					regionId: pinned.regionId,
					serverId: pinned.serverId,
				},
				'[iptv] pinned voice server is not present in current livekit topology',
			);
			throw new FeatureTemporarilyDisabledError();
		}

		const roomName = buildRoomName(params.guildId, params.channelId);
		const participantIdentity = buildParticipantIdentity(params.channelId);
		const ingress = await createIngress({
			endpoint: server.endpoint,
			apiKey: server.apiKey,
			apiSecret: server.apiSecret,
			roomName,
			participantIdentity,
			participantName: params.streamName,
		});

		const ffmpegTarget = buildFfmpegTarget(ingress.ingestUrl, ingress.streamKey);
		const ffmpegProcess = spawnFfmpeg(params.sourceUrl, ffmpegTarget, ingress.protocol);

		ffmpegProcess.stderr.on('data', (chunk: Buffer) => {
			Logger.debug({channelId: params.channelId, log: chunk.toString()}, '[iptv] ffmpeg stderr');
		});

		ffmpegProcess.on('exit', (code, signal) => {
			Logger.warn({channelId: params.channelId, code, signal}, '[iptv] ffmpeg exited');
			IPTVService.activeSessions.delete(this.getSessionKey(params.channelId));
			void deleteIngress(ingress.ingressClient, ingress.ingressId).catch((error) => {
				Logger.error({error, channelId: params.channelId}, '[iptv] failed to cleanup ingress after ffmpeg exit');
			});
		});

		await ensureFfmpegDidNotExitImmediately(ffmpegProcess);

		return {
			channelId: params.channelId,
			guildId: params.guildId,
			sourceUrl: params.sourceUrl,
			streamName: params.streamName,
			startedAt: new Date().toISOString(),
			ingressId: ingress.ingressId,
			ingressClient: ingress.ingressClient,
			ffmpegProcess,
			ffmpegTarget,
		};
	}

	async startDirect(params: {
		userId: UserID;
		channelId: ChannelID;
		sourceUrl: string;
		streamName?: string;
	}): Promise<{active: true; streamName: string; sourceUrl: string; startedAt: string}> {
		const {guildId} = await this.getChannelContext(params.channelId);
		await this.assertUserInVoiceChannel({guildId, channelId: params.channelId, userId: params.userId});

		const sessionKey = this.getSessionKey(params.channelId);
		if (IPTVService.activeSessions.has(sessionKey)) {
			throw InputValidationError.create('channel_id', 'An IPTV stream is already active in this channel.');
		}

		const streamName = params.streamName?.trim() || 'IPTV';
		let session: ActiveIptvSession;
		try {
			session = await this.buildStreamSession({
				guildId,
				channelId: params.channelId,
				sourceUrl: params.sourceUrl,
				streamName,
			});
		} catch (error) {
			Logger.error(
				{
					error,
					channelId: params.channelId,
					guildId,
					userId: params.userId,
					sourceUrl: params.sourceUrl,
				},
				'[iptv] failed to start direct stream',
			);
			throw error;
		}

		IPTVService.activeSessions.set(sessionKey, session);
		return {
			active: true,
			streamName: session.streamName,
			sourceUrl: session.sourceUrl,
			startedAt: session.startedAt,
		};
	}

	async startFromPlaylist(params: {
		userId: UserID;
		channelId: ChannelID;
		channelName: string;
		playlist?: string;
		playlistUrl?: string;
		streamName?: string;
	}): Promise<{active: true; streamName: string; sourceUrl: string; startedAt: string}> {
		const playlistRaw = params.playlist ?? (await this.loadPlaylistFromUrl(params.playlistUrl));
		if (!playlistRaw || playlistRaw.trim().length === 0) {
			throw InputValidationError.create('playlist', 'Playlist is empty.');
		}

		const entries = parsePlaylist(playlistRaw);
		if (entries.length === 0) {
			throw InputValidationError.create('playlist', 'Playlist has no valid channels.');
		}

		const match = resolvePlaylistEntry(entries, params.channelName);
		if (!match) {
			throw InputValidationError.create('channel_name', 'No matching channel found in playlist.');
		}

		return this.startDirect({
			userId: params.userId,
			channelId: params.channelId,
			sourceUrl: match.url,
			streamName: params.streamName?.trim() || match.name,
		});
	}

	async setGuildPlaylistConfig(params: {
		userId: UserID;
		channelId: ChannelID;
		playlist?: string;
		playlistUrl?: string;
	}): Promise<{source: IptvPlaylistConfigSource; playlistUrl: string | null; updatedAt: string}> {
		const {guildId} = await this.getChannelContext(params.channelId);
		await this.requireManageGuildPermission({guildId, userId: params.userId});
		const existingConfig = await this.getGuildPlaylistConfigInternal(guildId);

		const playlist = params.playlist?.trim();
		const playlistUrl = params.playlistUrl?.trim();

		if (!playlist && !playlistUrl) {
			throw InputValidationError.create('playlist', 'playlist or playlist_url is required.');
		}

		const source: IptvPlaylistConfigSource = playlist ? 'inline' : 'url';
		const playlistBytes = source === 'inline' ? new TextEncoder().encode(playlist ?? '').length : 0;
		const nextConfig: IptvPlaylistConfig = {
			guildId,
			source,
			playlist: null,
			playlistChunkCount: null,
			playlistUrl: source === 'url' ? playlistUrl ?? null : null,
			updatedAt: new Date().toISOString(),
			updatedBy: params.userId.toString(),
		};

		try {
			if (source === 'inline') {
				const chunkParts = splitUtf8TextByBytes(playlist ?? '', INLINE_PLAYLIST_CHUNK_BYTES);
				Logger.debug(
					{
						guildId,
						userId: params.userId,
						playlistBytes,
						chunkCount: chunkParts.length,
						chunkBytes: INLINE_PLAYLIST_CHUNK_BYTES,
					},
					'[iptv] persisting inline playlist config',
				);
				for (let index = 0; index < chunkParts.length; index++) {
					const encodedChunk = Buffer.from(chunkParts[index], 'utf8').toString('base64');
					await this.kvClient.set(this.getPlaylistDataKey(guildId, index), `b64:${encodedChunk}`);
				}
				nextConfig.playlistChunkCount = chunkParts.length;
			}

			await this.kvClient.set(
				this.getPlaylistConfigKey(guildId),
				JSON.stringify({
					...nextConfig,
					guildId: nextConfig.guildId.toString(),
				}),
			);
			if (existingConfig?.source === 'inline') {
				const previousCount = existingConfig.playlistChunkCount ?? 0;
				const nextCount = nextConfig.playlistChunkCount ?? 0;
				for (let index = nextCount; index < previousCount; index++) {
					await this.kvClient.del(this.getPlaylistDataKey(guildId, index));
				}
			}
		} catch (error) {
			Logger.error(
				{
					error,
					guildId,
					userId: params.userId,
					source,
				},
				'[iptv] failed to persist playlist config',
			);
			if (source === 'inline') {
				throw InputValidationError.create(
					'playlist',
					`Playlist could not be saved due to a server storage error (${playlistBytes} bytes). Please try again or use a playlist URL.`,
				);
			}
			throw error;
		}
		return {
			source: nextConfig.source,
			playlistUrl: nextConfig.playlistUrl,
			updatedAt: nextConfig.updatedAt,
		};
	}

	async clearGuildPlaylistConfig(params: {userId: UserID; channelId: ChannelID}): Promise<{cleared: true}> {
		const {guildId} = await this.getChannelContext(params.channelId);
		await this.requireManageGuildPermission({guildId, userId: params.userId});
		const existingConfig = await this.getGuildPlaylistConfigInternal(guildId);
		await this.kvClient.del(this.getPlaylistConfigKey(guildId));
		if (existingConfig?.source === 'inline') {
			await this.clearInlinePlaylistChunks(guildId, existingConfig.playlistChunkCount);
		}
		return {cleared: true};
	}

	async getGuildPlaylistConfig(params: {channelId: ChannelID}): Promise<{
		hasPlaylist: boolean;
		source: IptvPlaylistConfigSource | null;
		playlistUrl: string | null;
		updatedAt: string | null;
	}> {
		const {guildId} = await this.getChannelContext(params.channelId);
		const config = await this.getGuildPlaylistConfigInternal(guildId);
		if (!config) {
			return {
				hasPlaylist: false,
				source: null,
				playlistUrl: null,
				updatedAt: null,
			};
		}

		return {
			hasPlaylist: true,
			source: config.source,
			playlistUrl: config.playlistUrl,
			updatedAt: config.updatedAt,
		};
	}

	async listConfiguredPlaylistChannels(params: {
		channelId: ChannelID;
		query?: string;
		limit?: number;
	}): Promise<{channels: Array<{name: string; url: string; logo: string | null; group: string | null}>}> {
		const {guildId} = await this.getChannelContext(params.channelId);
		const config = await this.getGuildPlaylistConfigInternal(guildId);
		if (!config) {
			throw InputValidationError.create('channel_id', 'No IPTV playlist is configured for this guild.');
		}

		const playlistRaw =
			config.source === 'inline' ? config.playlist : await this.loadPlaylistFromUrl(config.playlistUrl ?? undefined);

		if (!playlistRaw || playlistRaw.trim().length === 0) {
			throw InputValidationError.create('playlist', 'Playlist is empty.');
		}

		const allEntries = parsePlaylist(playlistRaw);
		if (allEntries.length === 0) {
			return {channels: []};
		}

		const query = params.query?.trim().toLowerCase() ?? '';
		const max = Math.min(Math.max(params.limit ?? 50, 1), 5000);
		const filtered = query
			? allEntries.filter((entry) => {
					const name = entry.name.toLowerCase();
					const group = (entry.group ?? '').toLowerCase();
					return name.includes(query) || group.includes(query);
				})
			: allEntries;

		return {
			channels: filtered.slice(0, max).map((entry) => ({
				name: entry.name,
				url: entry.url,
				logo: entry.logo ?? null,
				group: entry.group ?? null,
			})),
		};
	}

	async startFromConfiguredPlaylist(params: {
		userId: UserID;
		channelId: ChannelID;
		channelName: string;
		streamName?: string;
	}): Promise<{active: true; streamName: string; sourceUrl: string; startedAt: string}> {
		const {guildId} = await this.getChannelContext(params.channelId);
		const config = await this.getGuildPlaylistConfigInternal(guildId);
		if (!config) {
			throw InputValidationError.create('channel_id', 'No IPTV playlist is configured for this guild.');
		}

		return this.startFromPlaylist({
			userId: params.userId,
			channelId: params.channelId,
			channelName: params.channelName,
			playlist: config.source === 'inline' ? config.playlist ?? undefined : undefined,
			playlistUrl: config.source === 'url' ? config.playlistUrl ?? undefined : undefined,
			streamName: params.streamName,
		});
	}

	private async loadPlaylistFromUrl(playlistUrl?: string): Promise<string | null> {
		if (!playlistUrl) {
			return null;
		}

		const response = await fetch(playlistUrl);
		if (!response.ok) {
			throw InputValidationError.create(
				'playlist_url',
				`Failed to fetch playlist URL (HTTP ${response.status}).`,
			);
		}
		return response.text();
	}

	async stop(params: {userId: UserID; channelId: ChannelID}): Promise<{active: false}> {
		const {guildId} = await this.getChannelContext(params.channelId);
		await this.assertUserInVoiceChannel({guildId, channelId: params.channelId, userId: params.userId});

		const sessionKey = this.getSessionKey(params.channelId);
		const session = IPTVService.activeSessions.get(sessionKey);
		if (!session) {
			return {active: false};
		}

		IPTVService.activeSessions.delete(sessionKey);
		session.ffmpegProcess.kill('SIGTERM');
		await deleteIngress(session.ingressClient, session.ingressId).catch((error) => {
			Logger.error({error, channelId: params.channelId}, '[iptv] failed to delete ingress');
		});

		return {active: false};
	}

	async getStatus(params: {channelId: ChannelID}): Promise<{
		active: boolean;
		streamName: string | null;
		sourceUrl: string | null;
		startedAt: string | null;
		target: string | null;
	}> {
		const session = IPTVService.activeSessions.get(this.getSessionKey(params.channelId));
		if (!session) {
			return {active: false, streamName: null, sourceUrl: null, startedAt: null, target: null};
		}

		return {
			active: true,
			streamName: session.streamName,
			sourceUrl: session.sourceUrl,
			startedAt: session.startedAt,
			target: session.ffmpegTarget,
		};
	}
}
