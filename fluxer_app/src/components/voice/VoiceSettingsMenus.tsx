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

import * as CallActionCreators from '@app/actions/CallActionCreators';
import * as IPTVActionCreators from '@app/actions/IPTVActionCreators';
import * as ModalActionCreators from '@app/actions/ModalActionCreators';
import {modal} from '@app/actions/ModalActionCreators';
import * as VoiceCallLayoutActionCreators from '@app/actions/VoiceCallLayoutActionCreators';
import * as VoiceSettingsActionCreators from '@app/actions/VoiceSettingsActionCreators';
import * as VoiceStateActionCreators from '@app/actions/VoiceStateActionCreators';
import {GenericErrorModal} from '@app/components/alerts/GenericErrorModal';
import {CameraPreviewModalInRoom} from '@app/components/modals/CameraPreviewModal';
import {HideOwnCameraConfirmModal} from '@app/components/modals/HideOwnCameraConfirmModal';
import {IPTVPlaylistConfigModal} from '@app/components/modals/IPTVPlaylistConfigModal';
import {IPTVStartModal} from '@app/components/modals/IPTVStartModal';
import {UserSettingsModal} from '@app/components/modals/UserSettingsModal';
import {CheckboxItem} from '@app/components/uikit/context_menu/ContextMenu';
import {MenuGroup} from '@app/components/uikit/context_menu/MenuGroup';
import {MenuItem} from '@app/components/uikit/context_menu/MenuItem';
import {MenuItemRadio} from '@app/components/uikit/context_menu/MenuItemRadio';
import {MenuItemSlider} from '@app/components/uikit/context_menu/MenuItemSlider';
import {MenuItemSubmenu} from '@app/components/uikit/context_menu/MenuItemSubmenu';
import styles from '@app/components/voice/VoiceSettingsMenus.module.css';
import {Logger} from '@app/lib/Logger';
import CallStateStore from '@app/stores/CallStateStore';
import ParticipantVolumeStore, {getIptvParticipantAudioKey} from '@app/stores/ParticipantVolumeStore';
import PermissionStore from '@app/stores/PermissionStore';
import VoiceCallLayoutStore from '@app/stores/VoiceCallLayoutStore';
import VoicePromptsStore from '@app/stores/VoicePromptsStore';
import VoiceSettingsStore from '@app/stores/VoiceSettingsStore';
import MediaEngineStore from '@app/stores/voice/MediaEngineFacade';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import {hasDeviceLabels, resolveEffectiveDeviceId} from '@app/utils/VoiceDeviceManager';
import type {RtcRegionResponse} from '@fluxer/schema/src/domains/channel/ChannelSchemas';
import {Trans, useLingui} from '@lingui/react/macro';
import {
	CameraIcon,
	GearIcon,
	GridFourIcon,
	MicrophoneIcon,
	MonitorPlayIcon,
	SpeakerHighIcon,
	SpeakerSimpleSlashIcon,
	SpeakerSlashIcon,
	UsersIcon,
	VideoIcon,
} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useMemo, useState} from 'react';

const logger = new Logger('VoiceSettingsMenus');

interface VoiceAudioSettingsMenuProps {
	inputDevices: Array<MediaDeviceInfo>;
	outputDevices: Array<MediaDeviceInfo>;
	onClose: () => void;
}

export const VoiceAudioSettingsMenu: React.FC<VoiceAudioSettingsMenuProps> = observer(
	({inputDevices, outputDevices, onClose}) => {
		const {t} = useLingui();

		const voiceSettings = VoiceSettingsStore;
		const voiceState = MediaEngineStore.getCurrentUserVoiceState();
		const isDeafened = voiceState?.self_deaf ?? false;

		const handleToggleDeafen = useCallback((_checked: boolean) => {
			VoiceStateActionCreators.toggleSelfDeaf(null);
		}, []);

		const effectiveInputDeviceId = resolveEffectiveDeviceId(voiceSettings.inputDeviceId, inputDevices);
		const effectiveOutputDeviceId = resolveEffectiveDeviceId(voiceSettings.outputDeviceId, outputDevices);
		const inputHasLabels = hasDeviceLabels(inputDevices);
		const outputHasLabels = hasDeviceLabels(outputDevices);

		return (
			<>
				<MenuGroup>
					<MenuItemSubmenu
						label={t`Input Device`}
						icon={<MicrophoneIcon weight="fill" className={styles.icon} />}
						render={() => (
							<>
								{inputHasLabels ? (
									inputDevices.map((device) => (
										<MenuItemRadio
											key={device.deviceId}
											selected={effectiveInputDeviceId === device.deviceId}
											onSelect={() => {
												VoiceSettingsActionCreators.update({inputDeviceId: device.deviceId});
											}}
										>
											{device.label || t`Microphone ${device.deviceId.slice(0, 8)}`}
										</MenuItemRadio>
									))
								) : (
									<MenuItemRadio key="default" selected={true} onSelect={() => {}}>
										{t`Default`}
									</MenuItemRadio>
								)}
							</>
						)}
					/>

					<MenuItemSubmenu
						label={t`Output Device`}
						icon={<SpeakerHighIcon weight="fill" className={styles.icon} />}
						render={() => (
							<>
								{outputHasLabels ? (
									outputDevices.map((device) => (
										<MenuItemRadio
											key={device.deviceId}
											selected={effectiveOutputDeviceId === device.deviceId}
											onSelect={() => {
												VoiceSettingsActionCreators.update({outputDeviceId: device.deviceId});
											}}
										>
											{device.label || t`Speaker ${device.deviceId.slice(0, 8)}`}
										</MenuItemRadio>
									))
								) : (
									<MenuItemRadio key="default" selected={true} onSelect={() => {}}>
										{t`Default`}
									</MenuItemRadio>
								)}
							</>
						)}
					/>
				</MenuGroup>

				<MenuGroup>
					<MenuItemSlider
						label={t`Input Volume`}
						value={voiceSettings.inputVolume}
						minValue={0}
						maxValue={100}
						onChange={(value: number) => VoiceSettingsActionCreators.update({inputVolume: value})}
						onFormat={(value) => `${Math.round(value)}%`}
					/>
					<MenuItemSlider
						label={t`Output Volume`}
						value={voiceSettings.outputVolume}
						minValue={0}
						maxValue={100}
						onChange={(value: number) => VoiceSettingsActionCreators.update({outputVolume: value})}
						onFormat={(value) => `${Math.round(value)}%`}
					/>
				</MenuGroup>

				<MenuGroup>
					<CheckboxItem
						icon={<SpeakerSimpleSlashIcon weight="fill" className={styles.icon} />}
						checked={voiceSettings.echoCancellation}
						onCheckedChange={(checked) => VoiceSettingsActionCreators.update({echoCancellation: checked})}
					>
						<Trans>Echo Cancellation</Trans>
					</CheckboxItem>

					<CheckboxItem
						icon={<SpeakerSimpleSlashIcon weight="fill" className={styles.icon} />}
						checked={voiceSettings.noiseSuppression}
						onCheckedChange={(checked) => VoiceSettingsActionCreators.update({noiseSuppression: checked})}
					>
						<Trans>Noise Suppression</Trans>
					</CheckboxItem>

					<CheckboxItem
						icon={<MicrophoneIcon weight="fill" className={styles.icon} />}
						checked={voiceSettings.autoGainControl}
						onCheckedChange={(checked) => VoiceSettingsActionCreators.update({autoGainControl: checked})}
					>
						<Trans>Auto Gain Control</Trans>
					</CheckboxItem>
				</MenuGroup>

				<MenuGroup>
					<CheckboxItem
						icon={<SpeakerSlashIcon weight="fill" className={styles.icon} />}
						checked={isDeafened}
						onCheckedChange={handleToggleDeafen}
					>
						<Trans>Deafen</Trans>
					</CheckboxItem>
				</MenuGroup>

				<MenuGroup>
					<MenuItem
						icon={<GearIcon weight="fill" className={styles.icon} />}
						onClick={() => {
							onClose();
							ModalActionCreators.push(modal(() => <UserSettingsModal initialTab="voice_video" />));
						}}
					>
						<Trans>Voice Settings</Trans>
					</MenuItem>
				</MenuGroup>
			</>
		);
	},
);

interface VoiceDeviceSettingsMenuProps {
	devices: Array<MediaDeviceInfo>;
	deviceType: 'input' | 'output';
	onClose: () => void;
}

export const VoiceDeviceSettingsMenu: React.FC<VoiceDeviceSettingsMenuProps> = observer(
	({devices, deviceType, onClose}) => {
		const {t} = useLingui();

		const voiceSettings = VoiceSettingsStore;

		const isInput = deviceType === 'input';
		const deviceIdKey = isInput ? 'inputDeviceId' : 'outputDeviceId';
		const volumeKey = isInput ? 'inputVolume' : 'outputVolume';

		const storedDeviceId = voiceSettings[deviceIdKey];
		const currentVolume = voiceSettings[volumeKey];

		const effectiveDeviceId = resolveEffectiveDeviceId(storedDeviceId, devices);
		const devicesHaveLabels = hasDeviceLabels(devices);

		const menuLabel = isInput ? t`Input Device` : t`Output Device`;
		const volumeLabel = isInput ? t`Input Volume` : t`Output Volume`;
		const Icon = isInput ? MicrophoneIcon : SpeakerHighIcon;

		const defaultDeviceName = isInput
			? (deviceId: string) => t`Microphone ${deviceId.slice(0, 8)}`
			: (deviceId: string) => t`Speaker ${deviceId.slice(0, 8)}`;

		return (
			<>
				<MenuGroup>
					<MenuItemSubmenu
						label={menuLabel}
						icon={<Icon weight="fill" className={styles.icon} />}
						render={() => (
							<>
								{devicesHaveLabels ? (
									devices.map((device) => (
										<MenuItemRadio
											key={device.deviceId}
											selected={effectiveDeviceId === device.deviceId}
											onSelect={() => {
												VoiceSettingsActionCreators.update({[deviceIdKey]: device.deviceId});
											}}
										>
											{device.label || defaultDeviceName(device.deviceId)}
										</MenuItemRadio>
									))
								) : (
									<MenuItemRadio key="default" selected={true} onSelect={() => {}}>
										{t`Default`}
									</MenuItemRadio>
								)}
							</>
						)}
					/>
				</MenuGroup>

				<MenuGroup>
					<MenuItemSlider
						label={volumeLabel}
						value={currentVolume}
						minValue={0}
						maxValue={100}
						onChange={(value: number) => VoiceSettingsActionCreators.update({[volumeKey]: value})}
						onFormat={(value) => `${Math.round(value)}%`}
					/>
				</MenuGroup>

				<MenuGroup>
					<MenuItem
						icon={<GearIcon weight="fill" className={styles.icon} />}
						onClick={() => {
							onClose();
							ModalActionCreators.push(modal(() => <UserSettingsModal initialTab="voice_video" />));
						}}
					>
						<Trans>Voice Settings</Trans>
					</MenuItem>
				</MenuGroup>
			</>
		);
	},
);

interface VoiceInputSettingsMenuProps {
	inputDevices: Array<MediaDeviceInfo>;
	onClose: () => void;
}

export const VoiceInputSettingsMenu: React.FC<VoiceInputSettingsMenuProps> = observer(({inputDevices, onClose}) => {
	return <VoiceDeviceSettingsMenu devices={inputDevices} deviceType="input" onClose={onClose} />;
});

interface VoiceOutputSettingsMenuProps {
	outputDevices: Array<MediaDeviceInfo>;
	onClose: () => void;
}

export const VoiceOutputSettingsMenu: React.FC<VoiceOutputSettingsMenuProps> = observer(({outputDevices, onClose}) => {
	return <VoiceDeviceSettingsMenu devices={outputDevices} deviceType="output" onClose={onClose} />;
});

interface VoiceCameraSettingsMenuProps {
	videoDevices: Array<MediaDeviceInfo>;
	onClose: () => void;
}

export const VoiceCameraSettingsMenu: React.FC<VoiceCameraSettingsMenuProps> = observer(({videoDevices, onClose}) => {
	const {t} = useLingui();

	const voiceSettings = VoiceSettingsStore;
	const effectiveVideoDeviceId = resolveEffectiveDeviceId(voiceSettings.videoDeviceId, videoDevices);
	const devicesHaveLabels = hasDeviceLabels(videoDevices);

	return (
		<>
			<MenuGroup>
				<MenuItemSubmenu
					label={t`Camera`}
					icon={<CameraIcon weight="fill" className={styles.icon} />}
					render={() => (
						<>
							{devicesHaveLabels ? (
								videoDevices.map((device) => (
									<MenuItemRadio
										key={device.deviceId}
										selected={effectiveVideoDeviceId === device.deviceId}
										onSelect={() => {
											VoiceSettingsActionCreators.update({videoDeviceId: device.deviceId});
										}}
									>
										{device.label || t`Camera ${device.deviceId.slice(0, 8)}`}
									</MenuItemRadio>
								))
							) : (
								<MenuItemRadio key="default" selected={true} onSelect={() => {}}>
									{t`Default`}
								</MenuItemRadio>
							)}
						</>
					)}
				/>
			</MenuGroup>

			<MenuGroup>
				<MenuItem
					icon={<VideoIcon weight="fill" className={styles.icon} />}
					onClick={() => {
						onClose();
						ModalActionCreators.push(modal(() => <CameraPreviewModalInRoom />));
					}}
				>
					<Trans>Preview Camera</Trans>
				</MenuItem>
			</MenuGroup>

			<MenuGroup>
				<MenuItem
					icon={<GearIcon weight="fill" className={styles.icon} />}
					onClick={() => {
						onClose();
						ModalActionCreators.push(modal(() => <UserSettingsModal initialTab="voice_video" />));
					}}
				>
					<Trans>Video Settings</Trans>
				</MenuItem>
			</MenuGroup>
		</>
	);
});

interface VoiceMoreOptionsMenuProps {
	onClose: () => void;
}

export const VoiceMoreOptionsMenu: React.FC<VoiceMoreOptionsMenuProps> = observer(({onClose}) => {
	const {t} = useLingui();
	const voiceSettings = VoiceSettingsStore;
	const layoutMode = VoiceCallLayoutStore.layoutMode;
	const isGrid = layoutMode === 'grid';
	const connectedChannelId = MediaEngineStore.channelId;
	const connectedGuildId = MediaEngineStore.guildId ?? null;
	const isGuildVoiceCall = connectedChannelId != null && (MediaEngineStore.guildId ?? null) !== null;
	const isDmVoiceCall = connectedChannelId != null && (MediaEngineStore.guildId ?? null) === null;
	const canManageGuild =
		isGuildVoiceCall && connectedGuildId
			? PermissionStore.can(Permissions.MANAGE_GUILD, {guildId: connectedGuildId})
			: false;
	const canManageChannels =
		isGuildVoiceCall && connectedGuildId
			? PermissionStore.can(Permissions.MANAGE_CHANNELS, {guildId: connectedGuildId})
			: false;
	const canManageIptvPlaylist = canManageGuild || canManageChannels;
	const currentRegion =
		isDmVoiceCall && connectedChannelId ? (CallStateStore.getCall(connectedChannelId)?.region ?? null) : null;
	const [regions, setRegions] = useState<Array<RtcRegionResponse>>([]);
	const [isChangingRegion, setIsChangingRegion] = useState(false);
	const [iptvStatus, setIptvStatus] = useState<IPTVActionCreators.IPTVStatus | null>(null);
	const [isUpdatingIptv, setIsUpdatingIptv] = useState(false);
	const iptvAudioKey = connectedChannelId ? getIptvParticipantAudioKey(connectedChannelId) : null;
	const iptvMuted = iptvAudioKey ? ParticipantVolumeStore.isLocalMuted(iptvAudioKey) : false;

	useEffect(() => {
		if (!isDmVoiceCall || !connectedChannelId) {
			setRegions([]);
			return undefined;
		}

		let cancelled = false;
		void CallActionCreators.fetchCallRegions(connectedChannelId)
			.then((fetchedRegions) => {
				if (!cancelled) {
					setRegions(fetchedRegions);
				}
			})
			.catch((error) => {
				logger.error('Failed to fetch DM call regions for more options menu:', error);
				if (!cancelled) {
					setRegions([]);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [connectedChannelId, isDmVoiceCall]);

	useEffect(() => {
		if (!isGuildVoiceCall || !connectedChannelId) {
			setIptvStatus(null);
			return undefined;
		}

		let cancelled = false;
		void IPTVActionCreators.getIPTVStatus(connectedChannelId)
			.then((status) => {
				if (!cancelled) {
					setIptvStatus(status);
				}
			})
			.catch((error) => {
				logger.error('Failed to fetch IPTV status for more options menu:', error);
				if (!cancelled) {
					setIptvStatus(null);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [connectedChannelId, isGuildVoiceCall]);

	const getRegionDisplayName = useCallback(
		(regionId: string, regionName: string): string => {
			if (regionName && regionName !== regionId) {
				return regionName;
			}
			if (regionId === 'us-east') {
				return t`US East`;
			}
			if (regionId === 'eu-central') {
				return t`EU Central`;
			}
			return regionId
				.split('-')
				.map((part) => {
					const lower = part.toLowerCase();
					if (lower === 'us') return 'US';
					if (lower === 'eu') return 'EU';
					return `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`;
				})
				.join(' ');
		},
		[t],
	);

	const regionHint = useMemo(() => {
		if (!currentRegion) return t`Automatic`;
		const matchedRegion = regions.find((region) => region.id === currentRegion);
		if (matchedRegion) {
			return getRegionDisplayName(matchedRegion.id, matchedRegion.name);
		}
		return currentRegion;
	}, [currentRegion, getRegionDisplayName, regions, t]);

	const handleRegionSelect = useCallback(
		(regionId: string | null) => {
			if (!connectedChannelId || isChangingRegion || currentRegion === regionId) {
				return;
			}

			setIsChangingRegion(true);
			void CallActionCreators.updateCallRegion(connectedChannelId, regionId)
				.catch((error) => {
					logger.error('Failed to update DM call region from more options menu:', error);
				})
				.finally(() => {
					setIsChangingRegion(false);
				});
		},
		[connectedChannelId, currentRegion, isChangingRegion],
	);

	const handleStartIptv = useCallback(() => {
		if (!connectedChannelId || isUpdatingIptv) {
			return;
		}
		ModalActionCreators.push(
			modal(() => (
				<IPTVStartModal
					channelId={connectedChannelId}
					onStarted={async () => {
						const status = await IPTVActionCreators.getIPTVStatus(connectedChannelId);
						setIptvStatus(status);
					}}
				/>
			)),
		);
	}, [connectedChannelId, isUpdatingIptv]);

	const handleStopIptv = useCallback(() => {
		if (!connectedChannelId || isUpdatingIptv) {
			return;
		}

		setIsUpdatingIptv(true);
		void IPTVActionCreators.stopIPTV(connectedChannelId)
			.then(async () => {
				const status = await IPTVActionCreators.getIPTVStatus(connectedChannelId);
				setIptvStatus(status);
			})
			.catch((error) => {
				logger.error('Failed to stop IPTV stream from more options menu:', error);
				onClose();
				ModalActionCreators.push(
					modal(() => (
						<GenericErrorModal
							title={t`Could not stop IPTV stream`}
							message={t`Try again while connected to the same voice channel.`}
						/>
					)),
				);
			})
			.finally(() => {
				setIsUpdatingIptv(false);
			});
	}, [connectedChannelId, isUpdatingIptv, onClose, t]);

	return (
		<>
			<MenuGroup>
				{isDmVoiceCall && (
					<MenuItemSubmenu
						label={t`Voice Region`}
						hint={regionHint}
						disabled={isChangingRegion}
						render={() => (
							<>
								<MenuItemRadio
									key="automatic"
									selected={!currentRegion}
									disabled={isChangingRegion}
									onSelect={() => handleRegionSelect(null)}
								>
									{t`Automatic`}
								</MenuItemRadio>
								{regions.map((region) => {
									const label = getRegionDisplayName(region.id, region.name);
									return (
										<MenuItemRadio
											key={region.id}
											selected={currentRegion === region.id}
											disabled={isChangingRegion}
											onSelect={() => handleRegionSelect(region.id)}
										>
											{label}
										</MenuItemRadio>
									);
								})}
							</>
						)}
					/>
				)}
				{isGuildVoiceCall && (
					<>
						<MenuItem
							icon={<MonitorPlayIcon weight="fill" className={styles.icon} />}
							disabled={isUpdatingIptv}
							onClick={() => {
								if (iptvStatus?.active) {
									handleStopIptv();
								} else {
									handleStartIptv();
								}
							}}
						>
							{iptvStatus?.active ? <Trans>Stop IPTV Stream</Trans> : <Trans>Start IPTV Stream</Trans>}
						</MenuItem>
						{iptvStatus?.active && iptvAudioKey && (
							<>
								<CheckboxItem
									icon={<SpeakerSlashIcon weight="fill" className={styles.icon} />}
									checked={iptvMuted}
									onCheckedChange={(checked) => {
										ParticipantVolumeStore.setLocalMute(iptvAudioKey, checked);
										MediaEngineStore.setLocalVideoDisabled(`iptv_${connectedChannelId!}`, checked);
										MediaEngineStore.applyAllLocalAudioPreferences();
									}}
								>
									<Trans>Hide IPTV For Me</Trans>
								</CheckboxItem>
							</>
						)}
						{canManageIptvPlaylist && (
							<MenuItem
								icon={<MonitorPlayIcon weight="fill" className={styles.icon} />}
								disabled={!connectedChannelId}
								onClick={() => {
									if (!connectedChannelId) return;
									onClose();
									ModalActionCreators.push(
										modal(() => <IPTVPlaylistConfigModal channelId={connectedChannelId} />),
									);
								}}
							>
								<Trans>IPTV Playlist Settings</Trans>
							</MenuItem>
						)}
					</>
				)}
				{!isDmVoiceCall && (
					<CheckboxItem
						icon={<GridFourIcon weight="fill" className={styles.icon} />}
						checked={isGrid}
						onCheckedChange={(checked) => {
							if (checked) VoiceCallLayoutActionCreators.setLayoutMode('grid');
							else VoiceCallLayoutActionCreators.setLayoutMode('focus');
							VoiceCallLayoutActionCreators.markUserOverride();
						}}
					>
						<Trans>Grid View</Trans>
					</CheckboxItem>
				)}

				<CheckboxItem
					icon={<UsersIcon weight="fill" className={styles.icon} />}
					checked={voiceSettings.showMyOwnCamera}
					onCheckedChange={(checked) => {
						if (!checked) {
							if (VoicePromptsStore.getSkipHideOwnCameraConfirm()) {
								VoiceSettingsActionCreators.update({showMyOwnCamera: false});
							} else {
								onClose();
								ModalActionCreators.push(modal(() => <HideOwnCameraConfirmModal />));
							}
						} else {
							VoiceSettingsActionCreators.update({showMyOwnCamera: true});
						}
					}}
				>
					<Trans>Show My Own Camera</Trans>
				</CheckboxItem>

				<CheckboxItem
					icon={<UsersIcon weight="fill" className={styles.icon} />}
					checked={voiceSettings.showNonVideoParticipants}
					onCheckedChange={(checked) => VoiceSettingsActionCreators.update({showNonVideoParticipants: checked})}
				>
					<Trans>Show Non-Video Participants</Trans>
				</CheckboxItem>
			</MenuGroup>

			<MenuGroup>
				<MenuItem
					icon={<GearIcon weight="fill" className={styles.icon} />}
					onClick={() => {
						onClose();
						ModalActionCreators.push(modal(() => <UserSettingsModal initialTab="voice_video" />));
					}}
				>
					<Trans>Voice & Video Settings</Trans>
				</MenuItem>
			</MenuGroup>
		</>
	);
});
