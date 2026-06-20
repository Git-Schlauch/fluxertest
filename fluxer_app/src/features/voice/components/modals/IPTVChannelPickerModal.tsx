// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import selectorStyles from '@app/features/app/components/dialogs/shared/SelectorModalStyles.module.css';
import {Input} from '@app/features/ui/components/form/FormInput';
import {Scroller} from '@app/features/ui/components/Scroller';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import type {IPTVConfiguredChannel} from '@app/features/voice/commands/IPTVCommands';
import styles from '@app/features/voice/components/modals/IPTVChannelPickerModal.module.css';
import {Trans, useLingui} from '@lingui/react/macro';
import {clsx} from 'clsx';
import {MagnifyingGlassIcon, MonitorPlayIcon} from '@phosphor-icons/react';
import {useMemo, useState} from 'react';

function getErrorMessage(error: unknown): string {
	if (error && typeof error === 'object') {
		const body = (error as {body?: {message?: string}}).body;
		if (body?.message && body.message.trim().length > 0) {
			return body.message;
		}
		const message = (error as {message?: string}).message;
		if (message && message.trim().length > 0) {
			return message;
		}
	}

	return 'Failed to start IPTV stream.';
}

interface IPTVChannelPickerModalProps {
	channels: Array<IPTVConfiguredChannel>;
	onSelect: (channel: IPTVConfiguredChannel) => Promise<void>;
}

export function IPTVChannelPickerModal({channels, onSelect}: IPTVChannelPickerModalProps) {
	const {i18n} = useLingui();
	const [query, setQuery] = useState('');
	const [isStarting, setIsStarting] = useState(false);
	const [selectedName, setSelectedName] = useState<string | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const filteredChannels = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		if (normalized.length === 0) {
			return channels;
		}
		return channels.filter((channel) => {
			const name = channel.name.toLowerCase();
			const group = (channel.group ?? '').toLowerCase();
			return name.includes(normalized) || group.includes(normalized);
		});
	}, [channels, query]);

	return (
		<Modal.Root size="small" centered data-flx="voice.iptv-channel-picker-modal.modal-root">
			<Modal.Header title={i18n._('Choose IPTV Channel')} data-flx="voice.iptv-channel-picker-modal.modal-header">
				<p className={selectorStyles.subtitle} data-flx="voice.iptv-channel-picker-modal.subtitle">
					<Trans>{channels.length} channels available</Trans>
				</p>
				<div className={selectorStyles.headerSearch} data-flx="voice.iptv-channel-picker-modal.header-search">
					<Input
						type="text"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={i18n._('Search channels')}
						maxLength={200}
						leftIcon={<MagnifyingGlassIcon className={selectorStyles.searchIcon} weight="bold" />}
						className={selectorStyles.headerSearchInput}
						data-flx="voice.iptv-channel-picker-modal.search-input"
					/>
				</div>
				{errorMessage && (
					<p className={styles.errorMessage} data-flx="voice.iptv-channel-picker-modal.error-message">
						{errorMessage}
					</p>
				)}
			</Modal.Header>
			<Modal.Content
				className={selectorStyles.selectorContent}
				data-flx="voice.iptv-channel-picker-modal.modal-content"
			>
				<div className={selectorStyles.listContainer} data-flx="voice.iptv-channel-picker-modal.list-container">
					<Scroller
						className={selectorStyles.scroller}
						key="iptv-channel-picker-scroller"
						fade={false}
						data-flx="voice.iptv-channel-picker-modal.scroller"
					>
						{filteredChannels.length === 0 ? (
							<div className={selectorStyles.emptyState} data-flx="voice.iptv-channel-picker-modal.empty-state">
								<Trans>No channels found</Trans>
							</div>
						) : (
							<div className={selectorStyles.itemList} data-flx="voice.iptv-channel-picker-modal.item-list">
								{filteredChannels.map((channel) => {
									const isSelected = selectedName === channel.name;
									return (
										<FocusRing key={`${channel.name}:${channel.url}`} offset={-2}>
											<button
												type="button"
												className={clsx(
													selectorStyles.itemButton,
													isSelected && selectorStyles.itemButtonSelected,
													isStarting && isSelected && styles.itemStarting,
												)}
												disabled={isStarting}
												onClick={() => {
													setSelectedName(channel.name);
													setErrorMessage(null);
													setIsStarting(true);
													void onSelect(channel)
														.catch((error: unknown) => {
															setErrorMessage(getErrorMessage(error));
														})
														.finally(() => {
															setIsStarting(false);
														});
												}}
												data-flx="voice.iptv-channel-picker-modal.channel-button"
											>
												<div className={selectorStyles.itemContent} data-flx="voice.iptv-channel-picker-modal.item">
													<MonitorPlayIcon className={selectorStyles.itemIcon} weight="fill" />
													<div className={selectorStyles.itemInfo} data-flx="voice.iptv-channel-picker-modal.item-info">
														<span className={selectorStyles.itemName} data-flx="voice.iptv-channel-picker-modal.item-name">
															{channel.name}
														</span>
														{channel.group && (
															<span
																className={selectorStyles.itemSecondary}
																data-flx="voice.iptv-channel-picker-modal.item-group"
															>
																{channel.group}
															</span>
														)}
													</div>
													{isStarting && isSelected && (
														<span className={styles.selectedBadge} data-flx="voice.iptv-channel-picker-modal.starting">
															<Trans>Starting...</Trans>
														</span>
													)}
												</div>
											</button>
										</FocusRing>
									);
								})}
							</div>
						)}
					</Scroller>
				</div>
			</Modal.Content>
		</Modal.Root>
	);
}
