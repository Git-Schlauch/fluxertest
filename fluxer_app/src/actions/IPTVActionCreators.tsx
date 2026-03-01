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

import {Endpoints} from '@app/Endpoints';
import HttpClient from '@app/lib/HttpClient';

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
	const response = await HttpClient.get<IPTVStatus>(Endpoints.CHANNEL_IPTV(channelId));
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
	const response = await HttpClient.post<IPTVStartResponse>(Endpoints.CHANNEL_IPTV_START_DIRECT(params.channelId), {
		source_url: params.sourceUrl,
		stream_name: params.streamName,
	});
	if (!response.body) {
		throw new Error('Failed to start IPTV stream');
	}
	return response.body;
}

export async function stopIPTV(channelId: string): Promise<void> {
	await HttpClient.post(Endpoints.CHANNEL_IPTV_STOP(channelId), {});
}

export async function startIPTVFromConfiguredPlaylist(params: {
	channelId: string;
	channelName: string;
	streamName?: string;
}): Promise<IPTVStartResponse> {
	const response = await HttpClient.post<IPTVStartResponse>(Endpoints.CHANNEL_IPTV_START_FROM_CONFIG(params.channelId), {
		channel_name: params.channelName,
		stream_name: params.streamName,
	});
	if (!response.body) {
		throw new Error('Failed to start IPTV stream from configured playlist');
	}
	return response.body;
}

export async function getIPTVPlaylistConfig(channelId: string): Promise<IPTVPlaylistConfig> {
	const response = await HttpClient.get<IPTVPlaylistConfig>(Endpoints.CHANNEL_IPTV_PLAYLIST_CONFIG(channelId));
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
	const response = await HttpClient.put<{source: 'inline' | 'url'; playlistUrl: string | null; updatedAt: string}>(
		Endpoints.CHANNEL_IPTV_PLAYLIST_CONFIG(params.channelId),
		{
			playlist: params.playlist,
			playlist_url: params.playlistUrl,
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
	const form = new FormData();
	form.append('playlist_file', params.file, params.file.name);

	const response = await HttpClient.post<{source: 'inline' | 'url'; playlistUrl: string | null; updatedAt: string}>(
		Endpoints.CHANNEL_IPTV_PLAYLIST_CONFIG_UPLOAD(params.channelId),
		form,
	);
	if (!response.body) {
		throw new Error('Failed to upload IPTV playlist config file');
	}
	return response.body;
}

export async function clearIPTVPlaylistConfig(channelId: string): Promise<void> {
	await HttpClient.delete(Endpoints.CHANNEL_IPTV_PLAYLIST_CONFIG(channelId));
}

export async function listConfiguredIPTVChannels(params: {
	channelId: string;
	query?: string;
	limit?: number;
}): Promise<Array<IPTVConfiguredChannel>> {
	const search = new URLSearchParams();
	if (params.query && params.query.trim().length > 0) {
		search.set('query', params.query.trim());
	}
	if (params.limit) {
		search.set('limit', String(params.limit));
	}
	const querySuffix = search.toString().length > 0 ? `?${search.toString()}` : '';
	const response = await HttpClient.get<{channels: Array<IPTVConfiguredChannel>}>(
		`${Endpoints.CHANNEL_IPTV_CHANNELS(params.channelId)}${querySuffix}`,
	);
	return response.body?.channels ?? [];
}
