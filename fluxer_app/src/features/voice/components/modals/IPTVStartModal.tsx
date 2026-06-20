// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import {Input} from '@app/features/ui/components/form/FormInput';
import * as IPTVCommands from '@app/features/voice/commands/IPTVCommands';
import {IPTVChannelPickerModal} from '@app/features/voice/components/modals/IPTVChannelPickerModal';
import styles from '@app/features/voice/components/modals/IPTVStartModal.module.css';
import {Trans, useLingui} from '@lingui/react/macro';
import {LinkIcon, ListIcon, PlayIcon} from '@phosphor-icons/react';
import {useMemo, useState} from 'react';

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

interface IPTVStartModalProps {
	channelId: string;
	onStarted: () => Promise<void>;
}

export function IPTVStartModal({channelId, onStarted}: IPTVStartModalProps) {
	const {i18n} = useLingui();
	const [directUrl, setDirectUrl] = useState('');
	const [isBusy, setIsBusy] = useState(false);
	const [errorText, setErrorText] = useState<string | null>(null);

	const canStartDirect = useMemo(() => directUrl.trim().length > 0 && !isBusy, [directUrl, isBusy]);

	const handleStartDirect = () => {
		if (!canStartDirect) return;
		setErrorText(null);
		setIsBusy(true);
		void IPTVCommands.startIPTVDirect({
			channelId,
			sourceUrl: directUrl.trim(),
		})
			.then(async () => {
				await onStarted();
				ModalCommands.pop();
			})
			.catch((error) => {
				setErrorText(getApiErrorMessage(error));
			})
			.finally(() => {
				setIsBusy(false);
			});
	};

	const handleStartFromPlaylist = () => {
		if (isBusy) return;
		setErrorText(null);
		setIsBusy(true);
		void (async () => {
			const config = await IPTVCommands.getIPTVPlaylistConfig(channelId);
			if (!config.hasPlaylist) {
				throw new Error('No server playlist configured.');
			}

			const channels = await IPTVCommands.listConfiguredIPTVChannels({
				channelId,
				limit: 5000,
			});

			if (channels.length === 0) {
				throw new Error('No channels found in server playlist.');
			}

			ModalCommands.push(
				modal(() => (
					<IPTVChannelPickerModal
						channels={channels}
						onSelect={async (selected) => {
							await IPTVCommands.startIPTVFromConfiguredPlaylist({
								channelId,
								channelName: selected.name,
								streamName: selected.name,
							});
							await onStarted();
							ModalCommands.popByType(IPTVStartModal);
							ModalCommands.popByType(IPTVChannelPickerModal);
						}}
					/>
				)),
			);
		})()
			.catch((error) => {
				setErrorText(getApiErrorMessage(error));
			})
			.finally(() => {
				setIsBusy(false);
			});
	};

	return (
		<Modal.Root size="small" centered data-flx="voice.iptv-start-modal.modal-root">
			<Modal.Header title={i18n._('Start IPTV Stream')} data-flx="voice.iptv-start-modal.modal-header">
				<p className={styles.subtitle} data-flx="voice.iptv-start-modal.subtitle">
					<Trans>Choose direct URL or start from the server playlist</Trans>
				</p>
			</Modal.Header>
			<Modal.Content data-flx="voice.iptv-start-modal.modal-content">
				<div className={styles.content} data-flx="voice.iptv-start-modal.content">
					<div className={styles.section} data-flx="voice.iptv-start-modal.direct-section">
						<div className={styles.sectionTitleRow} data-flx="voice.iptv-start-modal.direct-title-row">
							<LinkIcon size={16} weight="bold" />
							<span className={styles.sectionTitle}>{i18n._('Direct URL')}</span>
						</div>
						<Input
							type="text"
							value={directUrl}
							onChange={(event) => setDirectUrl(event.target.value)}
							placeholder={i18n._('https://example.com/live.m3u8')}
							disabled={isBusy}
							leftIcon={<PlayIcon size={16} weight="bold" />}
							data-flx="voice.iptv-start-modal.direct-url-input"
						/>
						<Button
							onClick={handleStartDirect}
							disabled={!canStartDirect}
							submitting={isBusy}
							fitContent
							compact
							data-flx="voice.iptv-start-modal.start-direct-button"
						>
							<Trans>Start from URL</Trans>
						</Button>
					</div>
					<div className={styles.section} data-flx="voice.iptv-start-modal.playlist-section">
						<div className={styles.sectionTitleRow} data-flx="voice.iptv-start-modal.playlist-title-row">
							<ListIcon size={16} weight="bold" />
							<span className={styles.sectionTitle}>{i18n._('Server Playlist')}</span>
						</div>
						<Button
							onClick={handleStartFromPlaylist}
							disabled={isBusy}
							fitContent
							compact
							data-flx="voice.iptv-start-modal.browse-playlist-button"
						>
							<Trans>Browse Playlist Channels</Trans>
						</Button>
					</div>
					{errorText && (
						<p className={styles.errorText} data-flx="voice.iptv-start-modal.error-text">
							{errorText}
						</p>
					)}
				</div>
			</Modal.Content>
		</Modal.Root>
	);
}
