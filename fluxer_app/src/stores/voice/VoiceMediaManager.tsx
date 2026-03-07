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

import * as ModalActionCreators from '@app/actions/ModalActionCreators';
import {modal} from '@app/actions/ModalActionCreators';
import * as SoundActionCreators from '@app/actions/SoundActionCreators';
import {CameraPermissionDeniedModal} from '@app/components/alerts/CameraPermissionDeniedModal';
import {MicrophonePermissionDeniedModal} from '@app/components/alerts/MicrophonePermissionDeniedModal';
import {Logger} from '@app/lib/Logger';
import CallMediaPrefsStore from '@app/stores/CallMediaPrefsStore';
import ChannelStore from '@app/stores/ChannelStore';
import KeybindStore from '@app/stores/KeybindStore';
import LocalVoiceStateStore from '@app/stores/LocalVoiceStateStore';
import MediaPermissionStore from '@app/stores/MediaPermissionStore';
import VoiceSettingsStore from '@app/stores/VoiceSettingsStore';
import {
	applyAllLocalAudioPreferences as applyAllLocalAudioPreferencesImpl,
	applyLocalAudioPreferencesForUser as applyLocalAudioPreferencesForUserImpl,
	applyPushToTalkHold as applyPushToTalkHoldImpl,
	getMuteReason as getMuteReasonImpl,
	handlePushToTalkModeChange as handlePushToTalkModeChangeImpl,
} from '@app/stores/voice/VoiceAudioManager';
import VoiceDevicePermissionStore from '@app/stores/voice/VoiceDevicePermissionStore';
import {playEntranceSound} from '@app/stores/voice/VoiceEntranceSoundManager';
import {
	getRoomFromMediaEngineStore,
	syncLocalVoiceStateWithServer,
	updateLocalParticipantFromRoom,
} from '@app/stores/voice/VoiceMediaEngineBridge';
import VoiceMediaStateCoordinator from '@app/stores/voice/VoiceMediaStateCoordinator';
import VoiceScreenShareManager from '@app/stores/voice/VoiceScreenShareManager';
import type {VoiceState} from '@app/types/gateway/GatewayVoiceTypes';
import {ensureNativePermission} from '@app/utils/NativePermissions';
import {isDesktop} from '@app/utils/NativeUtils';
import {SoundType} from '@app/utils/SoundUtils';
import {applyBackgroundProcessor} from '@app/utils/VideoBackgroundProcessor';
import {voiceVolumePercentToTrackVolume} from '@app/utils/VoiceVolumeUtils';
import type {
	LocalAudioTrack,
	LocalVideoTrack,
	Room,
	ScreenShareCaptureOptions,
	TrackPublishOptions,
} from 'livekit-client';
import {Track, VideoPresets} from 'livekit-client';
import {makeAutoObservable} from 'mobx';

const logger = new Logger('VoiceMediaManager');
const NOISE_GATE_DISABLED_THRESHOLD_DB = -90;
const NOISE_GATE_HYSTERESIS_DB = 2;
const NOISE_GATE_RELEASE_HOLD_MS = 140;

export interface SetCameraEnabledOptions {
	deviceId?: string;
	sendUpdate?: boolean;
}

interface LocalAudioTrackWithVolume {
	setVolume: (volume: number) => void;
	isMuted?: boolean;
}

function isLocalAudioTrackWithVolume(track: unknown): track is LocalAudioTrackWithVolume {
	return (
		track != null &&
		typeof track === 'object' &&
		'setVolume' in track &&
		typeof (track as LocalAudioTrackWithVolume).setVolume === 'function'
	);
}

class VoiceMediaManager {
	private noiseGateAudioContext: AudioContext | null = null;
	private noiseGateAnalyser: AnalyserNode | null = null;
	private noiseGateSource: MediaStreamAudioSourceNode | null = null;
	private noiseGateAnimationFrameId: number | null = null;
	private noiseGateTrackIdentity: string | null = null;
	private noiseGateMediaStreamTrack: MediaStreamTrack | null = null;
	private noiseGateFloatBuffer: Float32Array | null = null;
	private noiseGateByteBuffer: Uint8Array | null = null;
	private noiseGateUseFloat = false;
	private noiseGateOpen = true;
	private noiseGateLastAboveThresholdAt = 0;
	private noiseGateLastAppliedVolume = Number.NaN;
	private noiseGateLastAppliedEnabled: boolean | null = null;

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
	}

	get isScreenSharePending(): boolean {
		return VoiceScreenShareManager.getIsScreenSharePending();
	}

	async ensureMicrophone(room: Room, channelId: string): Promise<void> {
		const selfMute = LocalVoiceStateStore.getSelfMute();
		const selfDeaf = LocalVoiceStateStore.getSelfDeaf();
		const denied = MediaPermissionStore.isMicrophoneExplicitlyDenied();

		const isPttMutedOnly =
			KeybindStore.isPushToTalkEnabled() && selfMute && !LocalVoiceStateStore.getHasUserSetMute() && !selfDeaf;

		if ((selfMute || selfDeaf) && !isPttMutedOnly) {
			logger.debug('Skipping: user is muted or deafened', {selfMute, selfDeaf});
			if (selfMute) {
				this.syncVoiceState({self_mute: true});
			}
			return;
		}

		if (denied) {
			logger.debug('Microphone explicitly denied');
			if (!LocalVoiceStateStore.getSelfMute()) {
				LocalVoiceStateStore.updateSelfMute(true);
			}
			this.syncVoiceState({self_mute: true});
			return;
		}

		if (!room.localParticipant) {
			logger.warn('No local participant');
			return;
		}

		try {
			await this.enableMicrophone(room, channelId);
			MediaPermissionStore.updateMicrophonePermissionGranted();

			if (isPttMutedOnly) {
				room.localParticipant.audioTrackPublications.forEach((publication) => {
					publication.mute().catch((error) => logger.error('Failed to mute publication for PTT', {error}));
				});
				this.syncVoiceState({self_mute: true});
			} else {
				this.syncVoiceState({self_mute: selfMute});
			}
		} catch (e: unknown) {
			if (e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError')) {
				MediaPermissionStore.markMicrophoneExplicitlyDenied();
				ModalActionCreators.push(modal(() => <MicrophonePermissionDeniedModal />));
				if (!LocalVoiceStateStore.getSelfMute()) {
					LocalVoiceStateStore.updateSelfMute(true);
				}
				this.syncVoiceState({self_mute: true});
			}
		}
	}

	async enableMicrophone(room: Room, channelId: string): Promise<void> {
		const channel = ChannelStore.getChannel(channelId);
		const audioBitrate = channel?.bitrate ? channel.bitrate * 1000 : undefined;

		try {
			if (isDesktop()) {
				const nativeResult = await ensureNativePermission('microphone');
				if (nativeResult === 'denied') {
					logger.warn('Native microphone permission denied');
					throw Object.assign(new Error('Native microphone permission denied'), {
						name: 'NotAllowedError',
					});
				}
				if (nativeResult === 'granted') {
					MediaPermissionStore.updateMicrophonePermissionGranted();
				}
			}

			await VoiceDevicePermissionStore.ensureDevices({requestPermissions: false});

			if (!room.localParticipant) {
				logger.warn('No local participant');
				return;
			}

			let inputDeviceId = VoiceSettingsStore.getInputDeviceId();
			const deviceState = VoiceDevicePermissionStore.getState();
			const exists = inputDeviceId === 'default' || deviceState.inputDevices.some((d) => d.deviceId === inputDeviceId);

			if (!exists && deviceState.inputDevices.length > 0) {
				inputDeviceId = 'default';
			}

			await room.localParticipant.setMicrophoneEnabled(true, {
				deviceId: inputDeviceId,
				echoCancellation: VoiceSettingsStore.getEchoCancellation(),
				noiseSuppression: VoiceSettingsStore.getNoiseSuppression(),
				autoGainControl: VoiceSettingsStore.getAutoGainControl(),
				...(audioBitrate && {audioBitrate}),
			});
			this.applyLocalInputVolume(room);

			MediaPermissionStore.updateMicrophonePermissionGranted();
			logger.info('Successfully enabled microphone');
		} catch (e: unknown) {
			if (e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError')) {
				logger.error('Permission denied');
				MediaPermissionStore.markMicrophoneExplicitlyDenied();
				ModalActionCreators.push(modal(() => <MicrophonePermissionDeniedModal />));
			} else {
				logger.error('Failed', e);
			}
			throw e;
		}
	}

	async disableMicrophone(room: Room): Promise<void> {
		if (!room.localParticipant) {
			logger.warn('No local participant');
			return;
		}

		try {
			const participant = room.localParticipant;
			const audioPublications = Array.from(participant.audioTrackPublications.values());

			if (audioPublications.length > 0) {
				const tracks = audioPublications
					.map((pub) => pub.track)
					.filter((track): track is LocalAudioTrack => Boolean(track));

				await Promise.allSettled(tracks.map((track) => participant.unpublishTrack(track)));
				logger.info('Successfully disabled microphone');
			}
		} catch (e) {
			logger.error('Failed', e);
		} finally {
			this.stopNoiseGateMonitoring();
		}
	}

	async setMicrophoneEnabled(enabled: boolean, room: Room, channelId: string): Promise<void> {
		if (enabled) {
			await this.enableMicrophone(room, channelId);
		} else {
			await this.disableMicrophone(room);
		}
	}

	async setCameraEnabled(enabled: boolean, options?: SetCameraEnabledOptions): Promise<void> {
		const room = getRoomFromMediaEngineStore();
		const {sendUpdate = true, ...restOptions} = options || {};

		if (!room?.localParticipant) {
			logger.warn('No room or local participant');
			return;
		}

		if (enabled) {
			const nativeResult = await ensureNativePermission('camera');
			if (nativeResult === 'denied') {
				MediaPermissionStore.markCameraExplicitlyDenied();
				ModalActionCreators.push(modal(() => <CameraPermissionDeniedModal />));
				return;
			}
			if (nativeResult === 'granted') {
				MediaPermissionStore.updateCameraPermissionGranted();
			}
		}

		try {
			const participant = room.localParticipant;
			const resolution = VoiceSettingsStore.getCameraResolution();
			const videoResolution = this.getVideoPreset(resolution);

			if (!enabled) {
				VoiceMediaStateCoordinator.applyCameraState(false, {reason: sendUpdate ? 'user' : 'server', sendUpdate});
			}

			await participant.setCameraEnabled(enabled, {resolution: videoResolution, ...restOptions});

			if (enabled) {
				await this.applyBackgroundToCamera(participant);
				VoiceMediaStateCoordinator.applyCameraState(true, {reason: sendUpdate ? 'user' : 'server', sendUpdate});
			}

			updateLocalParticipantFromRoom(room);

			if (enabled) {
				SoundActionCreators.playSound(SoundType.CameraOn);
			} else {
				SoundActionCreators.playSound(SoundType.CameraOff);
			}
			logger.info('Success', {enabled});
		} catch (e) {
			logger.error('Failed', {enabled, error: e});
			const actual = room.localParticipant?.isCameraEnabled ?? false;
			VoiceMediaStateCoordinator.applyCameraState(actual, {reason: sendUpdate ? 'user' : 'server', sendUpdate});
			updateLocalParticipantFromRoom(room);

			if (actual) {
				SoundActionCreators.playSound(SoundType.CameraOn);
			} else {
				SoundActionCreators.playSound(SoundType.CameraOff);
			}
		}
	}

	private async applyBackgroundToCamera(participant: Room['localParticipant']): Promise<void> {
		const videoPublication = Array.from(participant.videoTrackPublications.values()).find(
			(pub) => pub.source === Track.Source.Camera,
		);

		const track = videoPublication?.track as LocalVideoTrack | undefined;
		if (!track) {
			logger.warn('No camera track found to apply background');
			return;
		}

		await applyBackgroundProcessor(track);
	}

	private getVideoPreset(resolution: string) {
		switch (resolution) {
			case 'high':
				return VideoPresets.h1080;
			case 'medium':
				return VideoPresets.h720;
			default:
				return VideoPresets.h360;
		}
	}

	async toggleCameraFromKeybind(): Promise<void> {
		const current = LocalVoiceStateStore.getSelfVideo();
		await this.setCameraEnabled(!current, {deviceId: VoiceSettingsStore.getVideoDeviceId()});
	}

	async setScreenShareEnabled(
		enabled: boolean,
		options?: ScreenShareCaptureOptions & {sendUpdate?: boolean; playSound?: boolean; restartIfEnabled?: boolean},
		publishOptions?: TrackPublishOptions,
	): Promise<void> {
		const room = getRoomFromMediaEngineStore();
		await VoiceScreenShareManager.setScreenShareEnabled(room, enabled, options, publishOptions);
	}

	async updateActiveScreenShareSettings(
		options?: ScreenShareCaptureOptions,
		publishOptions?: TrackPublishOptions,
	): Promise<boolean> {
		const room = getRoomFromMediaEngineStore();
		return VoiceScreenShareManager.updateActiveScreenShareSettings(room, options, publishOptions);
	}

	async toggleScreenShareFromKeybind(): Promise<void> {
		const room = getRoomFromMediaEngineStore();
		await VoiceScreenShareManager.toggleScreenShareFromKeybind(room);
	}

	async playEntranceSound(): Promise<void> {
		const room = getRoomFromMediaEngineStore();
		await playEntranceSound(room);
	}

	resetStreamTracking(): void {
		VoiceScreenShareManager.resetStreamTracking();
	}

	syncVoiceState(partial: {
		self_video?: boolean;
		self_stream?: boolean;
		self_mute?: boolean;
		self_deaf?: boolean;
		viewer_stream_keys?: Array<string>;
	}): void {
		syncLocalVoiceStateWithServer(partial);
	}

	applyLocalAudioPreferencesForUser(userId: string, room: Room | null): void {
		applyLocalAudioPreferencesForUserImpl(userId, room);
	}

	applyAllLocalAudioPreferences(room: Room | null): void {
		applyAllLocalAudioPreferencesImpl(room);
	}

	applyLocalInputVolume(room: Room | null): void {
		if (!room?.localParticipant) {
			return;
		}
		const localInputVolume = voiceVolumePercentToTrackVolume(VoiceSettingsStore.getInputVolume());
		room.localParticipant.audioTrackPublications.forEach((publication) => {
			const track = publication.track;
			if (!track || !isLocalAudioTrackWithVolume(track)) {
				return;
			}
			track.setVolume(localInputVolume);
		});

		this.startNoiseGateMonitoring(room);
	}

	private stopNoiseGateMonitoring(): void {
		if (this.noiseGateAnimationFrameId !== null) {
			cancelAnimationFrame(this.noiseGateAnimationFrameId);
			this.noiseGateAnimationFrameId = null;
		}

		if (this.noiseGateSource) {
			this.noiseGateSource.disconnect();
			this.noiseGateSource = null;
		}

		if (this.noiseGateAnalyser) {
			this.noiseGateAnalyser.disconnect();
			this.noiseGateAnalyser = null;
		}

		if (this.noiseGateAudioContext && this.noiseGateAudioContext.state !== 'closed') {
			void this.noiseGateAudioContext.close();
		}
		if (this.noiseGateMediaStreamTrack && this.noiseGateMediaStreamTrack.readyState !== 'ended') {
			this.noiseGateMediaStreamTrack.enabled = true;
		}
		this.noiseGateAudioContext = null;
		this.noiseGateTrackIdentity = null;
		this.noiseGateMediaStreamTrack = null;
		this.noiseGateFloatBuffer = null;
		this.noiseGateByteBuffer = null;
		this.noiseGateUseFloat = false;
		this.noiseGateOpen = true;
		this.noiseGateLastAboveThresholdAt = 0;
		this.noiseGateLastAppliedVolume = Number.NaN;
		this.noiseGateLastAppliedEnabled = null;
	}

	private getTrackMediaStreamTrack(track: unknown): MediaStreamTrack | null {
		if (track && typeof track === 'object' && 'mediaStreamTrack' in track) {
			const mediaStreamTrack = (track as {mediaStreamTrack?: MediaStreamTrack}).mediaStreamTrack;
			if (mediaStreamTrack instanceof MediaStreamTrack) {
				return mediaStreamTrack;
			}
		}
		return null;
	}

	private computeNoiseGateLevelDb(): number {
		const analyser = this.noiseGateAnalyser;
		if (!analyser) {
			return -Infinity;
		}

		let peakPower = 0;
		let sumOfSquares = 0;
		let sampleCount = 0;

		if (this.noiseGateUseFloat && this.noiseGateFloatBuffer) {
			analyser.getFloatTimeDomainData(this.noiseGateFloatBuffer as Float32Array<ArrayBuffer>);
			for (let i = 0; i < this.noiseGateFloatBuffer.length; i++) {
				const sample = this.noiseGateFloatBuffer[i];
				const power = sample * sample;
				peakPower = Math.max(peakPower, power);
				sumOfSquares += power;
				sampleCount++;
			}
		} else if (this.noiseGateByteBuffer) {
			analyser.getByteTimeDomainData(this.noiseGateByteBuffer as Uint8Array<ArrayBuffer>);
			for (let i = 0; i < this.noiseGateByteBuffer.length; i++) {
				const sample = (this.noiseGateByteBuffer[i] - 128) / 128;
				const power = sample * sample;
				peakPower = Math.max(peakPower, power);
				sumOfSquares += power;
				sampleCount++;
			}
		}

		if (sampleCount === 0 || peakPower <= 0) {
			return -Infinity;
		}

		const averagePower = sumOfSquares / sampleCount;
		return averagePower > 0 ? 10 * Math.log10(averagePower) : -Infinity;
	}

	private startNoiseGateMonitoring(room: Room | null): void {
		if (!room?.localParticipant) {
			this.stopNoiseGateMonitoring();
			return;
		}

		const publication = Array.from(room.localParticipant.audioTrackPublications.values()).find(
			(pub) => Boolean(pub.track) && isLocalAudioTrackWithVolume(pub.track),
		);
		const localTrack = publication?.track;
		if (!localTrack || !isLocalAudioTrackWithVolume(localTrack)) {
			this.stopNoiseGateMonitoring();
			return;
		}

		const mediaStreamTrack = this.getTrackMediaStreamTrack(localTrack);
		if (!mediaStreamTrack) {
			this.stopNoiseGateMonitoring();
			return;
		}

		const trackIdentity = `${publication?.trackSid ?? 'local'}:${mediaStreamTrack.id}`;
		if (this.noiseGateTrackIdentity === trackIdentity && this.noiseGateAnimationFrameId !== null) {
			return;
		}

		this.stopNoiseGateMonitoring();

		const AudioContextClass =
			window.AudioContext || (window as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
		if (!AudioContextClass) {
			return;
		}

		try {
			this.noiseGateAudioContext = new AudioContextClass();
			this.noiseGateAnalyser = this.noiseGateAudioContext.createAnalyser();
			this.noiseGateAnalyser.fftSize = 2048;
			this.noiseGateAnalyser.smoothingTimeConstant = 0.2;
			this.noiseGateUseFloat = typeof this.noiseGateAnalyser.getFloatTimeDomainData === 'function';

			if (this.noiseGateUseFloat) {
				this.noiseGateFloatBuffer = new Float32Array(this.noiseGateAnalyser.fftSize);
			} else {
				this.noiseGateByteBuffer = new Uint8Array(this.noiseGateAnalyser.fftSize);
			}

			const sourceStream = new MediaStream([mediaStreamTrack]);
			this.noiseGateSource = this.noiseGateAudioContext.createMediaStreamSource(sourceStream);
			this.noiseGateSource.connect(this.noiseGateAnalyser);
			this.noiseGateTrackIdentity = trackIdentity;
			this.noiseGateMediaStreamTrack = mediaStreamTrack;

			const tick = () => {
				if (mediaStreamTrack.readyState === 'ended') {
					this.stopNoiseGateMonitoring();
					return;
				}

				const levelDb = this.computeNoiseGateLevelDb();
				const baseInputVolume = voiceVolumePercentToTrackVolume(VoiceSettingsStore.getInputVolume());
				const thresholdDb = VoiceSettingsStore.getNoiseGateThresholdDb();
				const now = Date.now();

				let isGateOpen = true;
				if (thresholdDb > NOISE_GATE_DISABLED_THRESHOLD_DB && Number.isFinite(levelDb)) {
					const openThresholdDb = thresholdDb + NOISE_GATE_HYSTERESIS_DB;
					if (levelDb >= openThresholdDb) {
						this.noiseGateOpen = true;
						this.noiseGateLastAboveThresholdAt = now;
					} else if (
						levelDb < thresholdDb &&
						now - this.noiseGateLastAboveThresholdAt > NOISE_GATE_RELEASE_HOLD_MS
					) {
						this.noiseGateOpen = false;
					}
					isGateOpen = this.noiseGateOpen;
				} else {
					this.noiseGateOpen = true;
					isGateOpen = true;
				}

				const targetVolume = isGateOpen ? baseInputVolume : 0;
				if (targetVolume !== this.noiseGateLastAppliedVolume) {
					localTrack.setVolume(targetVolume);
					this.noiseGateLastAppliedVolume = targetVolume;
				}
				const shouldEnableTrack = isGateOpen || localTrack.isMuted === true;
				if (shouldEnableTrack !== this.noiseGateLastAppliedEnabled) {
					mediaStreamTrack.enabled = shouldEnableTrack;
					this.noiseGateLastAppliedEnabled = shouldEnableTrack;
				}

				this.noiseGateAnimationFrameId = requestAnimationFrame(tick);
			};

			this.noiseGateAnimationFrameId = requestAnimationFrame(tick);
		} catch (error) {
			logger.warn('Failed to start noise gate monitor', {error});
			this.stopNoiseGateMonitoring();
		}
	}

	setLocalVideoDisabled(identity: string, disabled: boolean, room: Room | null, connectionId: string | null): void {
		if (!connectionId) {
			logger.warn('No connection ID');
			return;
		}
		CallMediaPrefsStore.setVideoDisabled(connectionId, identity, disabled);
		if (!room) return;
		const p = room.remoteParticipants.get(identity);
		if (!p) return;

		p.videoTrackPublications.forEach((pub) => {
			const isCamera = pub.source === Track.Source.Camera;
			const isScreenShare = pub.source === Track.Source.ScreenShare;
			if (!isCamera && !isScreenShare) {
				const error = new Error('Unsupported video track source for local subscription update');
				logger.error('Unexpected local video track source while resubscribing', {
					identity,
					source: pub.source,
					trackSid: pub.trackSid,
				});
				throw error;
			}

			try {
				if (disabled) {
					pub.setSubscribed(false);
					logger.debug('Unsubscribed from track', {
						identity,
						source: pub.source,
						trackSid: pub.trackSid,
					});
					return;
				}

				const trackType = isScreenShare ? 'screen_share' : 'camera';
				pub.setSubscribed(true);
				logger.debug('Re-subscribed to local video track', {
					identity,
					trackSid: pub.trackSid,
					trackType,
				});
			} catch (err) {
				logger.error('Failed to update subscription', {
					error: err,
					identity,
					source: pub.source,
					disabled,
				});
			}
		});
	}

	applyPushToTalkHold(held: boolean, room: Room | null, getCurrentUserVoiceState: () => VoiceState | null): void {
		applyPushToTalkHoldImpl(held, room, getCurrentUserVoiceState, this.syncVoiceState);
	}

	handlePushToTalkModeChange(room: Room | null, getCurrentUserVoiceState: () => VoiceState | null): void {
		handlePushToTalkModeChangeImpl(room, getCurrentUserVoiceState, this.syncVoiceState);
	}

	getMuteReason(voiceState: VoiceState | null): 'guild' | 'push_to_talk' | 'self' | null {
		return getMuteReasonImpl(voiceState);
	}
}

export default new VoiceMediaManager();
