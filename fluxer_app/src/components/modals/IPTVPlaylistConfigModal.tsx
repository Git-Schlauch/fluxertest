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

import * as IPTVActionCreators from '@app/actions/IPTVActionCreators';
import {Input} from '@app/components/form/Input';
import * as Modal from '@app/components/modals/Modal';
import styles from '@app/components/modals/IPTVPlaylistConfigModal.module.css';
import {Button} from '@app/components/uikit/button/Button';
import {Trans, useLingui} from '@lingui/react/macro';
import {LinkIcon, TrashIcon, UploadSimpleIcon} from '@phosphor-icons/react';
import {useEffect, useMemo, useRef, useState} from 'react';

function getApiErrorMessage(error: unknown): string {
	if (!error || typeof error !== 'object') {
		return 'Unknown error.';
	}
	const body = (error as {body?: {message?: unknown}}).body;
	if (body && typeof body.message === 'string' && body.message.trim().length > 0) {
		return body.message;
	}
	const message = (error as {message?: unknown}).message;
	if (typeof message === 'string' && message.trim().length > 0) {
		return message;
	}
	return 'Unknown error.';
}

interface IPTVPlaylistConfigModalProps {
	channelId: string;
}

export function IPTVPlaylistConfigModal({channelId}: IPTVPlaylistConfigModalProps) {
	const {t} = useLingui();
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [playlistUrl, setPlaylistUrl] = useState('');
	const [statusText, setStatusText] = useState<string | null>(null);
	const [errorText, setErrorText] = useState<string | null>(null);
	const [isBusy, setIsBusy] = useState(false);
	const [sourceLabel, setSourceLabel] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void IPTVActionCreators.getIPTVPlaylistConfig(channelId)
			.then((config) => {
				if (cancelled) return;
				setPlaylistUrl(config.playlistUrl ?? '');
				if (!config.hasPlaylist) {
					setSourceLabel(t`No playlist configured`);
				} else if (config.source === 'url') {
					setSourceLabel(t`Current source: URL`);
				} else {
					setSourceLabel(t`Current source: Local upload`);
				}
			})
			.catch(() => {
				if (cancelled) return;
				setSourceLabel(t`Could not load current playlist status`);
			});
		return () => {
			cancelled = true;
		};
	}, [channelId, t]);

	const canSaveUrl = useMemo(() => playlistUrl.trim().length > 0 && !isBusy, [playlistUrl, isBusy]);

	const handleSaveUrl = () => {
		if (!canSaveUrl) return;
		setErrorText(null);
		setStatusText(null);
		setIsBusy(true);
		void IPTVActionCreators.setIPTVPlaylistConfig({
			channelId,
			playlistUrl: playlistUrl.trim(),
		})
			.then(() => {
				setSourceLabel(t`Current source: URL`);
				setStatusText(t`Playlist URL saved.`);
			})
			.catch((error) => {
				setErrorText(getApiErrorMessage(error));
			})
			.finally(() => {
				setIsBusy(false);
			});
	};

	const handleUploadClick = () => {
		if (isBusy) return;
		fileInputRef.current?.click();
	};

	const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = '';
		if (!file) return;
		setErrorText(null);
		setStatusText(null);
		setIsBusy(true);
		void IPTVActionCreators.uploadIPTVPlaylistConfigFile({
			channelId,
			file,
		})
			.then(() => {
				setSourceLabel(t`Current source: Local upload`);
				setStatusText(t`Playlist uploaded.`);
			})
			.catch((error) => {
				setErrorText(getApiErrorMessage(error));
			})
			.finally(() => {
				setIsBusy(false);
			});
	};

	const handleRemove = () => {
		if (isBusy) return;
		setErrorText(null);
		setStatusText(null);
		setIsBusy(true);
		void IPTVActionCreators.clearIPTVPlaylistConfig(channelId)
			.then(() => {
				setSourceLabel(t`No playlist configured`);
				setStatusText(t`Playlist removed.`);
				setPlaylistUrl('');
			})
			.catch((error) => {
				setErrorText(getApiErrorMessage(error));
			})
			.finally(() => {
				setIsBusy(false);
			});
	};

	return (
		<Modal.Root size="small" centered>
			<Modal.Header title={t`IPTV Playlist`}>
				<p className={styles.subtitle}>
					<Trans>Configure server playlist source (URL or local M3U file)</Trans>
				</p>
				{sourceLabel && <p className={styles.sourceLabel}>{sourceLabel}</p>}
			</Modal.Header>
			<Modal.Content>
				<div className={styles.content}>
					<Input
						type="text"
						value={playlistUrl}
						onChange={(event) => setPlaylistUrl(event.target.value)}
						placeholder={t`https://example.com/playlist.m3u8`}
						disabled={isBusy}
						leftIcon={<LinkIcon size={18} weight="bold" />}
					/>
					<div className={styles.actions}>
						<Button onClick={handleSaveUrl} disabled={!canSaveUrl} submitting={isBusy} fitContent compact>
							<Trans>Save URL</Trans>
						</Button>
						<Button onClick={handleUploadClick} disabled={isBusy} fitContent compact>
							<UploadSimpleIcon size={16} weight="bold" />
							<Trans>Upload Local Playlist</Trans>
						</Button>
						<Button onClick={handleRemove} disabled={isBusy} fitContent compact variant="secondary">
							<TrashIcon size={16} weight="bold" />
							<Trans>Remove Playlist</Trans>
						</Button>
					</div>
					<input
						ref={fileInputRef}
						type="file"
						accept=".m3u,.m3u8,text/plain"
						className={styles.hiddenInput}
						onChange={handleFileChange}
					/>
					{statusText && <p className={styles.successText}>{statusText}</p>}
					{errorText && <p className={styles.errorText}>{errorText}</p>}
				</div>
			</Modal.Content>
		</Modal.Root>
	);
}
