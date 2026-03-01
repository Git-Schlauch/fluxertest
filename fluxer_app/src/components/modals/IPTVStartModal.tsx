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
import * as ModalActionCreators from '@app/actions/ModalActionCreators';
import {modal} from '@app/actions/ModalActionCreators';
import {Input} from '@app/components/form/Input';
import {IPTVChannelPickerModal} from '@app/components/modals/IPTVChannelPickerModal';
import * as Modal from '@app/components/modals/Modal';
import styles from '@app/components/modals/IPTVStartModal.module.css';
import {Button} from '@app/components/uikit/button/Button';
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
	const {t} = useLingui();
	const [directUrl, setDirectUrl] = useState('');
	const [isBusy, setIsBusy] = useState(false);
	const [errorText, setErrorText] = useState<string | null>(null);

	const canStartDirect = useMemo(() => directUrl.trim().length > 0 && !isBusy, [directUrl, isBusy]);

	const handleStartDirect = () => {
		if (!canStartDirect) return;
		setErrorText(null);
		setIsBusy(true);
		void IPTVActionCreators.startIPTVDirect({
			channelId,
			sourceUrl: directUrl.trim(),
		})
			.then(async () => {
				await onStarted();
				ModalActionCreators.pop();
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
			const config = await IPTVActionCreators.getIPTVPlaylistConfig(channelId);
			if (!config.hasPlaylist) {
				throw new Error(t`No server playlist configured.`);
			}

			const channels = await IPTVActionCreators.listConfiguredIPTVChannels({
				channelId,
				limit: 5000,
			});

			if (channels.length === 0) {
				throw new Error(t`No channels found in server playlist.`);
			}

			ModalActionCreators.push(
				modal(() => (
						<IPTVChannelPickerModal
							channels={channels}
							onSelect={async (selected) => {
								await IPTVActionCreators.startIPTVFromConfiguredPlaylist({
									channelId,
									channelName: selected.name,
									streamName: selected.name,
								});
								await onStarted();
								ModalActionCreators.popByType(IPTVStartModal);
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
		<Modal.Root size="small" centered>
			<Modal.Header title={t`Start IPTV Stream`}>
				<p className={styles.subtitle}>
					<Trans>Choose direct URL or start from the server playlist</Trans>
				</p>
			</Modal.Header>
			<Modal.Content>
				<div className={styles.content}>
					<div className={styles.section}>
						<div className={styles.sectionTitleRow}>
							<LinkIcon size={16} weight="bold" />
							<span className={styles.sectionTitle}>{t`Direct URL`}</span>
						</div>
						<Input
							type="text"
							value={directUrl}
							onChange={(event) => setDirectUrl(event.target.value)}
							placeholder={t`https://example.com/live.m3u8`}
							disabled={isBusy}
							leftIcon={<PlayIcon size={16} weight="bold" />}
						/>
						<Button onClick={handleStartDirect} disabled={!canStartDirect} submitting={isBusy} fitContent compact>
							<Trans>Start from URL</Trans>
						</Button>
					</div>
					<div className={styles.section}>
						<div className={styles.sectionTitleRow}>
							<ListIcon size={16} weight="bold" />
							<span className={styles.sectionTitle}>{t`Server Playlist`}</span>
						</div>
						<Button onClick={handleStartFromPlaylist} disabled={isBusy} fitContent compact>
							<Trans>Browse Playlist Channels</Trans>
						</Button>
					</div>
					{errorText && <p className={styles.errorText}>{errorText}</p>}
				</div>
			</Modal.Content>
		</Modal.Root>
	);
}
