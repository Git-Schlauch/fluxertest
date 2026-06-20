// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import {Button} from '@app/features/ui/button/Button';
import {Input} from '@app/features/ui/components/form/FormInput';
import * as IPTVCommands from '@app/features/voice/commands/IPTVCommands';
import styles from '@app/features/voice/components/modals/IPTVPlaylistConfigModal.module.css';
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
	const {i18n} = useLingui();
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [playlistUrl, setPlaylistUrl] = useState('');
	const [statusText, setStatusText] = useState<string | null>(null);
	const [errorText, setErrorText] = useState<string | null>(null);
	const [isBusy, setIsBusy] = useState(false);
	const [sourceLabel, setSourceLabel] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void IPTVCommands.getIPTVPlaylistConfig(channelId)
			.then((config) => {
				if (cancelled) return;
				setPlaylistUrl(config.playlistUrl ?? '');
				if (!config.hasPlaylist) {
					setSourceLabel(i18n._('No playlist configured'));
				} else if (config.source === 'url') {
					setSourceLabel(i18n._('Current source: URL'));
				} else {
					setSourceLabel(i18n._('Current source: Local upload'));
				}
			})
			.catch(() => {
				if (cancelled) return;
				setSourceLabel(i18n._('Could not load current playlist status'));
			});
		return () => {
			cancelled = true;
		};
	}, [channelId, i18n]);

	const canSaveUrl = useMemo(() => playlistUrl.trim().length > 0 && !isBusy, [playlistUrl, isBusy]);

	const handleSaveUrl = () => {
		if (!canSaveUrl) return;
		setErrorText(null);
		setStatusText(null);
		setIsBusy(true);
		void IPTVCommands.setIPTVPlaylistConfig({
			channelId,
			playlistUrl: playlistUrl.trim(),
		})
			.then(() => {
				setSourceLabel(i18n._('Current source: URL'));
				setStatusText(i18n._('Playlist URL saved.'));
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
		void IPTVCommands.uploadIPTVPlaylistConfigFile({
			channelId,
			file,
		})
			.then(() => {
				setSourceLabel(i18n._('Current source: Local upload'));
				setStatusText(i18n._('Playlist uploaded.'));
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
		void IPTVCommands.clearIPTVPlaylistConfig(channelId)
			.then(() => {
				setSourceLabel(i18n._('No playlist configured'));
				setStatusText(i18n._('Playlist removed.'));
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
		<Modal.Root size="small" centered data-flx="voice.iptv-playlist-config-modal.modal-root">
			<Modal.Header title={i18n._('IPTV Playlist')} data-flx="voice.iptv-playlist-config-modal.modal-header">
				<p className={styles.subtitle} data-flx="voice.iptv-playlist-config-modal.subtitle">
					<Trans>Configure server playlist source (URL or local M3U file)</Trans>
				</p>
				{sourceLabel && (
					<p className={styles.sourceLabel} data-flx="voice.iptv-playlist-config-modal.source-label">
						{sourceLabel}
					</p>
				)}
			</Modal.Header>
			<Modal.Content data-flx="voice.iptv-playlist-config-modal.modal-content">
				<div className={styles.content} data-flx="voice.iptv-playlist-config-modal.content">
					<Input
						type="text"
						value={playlistUrl}
						onChange={(event) => setPlaylistUrl(event.target.value)}
						placeholder={i18n._('https://example.com/playlist.m3u8')}
						disabled={isBusy}
						leftIcon={<LinkIcon size={18} weight="bold" />}
						data-flx="voice.iptv-playlist-config-modal.playlist-url-input"
					/>
					<div className={styles.actions} data-flx="voice.iptv-playlist-config-modal.actions">
						<Button
							onClick={handleSaveUrl}
							disabled={!canSaveUrl}
							submitting={isBusy}
							fitContent
							compact
							data-flx="voice.iptv-playlist-config-modal.save-url-button"
						>
							<Trans>Save URL</Trans>
						</Button>
						<Button
							onClick={handleUploadClick}
							disabled={isBusy}
							fitContent
							compact
							leftIcon={<UploadSimpleIcon size={16} weight="bold" />}
							data-flx="voice.iptv-playlist-config-modal.upload-button"
						>
							<Trans>Upload Local Playlist</Trans>
						</Button>
						<Button
							onClick={handleRemove}
							disabled={isBusy}
							fitContent
							compact
							variant="secondary"
							leftIcon={<TrashIcon size={16} weight="bold" />}
							data-flx="voice.iptv-playlist-config-modal.remove-button"
						>
							<Trans>Remove Playlist</Trans>
						</Button>
					</div>
					<input
						ref={fileInputRef}
						type="file"
						accept=".m3u,.m3u8,text/plain"
						className={styles.hiddenInput}
						onChange={handleFileChange}
						data-flx="voice.iptv-playlist-config-modal.file-input"
					/>
					{statusText && (
						<p className={styles.successText} data-flx="voice.iptv-playlist-config-modal.success-text">
							{statusText}
						</p>
					)}
					{errorText && (
						<p className={styles.errorText} data-flx="voice.iptv-playlist-config-modal.error-text">
							{errorText}
						</p>
					)}
				</div>
			</Modal.Content>
		</Modal.Root>
	);
}
