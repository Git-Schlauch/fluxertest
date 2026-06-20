// SPDX-License-Identifier: AGPL-3.0-or-later

import {Endpoints} from '@app/features/app/constants/Endpoints';
import {http} from '@app/features/platform/transport/RestTransport';

export interface IPTVStatus {
	active: boolean;
	streamName: string | null;
	sourceUrl: string | null;
	startedAt: string | null;
	target: string | null;
}

export interface IPTVStartResponse {
	active: true;
	streamName: string;
	sourceUrl: string;
	startedAt: string;
}

export interface IPTVPlaylistConfig {
	hasPlaylist: boolean;
	source: 'inline' | 'url' | null;
	playlistUrl: string | null;
	updatedAt: string | null;
}

export interface IPTVConfiguredChannel {
	name: string;
	url: string;
	logo: string | null;
	group: string | null;
}

export async function getIPTVStatus(channelId: string): Promise<IPTVStatus> {
	const response = await http.get<IPTVStatus>(Endpoints.CHANNEL_IPTV(channelId));
	return (
		response.body ?? {
			active: false,
			streamName: null,
			sourceUrl: null,
			startedAt: null,
			target: null,
		}
	);
}

export async function startIPTVDirect(params: {
	channelId: string;
	sourceUrl: string;
	streamName?: string;
}): Promise<IPTVStartResponse> {
	const response = await http.post<IPTVStartResponse>(Endpoints.CHANNEL_IPTV_START_DIRECT(params.channelId), {
		body: {
			source_url: params.sourceUrl,
			stream_name: params.streamName,
		},
	});
	if (!response.body) {
		throw new Error('Failed to start IPTV stream');
	}
	return response.body;
}

export async function stopIPTV(channelId: string): Promise<void> {
	await http.post(Endpoints.CHANNEL_IPTV_STOP(channelId), {body: {}});
}

export async function startIPTVFromConfiguredPlaylist(params: {
	channelId: string;
	channelName: string;
	streamName?: string;
}): Promise<IPTVStartResponse> {
	const response = await http.post<IPTVStartResponse>(Endpoints.CHANNEL_IPTV_START_FROM_CONFIG(params.channelId), {
		body: {
			channel_name: params.channelName,
			stream_name: params.streamName,
		},
	});
	if (!response.body) {
		throw new Error('Failed to start IPTV stream from configured playlist');
	}
	return response.body;
}

export async function getIPTVPlaylistConfig(channelId: string): Promise<IPTVPlaylistConfig> {
	const response = await http.get<IPTVPlaylistConfig>(Endpoints.CHANNEL_IPTV_PLAYLIST_CONFIG(channelId));
	return (
		response.body ?? {
			hasPlaylist: false,
			source: null,
			playlistUrl: null,
			updatedAt: null,
		}
	);
}

export async function setIPTVPlaylistConfig(params: {
	channelId: string;
	playlist?: string;
	playlistUrl?: string;
}): Promise<{source: 'inline' | 'url'; playlistUrl: string | null; updatedAt: string}> {
	const response = await http.put<{source: 'inline' | 'url'; playlistUrl: string | null; updatedAt: string}>(
		Endpoints.CHANNEL_IPTV_PLAYLIST_CONFIG(params.channelId),
		{
			body: {
				playlist: params.playlist,
				playlist_url: params.playlistUrl,
			},
		},
	);
	if (!response.body) {
		throw new Error('Failed to set IPTV playlist config');
	}
	return response.body;
}

export async function uploadIPTVPlaylistConfigFile(params: {
	channelId: string;
	file: File;
}): Promise<{source: 'inline' | 'url'; playlistUrl: string | null; updatedAt: string}> {
	const response = await http.post<{source: 'inline' | 'url'; playlistUrl: string | null; updatedAt: string}>(
		Endpoints.CHANNEL_IPTV_PLAYLIST_CONFIG_UPLOAD(params.channelId),
		{
			multipart: {
				files: [{name: 'playlist_file', file: params.file, filename: params.file.name}],
			},
		},
	);
	if (!response.body) {
		throw new Error('Failed to upload IPTV playlist config file');
	}
	return response.body;
}

export async function clearIPTVPlaylistConfig(channelId: string): Promise<void> {
	await http.delete(Endpoints.CHANNEL_IPTV_PLAYLIST_CONFIG(channelId));
}

export async function listConfiguredIPTVChannels(params: {
	channelId: string;
	query?: string;
	limit?: number;
}): Promise<Array<IPTVConfiguredChannel>> {
	const response = await http.get<{channels: Array<IPTVConfiguredChannel>}>(
		Endpoints.CHANNEL_IPTV_CHANNELS(params.channelId),
		{
			query: {
				query: params.query,
				limit: params.limit,
			},
		},
	);
	return response.body?.channels ?? [];
}
