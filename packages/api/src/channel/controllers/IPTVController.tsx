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

import {createChannelID} from '@fluxer/api/src/BrandedTypes';
import {DefaultUserOnly, LoginRequired} from '@fluxer/api/src/middleware/AuthMiddleware';
import {RateLimitMiddleware} from '@fluxer/api/src/middleware/RateLimitMiddleware';
import {OpenAPI} from '@fluxer/api/src/middleware/ResponseTypeMiddleware';
import {RateLimitConfigs} from '@fluxer/api/src/RateLimitConfig';
import type {HonoApp} from '@fluxer/api/src/types/HonoEnv';
import {Validator} from '@fluxer/api/src/Validator';
import {Logger} from '@fluxer/api/src/Logger';
import {ChannelIdParam} from '@fluxer/schema/src/domains/common/CommonParamSchemas';
import {InputValidationError} from '@fluxer/errors/src/domains/core/InputValidationError';
import {z} from 'zod';

const IPTVStartDirectBodySchema = z.object({
	source_url: z.string().url(),
	stream_name: z.string().trim().min(1).max(120).optional(),
});

const IPTVStartPlaylistBodySchema = z
	.object({
		channel_name: z.string().trim().min(1).max(500).optional(),
		channelName: z.string().trim().min(1).max(500).optional(),
		playlist: z.string().trim().min(1).optional(),
		playlist_url: z.string().url().optional(),
		playlistUrl: z.string().url().optional(),
		stream_name: z.string().trim().min(1).max(120).optional(),
		streamName: z.string().trim().min(1).max(120).optional(),
	})
	.transform((data) => ({
		channel_name: data.channel_name ?? data.channelName,
		playlist: data.playlist,
		playlist_url: data.playlist_url ?? data.playlistUrl,
		stream_name: data.stream_name ?? data.streamName,
	}))
	.refine((data) => data.channel_name !== undefined, {
		message: 'channel_name is required',
		path: ['channel_name'],
	})
	.refine((data) => data.playlist !== undefined || data.playlist_url !== undefined, {
		message: 'playlist or playlist_url is required',
		path: ['playlist'],
	});

const IPTVSetPlaylistConfigBodySchema = z
	.object({
		playlist: z.string().trim().min(1).optional(),
		playlist_url: z.string().url().optional(),
	})
	.refine((data) => data.playlist !== undefined || data.playlist_url !== undefined, {
		message: 'playlist or playlist_url is required',
		path: ['playlist'],
	});

const IPTVConfiguredListQuerySchema = z.object({
	query: z.string().trim().max(200).optional(),
	limit: z.coerce.number().int().min(1).max(5000).optional(),
});

const IPTVStartConfiguredBodySchema = z
	.object({
		channel_name: z.string().trim().min(1).max(500).optional(),
		channelName: z.string().trim().min(1).max(500).optional(),
		stream_name: z.string().trim().min(1).max(120).optional(),
		streamName: z.string().trim().min(1).max(120).optional(),
	})
	.transform((data) => ({
		channel_name: data.channel_name ?? data.channelName,
		stream_name: data.stream_name ?? data.streamName,
	}))
	.refine((data) => data.channel_name !== undefined, {
		message: 'channel_name is required',
		path: ['channel_name'],
	});

const IPTVStatusResponseSchema = z.object({
	active: z.boolean(),
	streamName: z.string().nullable(),
	sourceUrl: z.string().nullable(),
	startedAt: z.string().nullable(),
	target: z.string().nullable(),
});

const IPTVStartResponseSchema = z.object({
	active: z.literal(true),
	streamName: z.string(),
	sourceUrl: z.string(),
	startedAt: z.string(),
});

const IPTVPlaylistConfigResponseSchema = z.object({
	hasPlaylist: z.boolean(),
	source: z.enum(['inline', 'url']).nullable(),
	playlistUrl: z.string().nullable(),
	updatedAt: z.string().nullable(),
});

const IPTVPlaylistConfigSetResponseSchema = z.object({
	source: z.enum(['inline', 'url']),
	playlistUrl: z.string().nullable(),
	updatedAt: z.string(),
});

const IPTVConfiguredChannelsResponseSchema = z.object({
	channels: z.array(
		z.object({
			name: z.string(),
			url: z.string().url(),
			logo: z.string().nullable(),
			group: z.string().nullable(),
		}),
	),
});

export function IPTVController(app: HonoApp) {
	app.get(
		'/channels/:channel_id/iptv',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_IPTV_STATUS),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', ChannelIdParam),
		OpenAPI({
			operationId: 'get_iptv_status',
			summary: 'Get IPTV stream status',
			description: 'Returns whether an IPTV ingest stream is currently active for the voice channel.',
			responseSchema: IPTVStatusResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const channelId = createChannelID(ctx.req.valid('param').channel_id);
			return ctx.json(await ctx.get('iptvService').getStatus({channelId}));
		},
	);

	app.post(
		'/channels/:channel_id/iptv/start-direct',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_IPTV_START),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', ChannelIdParam),
		Validator('json', IPTVStartDirectBodySchema),
		OpenAPI({
			operationId: 'start_iptv_direct',
			summary: 'Start IPTV stream from direct URL',
			description:
				'Starts an IPTV stream into the voice channel from a direct media URL. The requester must be connected to the channel.',
			responseSchema: IPTVStartResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const channelId = createChannelID(ctx.req.valid('param').channel_id);
			const data = ctx.req.valid('json');

			return ctx.json(
				await ctx.get('iptvService').startDirect({
					userId: user.id,
					channelId,
					sourceUrl: data.source_url,
					streamName: data.stream_name,
				}),
			);
		},
	);

	app.post(
		'/channels/:channel_id/iptv/start',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_IPTV_START),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', ChannelIdParam),
		Validator('json', IPTVStartPlaylistBodySchema),
		OpenAPI({
			operationId: 'start_iptv_from_playlist',
			summary: 'Start IPTV stream from playlist',
			description:
				'Selects a channel from an M3U playlist by name and starts streaming it into the voice channel. The requester must be connected to the channel.',
			responseSchema: IPTVStartResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const channelId = createChannelID(ctx.req.valid('param').channel_id);
			const data = ctx.req.valid('json');

			return ctx.json(
				await ctx.get('iptvService').startFromPlaylist({
					userId: user.id,
					channelId,
					channelName: data.channel_name,
					playlist: data.playlist,
					playlistUrl: data.playlist_url,
					streamName: data.stream_name,
				}),
			);
		},
	);

	app.get(
		'/channels/:channel_id/iptv/playlist-config',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_IPTV_STATUS),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', ChannelIdParam),
		OpenAPI({
			operationId: 'get_iptv_playlist_config',
			summary: 'Get IPTV playlist config',
			description: 'Returns whether a guild IPTV playlist is configured for this channel.',
			responseSchema: IPTVPlaylistConfigResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const channelId = createChannelID(ctx.req.valid('param').channel_id);
			return ctx.json(await ctx.get('iptvService').getGuildPlaylistConfig({channelId}));
		},
	);

	app.put(
		'/channels/:channel_id/iptv/playlist-config',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_IPTV_START),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', ChannelIdParam),
		Validator('json', IPTVSetPlaylistConfigBodySchema),
		OpenAPI({
			operationId: 'set_iptv_playlist_config',
			summary: 'Set IPTV playlist config',
			description:
				'Sets the guild-level IPTV playlist (inline M3U text or playlist URL). Requires manage guild permission.',
			responseSchema: IPTVPlaylistConfigSetResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const channelId = createChannelID(ctx.req.valid('param').channel_id);
			const data = ctx.req.valid('json');
			return ctx.json(
				await ctx.get('iptvService').setGuildPlaylistConfig({
					userId: user.id,
					channelId,
					playlist: data.playlist,
					playlistUrl: data.playlist_url,
				}),
			);
		},
	);

	app.post(
		'/channels/:channel_id/iptv/playlist-config/upload',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_IPTV_START),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', ChannelIdParam),
		OpenAPI({
			operationId: 'upload_iptv_playlist_config_file',
			summary: 'Upload IPTV playlist file',
			description:
				'Uploads a local M3U/M3U8 file and stores it as guild-level IPTV playlist config. Requires manage guild/channels permission.',
			responseSchema: IPTVPlaylistConfigSetResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const channelId = createChannelID(ctx.req.valid('param').channel_id);
			let form: FormData;
			try {
				form = await ctx.req.formData();
			} catch {
				throw InputValidationError.create('playlist_file', 'Failed to parse multipart form data.');
			}
			const file = form.get('playlist_file');
			if (!(file instanceof File)) {
				throw InputValidationError.create('playlist_file', 'playlist_file is required.');
			}

			Logger.debug(
				{
					channelId,
					userId: user.id,
					playlistFileName: file.name,
					playlistFileType: file.type,
					playlistFileSize: file.size,
				},
				'[iptv] received playlist upload',
			);

			const playlist = (await file.text()).trim();
			if (playlist.length === 0) {
				throw InputValidationError.create('playlist_file', 'Playlist file is empty.');
			}

			return ctx.json(
				await ctx.get('iptvService').setGuildPlaylistConfig({
					userId: user.id,
					channelId,
					playlist,
				}),
			);
		},
	);

	app.delete(
		'/channels/:channel_id/iptv/playlist-config',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_IPTV_STOP),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', ChannelIdParam),
		OpenAPI({
			operationId: 'clear_iptv_playlist_config',
			summary: 'Clear IPTV playlist config',
			description: 'Clears the configured guild IPTV playlist. Requires manage guild permission.',
			responseSchema: z.object({cleared: z.literal(true)}),
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const channelId = createChannelID(ctx.req.valid('param').channel_id);
			return ctx.json(
				await ctx.get('iptvService').clearGuildPlaylistConfig({
					userId: user.id,
					channelId,
				}),
			);
		},
	);

	app.get(
		'/channels/:channel_id/iptv/channels',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_IPTV_STATUS),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', ChannelIdParam),
		Validator('query', IPTVConfiguredListQuerySchema),
		OpenAPI({
			operationId: 'list_iptv_configured_channels',
			summary: 'List configured IPTV channels',
			description: 'Lists channels from the configured guild IPTV playlist (optionally filtered by query).',
			responseSchema: IPTVConfiguredChannelsResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const channelId = createChannelID(ctx.req.valid('param').channel_id);
			const query = ctx.req.valid('query');
			return ctx.json(
				await ctx.get('iptvService').listConfiguredPlaylistChannels({
					channelId,
					query: query.query,
					limit: query.limit,
				}),
			);
		},
	);

	app.post(
		'/channels/:channel_id/iptv/start-from-config',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_IPTV_START),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', ChannelIdParam),
		Validator('json', IPTVStartConfiguredBodySchema),
		OpenAPI({
			operationId: 'start_iptv_from_configured_playlist',
			summary: 'Start IPTV stream from configured playlist',
			description:
				'Starts a channel from the guild-configured IPTV playlist by channel name. The requester must be connected to the channel.',
			responseSchema: IPTVStartResponseSchema,
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const channelId = createChannelID(ctx.req.valid('param').channel_id);
			const data = ctx.req.valid('json');

			return ctx.json(
				await ctx.get('iptvService').startFromConfiguredPlaylist({
					userId: user.id,
					channelId,
					channelName: data.channel_name,
					streamName: data.stream_name,
				}),
			);
		},
	);

	app.post(
		'/channels/:channel_id/iptv/stop',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_IPTV_STOP),
		LoginRequired,
		DefaultUserOnly,
		Validator('param', ChannelIdParam),
		OpenAPI({
			operationId: 'stop_iptv_stream',
			summary: 'Stop IPTV stream',
			description: 'Stops the active IPTV stream in the voice channel.',
			responseSchema: z.object({active: z.literal(false)}),
			statusCode: 200,
			security: ['bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const channelId = createChannelID(ctx.req.valid('param').channel_id);
			return ctx.json(
				await ctx.get('iptvService').stop({
					userId: user.id,
					channelId,
				}),
			);
		},
	);
}
