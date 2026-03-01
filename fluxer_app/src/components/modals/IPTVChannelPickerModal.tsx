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

import type {IPTVConfiguredChannel} from '@app/actions/IPTVActionCreators';
import * as ModalActionCreators from '@app/actions/ModalActionCreators';
import {Input} from '@app/components/form/Input';
import * as Modal from '@app/components/modals/Modal';
import selectorStyles from '@app/components/modals/shared/SelectorModalStyles.module.css';
import modalStyles from '@app/components/modals/IPTVChannelPickerModal.module.css';
import FocusRing from '@app/components/uikit/focus_ring/FocusRing';
import {Scroller} from '@app/components/uikit/Scroller';
import {MagnifyingGlassIcon, MonitorPlayIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {Trans, useLingui} from '@lingui/react/macro';
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
	const {t} = useLingui();
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
		<Modal.Root size="small" centered>
			<Modal.Header title={t`Choose IPTV Channel`}>
				<p className={selectorStyles.subtitle}>
					<Trans>{channels.length} channels available</Trans>
				</p>
				<div className={selectorStyles.headerSearch}>
					<Input
						type="text"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={t`Search channels`}
						maxLength={200}
						leftIcon={<MagnifyingGlassIcon className={selectorStyles.searchIcon} weight="bold" />}
						className={selectorStyles.headerSearchInput}
					/>
				</div>
				{errorMessage && <p className={modalStyles.errorMessage}>{errorMessage}</p>}
			</Modal.Header>
			<Modal.Content className={selectorStyles.selectorContent}>
				<div className={selectorStyles.listContainer}>
					<Scroller className={selectorStyles.scroller} key="iptv-channel-picker-scroller" fade={false}>
						{filteredChannels.length === 0 ? (
							<div className={selectorStyles.emptyState}>
								<Trans>No channels found</Trans>
							</div>
						) : (
							<div className={selectorStyles.itemList}>
								{filteredChannels.map((channel) => {
									const isSelected = selectedName === channel.name;
									return (
										<FocusRing key={`${channel.name}:${channel.url}`} offset={-2}>
											<button
												type="button"
												className={clsx(
													selectorStyles.itemButton,
													isSelected && selectorStyles.itemButtonSelected,
													isStarting && isSelected && modalStyles.itemStarting,
												)}
												disabled={isStarting}
												onClick={() => {
													setSelectedName(channel.name);
													setErrorMessage(null);
													setIsStarting(true);
													window.setTimeout(() => {
														void onSelect(channel)
															.then(() => {
																ModalActionCreators.pop();
															})
															.catch((error: unknown) => {
																setErrorMessage(getErrorMessage(error));
															})
															.finally(() => {
																setIsStarting(false);
															});
													}, 140);
												}}
											>
												<div className={selectorStyles.itemContent}>
													<MonitorPlayIcon className={selectorStyles.itemIcon} weight="fill" />
													<div className={selectorStyles.itemInfo}>
														<span className={selectorStyles.itemName}>{channel.name}</span>
														{channel.group && <span className={selectorStyles.itemSecondary}>{channel.group}</span>}
													</div>
													{isStarting && isSelected && (
														<span className={modalStyles.selectedBadge}>
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
