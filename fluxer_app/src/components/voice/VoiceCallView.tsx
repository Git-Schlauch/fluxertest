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

import * as PiPActionCreators from '@app/actions/PiPActionCreators';
import * as ToastActionCreators from '@app/actions/ToastActionCreators';
import channelHeaderStyles from '@app/components/channel/ChannelHeader.module.css';
import {ChannelHeaderIcon} from '@app/components/channel/channel_header_components/ChannelHeaderIcon';
import {InboxButton} from '@app/components/channel/channel_header_components/UtilityButtons';
import {MobileEmojiPicker} from '@app/components/channel/MobileEmojiPicker';
import {MobileStickersPicker} from '@app/components/channel/MobileStickersPicker';
import {NativeDragRegion} from '@app/components/layout/NativeDragRegion';
import {BottomSheet} from '@app/components/uikit/bottom_sheet/BottomSheet';
import FocusRing from '@app/components/uikit/focus_ring/FocusRing';
import {CompactVoiceCallView} from '@app/components/voice/CompactVoiceCallView';
import {StreamFocusHeaderInfo} from '@app/components/voice/StreamFocusHeaderInfo';
import {StreamInfoPill} from '@app/components/voice/StreamInfoPill';
import {getStreamKey} from '@app/components/voice/StreamKeys';
import {useStreamSpectators} from '@app/components/voice/useStreamSpectators';
import {useStreamTrackInfo} from '@app/components/voice/useStreamTrackInfo';
import {useVoiceCallAppFullscreen} from '@app/components/voice/useVoiceCallAppFullscreen';
import {useVoiceCallTracksAndLayout} from '@app/components/voice/useVoiceCallTracksAndLayout';
import {VoiceCallLayoutContent} from '@app/components/voice/VoiceCallLayoutContent';
import styles from '@app/components/voice/VoiceCallView.module.css';
import {VoiceControlBar} from '@app/components/voice/VoiceControlBar';
import {parseVoiceParticipantIdentity} from '@app/components/voice/VoiceParticipantSpeakingUtils';
import {VoiceStatsOverlay} from '@app/components/voice/VoiceStatsOverlay';
import {Logger} from '@app/lib/Logger';
import {SafeMarkdown} from '@app/lib/markdown';
import {MarkdownContext} from '@app/lib/markdown/renderers/RendererTypes';
import type {ChannelRecord} from '@app/records/ChannelRecord';
import type {GuildStickerRecord} from '@app/records/GuildStickerRecord';
import AccessibilityStore from '@app/stores/AccessibilityStore';
import ContextMenuStore, {isContextMenuNodeTarget} from '@app/stores/ContextMenuStore';
import FavoritesStore from '@app/stores/FavoritesStore';
import KeyboardModeStore from '@app/stores/KeyboardModeStore';
import MobileLayoutStore from '@app/stores/MobileLayoutStore';
import PiPStore from '@app/stores/PiPStore';
import PopoutStore from '@app/stores/PopoutStore';
import UserStore from '@app/stores/UserStore';
import VoiceSettingsStore from '@app/stores/VoiceSettingsStore';
import MediaEngineStore from '@app/stores/voice/MediaEngineFacade';
import * as ChannelUtils from '@app/utils/ChannelUtils';
import * as NicknameUtils from '@app/utils/NicknameUtils';
import {getSkinTonedSurrogate} from '@app/utils/SkinToneUtils';
import {
	FloatingFocusManager,
	flip,
	offset,
	shift,
	useClick,
	useDismiss,
	useFloating,
	useInteractions,
	useRole,
} from '@floating-ui/react';
import {ME} from '@fluxer/constants/src/AppConstants';
import {useLingui} from '@lingui/react/macro';
import {type TrackReferenceOrPlaceholder, useConnectionState, useParticipants} from '@livekit/components-react';
import {
	ArrowLeftIcon,
	CaretDownIcon,
	CaretUpIcon,
	ChartBarIcon,
	ChatCircleTextIcon,
	CornersInIcon,
	CornersOutIcon,
	ListIcon,
	PhoneIcon,
	SmileyIcon,
	StarIcon,
	StickerIcon,
} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {ConnectionState, RoomEvent, Track, type Participant} from 'livekit-client';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {forwardRef, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {FlatEmoji} from '@app/types/EmojiTypes';

const logger = new Logger('VoiceCallView');
const VOICE_HUD_IDLE_TIMEOUT_MS = 3000;
const VOICE_ROOM_CHAT_TOPIC = 'fluxer.voice_chat.v1';
const VOICE_ROOM_CHAT_MAX_TEXT_LENGTH = 500;

interface VoiceRoomChatWireMessage {
	type: 'voice_chat_message' | 'voice_chat_sticker';
	id: string;
	channelId: string;
	senderIdentity: string;
	timestamp: number;
	text: string;
	sticker?: {
		id: string;
		name: string;
		url: string;
	};
}

interface VoiceRoomChatMessage {
	id: string;
	senderIdentity: string;
	senderLabel: string;
	text: string;
	sticker?: {
		id: string;
		name: string;
		url: string;
	};
	timestamp: number;
	isOwn: boolean;
}

interface VoiceRoomChatChannelCache {
	messages: Array<VoiceRoomChatMessage>;
	messageIds: Set<string>;
}

const voiceRoomChatSessionCache = new Map<string, VoiceRoomChatChannelCache>();

function getOrCreateVoiceRoomChatChannelCache(channelId: string): VoiceRoomChatChannelCache {
	let cache = voiceRoomChatSessionCache.get(channelId);
	if (!cache) {
		cache = {messages: [], messageIds: new Set()};
		voiceRoomChatSessionCache.set(channelId, cache);
	}
	return cache;
}

function pruneVoiceRoomChatMessages(
	messages: Array<VoiceRoomChatMessage>,
	messageLimit: number,
	ttlMinutes: number,
): Array<VoiceRoomChatMessage> {
	const effectiveLimit = Math.max(10, messageLimit);
	const effectiveTtlMinutes = Math.max(5, ttlMinutes);
	const ttlCutoff = Date.now() - effectiveTtlMinutes * 60 * 1000;
	const ttlFiltered = messages.filter((message) => message.timestamp >= ttlCutoff);
	if (ttlFiltered.length <= effectiveLimit) {
		return ttlFiltered;
	}
	return ttlFiltered.slice(ttlFiltered.length - effectiveLimit);
}

interface VoiceCallViewProps {
	channel: ChannelRecord;
	fullscreenRequestNonce?: number;
}

function useConnectionStateText(connectionState: ConnectionState) {
	const {t} = useLingui();
	return useMemo(() => {
		switch (connectionState) {
			case ConnectionState.Connecting:
				return t`Connecting...`;
			case ConnectionState.Reconnecting:
				return t`Reconnecting...`;
			case ConnectionState.Disconnected:
				return t`Disconnected`;
			default:
				return null;
		}
	}, [connectionState, t]);
}

const VoiceRoomChatPanel = observer(({channel, isMobile}: {channel: ChannelRecord; isMobile: boolean}) => {
	const {t} = useLingui();
	const room = MediaEngineStore.room;
	const messageLimit = VoiceSettingsStore.voiceRoomChatMessageLimit;
	const messageTtlMinutes = VoiceSettingsStore.voiceRoomChatMessageTtlMinutes;
	const [isCollapsed, setIsCollapsed] = useState(isMobile);
	const [draft, setDraft] = useState('');
	const [isExpressionPickerOpen, setIsExpressionPickerOpen] = useState(false);
	const [expressionTab, setExpressionTab] = useState<'emojis' | 'stickers'>('emojis');
	const [messages, setMessages] = useState<VoiceRoomChatMessage[]>(() =>
		pruneVoiceRoomChatMessages(getOrCreateVoiceRoomChatChannelCache(channel.id).messages, messageLimit, messageTtlMinutes),
	);
	const [unreadCount, setUnreadCount] = useState(0);
	const messageIdsRef = useRef<Set<string>>(new Set(getOrCreateVoiceRoomChatChannelCache(channel.id).messageIds));
	const messagesScrollRef = useRef<HTMLDivElement>(null);
	const expressionPickerRef = useRef<HTMLDivElement>(null);

	const resolveSenderLabel = useCallback(
		(identity: string, participant?: Participant, isOwn?: boolean) => {
			if (isOwn) return t`You`;
			const parsedIdentity = parseVoiceParticipantIdentity(identity);
			if (parsedIdentity.userId) {
				const user = UserStore.getUser(parsedIdentity.userId);
				if (user) {
					return NicknameUtils.getNickname(user, channel.guildId, channel.id) || user.username || participant?.name || identity;
				}
			}
			return participant?.name || identity;
		},
		[channel.guildId, channel.id, t],
	);

	const appendMessage = useCallback(
		(message: VoiceRoomChatMessage) => {
			if (messageIdsRef.current.has(message.id)) return;
			messageIdsRef.current.add(message.id);
			setMessages((previousMessages) => {
				const nextMessages = pruneVoiceRoomChatMessages(
					[...previousMessages, message],
					messageLimit,
					messageTtlMinutes,
				);
				const channelCache = getOrCreateVoiceRoomChatChannelCache(channel.id);
				channelCache.messages = nextMessages;
				channelCache.messageIds = new Set(nextMessages.map((entry) => entry.id));
				messageIdsRef.current = channelCache.messageIds;
				return channelCache.messages;
			});
			if (isCollapsed && !message.isOwn) {
				setUnreadCount((count) => count + 1);
			}
		},
		[channel.id, isCollapsed, messageLimit, messageTtlMinutes],
	);

	const publishVoiceRoomMessage = useCallback(
		async (payload: VoiceRoomChatWireMessage) => {
			if (!room) return;
			try {
				await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(payload)), {
					reliable: true,
					topic: VOICE_ROOM_CHAT_TOPIC,
				});
			} catch (error) {
				logger.error('Failed to send voice-room chat payload', {error});
			}
		},
		[room],
	);

	useEffect(() => {
		const channelCache = getOrCreateVoiceRoomChatChannelCache(channel.id);
		const prunedMessages = pruneVoiceRoomChatMessages(channelCache.messages, messageLimit, messageTtlMinutes);
		channelCache.messages = prunedMessages;
		channelCache.messageIds = new Set(prunedMessages.map((entry) => entry.id));
		messageIdsRef.current = channelCache.messageIds;
		setMessages(channelCache.messages);
		setUnreadCount(0);
	}, [channel.id, messageLimit, messageTtlMinutes]);

	useEffect(() => {
		setMessages((previousMessages) => {
			const prunedMessages = pruneVoiceRoomChatMessages(previousMessages, messageLimit, messageTtlMinutes);
			if (prunedMessages.length === previousMessages.length) {
				return previousMessages;
			}
			const channelCache = getOrCreateVoiceRoomChatChannelCache(channel.id);
			channelCache.messages = prunedMessages;
			channelCache.messageIds = new Set(prunedMessages.map((entry) => entry.id));
			messageIdsRef.current = channelCache.messageIds;
			return prunedMessages;
		});
	}, [channel.id, messageLimit, messageTtlMinutes]);

	useEffect(() => {
		const roomIdentity = room?.localParticipant?.identity;
		if (!room || !roomIdentity) return;

		const onDataReceived = (payload: Uint8Array, participant?: Participant, _kind?: unknown, topic?: string) => {
			if (topic !== VOICE_ROOM_CHAT_TOPIC) return;

			let parsed: VoiceRoomChatWireMessage | null = null;
			try {
				parsed = JSON.parse(new TextDecoder().decode(payload)) as VoiceRoomChatWireMessage;
			} catch {
				return;
			}

			if (
				!parsed ||
				(parsed.type !== 'voice_chat_message' && parsed.type !== 'voice_chat_sticker') ||
				parsed.channelId !== channel.id ||
				!parsed.id
			) {
				return;
			}

			const isOwn = parsed.senderIdentity === roomIdentity;
			appendMessage({
				id: parsed.id,
				senderIdentity: parsed.senderIdentity,
				senderLabel: resolveSenderLabel(parsed.senderIdentity, participant, isOwn),
				text: parsed.text,
				sticker: parsed.sticker,
				timestamp: parsed.timestamp,
				isOwn,
			});
		};

		room.on(RoomEvent.DataReceived, onDataReceived);
		return () => {
			room.off(RoomEvent.DataReceived, onDataReceived);
		};
	}, [appendMessage, channel.id, resolveSenderLabel, room]);

	useEffect(() => {
		if (isCollapsed) return;
		setUnreadCount(0);
	}, [isCollapsed]);

	useEffect(() => {
		if (isCollapsed) {
			setIsExpressionPickerOpen(false);
		}
	}, [isCollapsed]);

	useEffect(() => {
		if (!isExpressionPickerOpen) return;

		const onDocumentPointerDown = (event: MouseEvent | TouchEvent) => {
			const target = event.target as Node | null;
			if (!target) return;
			if (expressionPickerRef.current?.contains(target)) return;
			setIsExpressionPickerOpen(false);
		};

		const onDocumentKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setIsExpressionPickerOpen(false);
			}
		};

		document.addEventListener('mousedown', onDocumentPointerDown);
		document.addEventListener('touchstart', onDocumentPointerDown, {passive: true});
		document.addEventListener('keydown', onDocumentKeyDown);

		return () => {
			document.removeEventListener('mousedown', onDocumentPointerDown);
			document.removeEventListener('touchstart', onDocumentPointerDown);
			document.removeEventListener('keydown', onDocumentKeyDown);
		};
	}, [isExpressionPickerOpen]);

	useEffect(() => {
		if (!messagesScrollRef.current || isCollapsed) return;
		messagesScrollRef.current.scrollTop = messagesScrollRef.current.scrollHeight;
	}, [isCollapsed, messages]);

	const handleSubmit = useCallback(
		async (event: React.FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			if (!room) return;

			const normalizedText = draft.trim().replace(/\r\n/g, '\n').slice(0, VOICE_ROOM_CHAT_MAX_TEXT_LENGTH);
			if (!normalizedText) return;

			const senderIdentity = room.localParticipant.identity;
			const messageId = `${senderIdentity}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
			const timestamp = Date.now();
			const payload: VoiceRoomChatWireMessage = {
				type: 'voice_chat_message',
				id: messageId,
				channelId: channel.id,
				senderIdentity,
				timestamp,
				text: normalizedText,
			};

			appendMessage({
				id: messageId,
				senderIdentity,
				senderLabel: t`You`,
				text: normalizedText,
				sticker: undefined,
				timestamp,
				isOwn: true,
			});
			setDraft('');

			await publishVoiceRoomMessage(payload);
		},
		[appendMessage, channel.id, draft, publishVoiceRoomMessage, room, t],
	);

	const insertEmojiIntoDraft = useCallback((emoji: FlatEmoji) => {
		const unicode = getSkinTonedSurrogate(emoji);
		if (unicode) {
			setDraft((current) => `${current}${current.length > 0 ? ' ' : ''}${unicode}`.slice(0, VOICE_ROOM_CHAT_MAX_TEXT_LENGTH));
			return;
		}

		if (emoji.id) {
			const serializedCustomEmoji = `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
			setDraft((current) =>
				`${current}${current.length > 0 ? ' ' : ''}${serializedCustomEmoji}`.slice(0, VOICE_ROOM_CHAT_MAX_TEXT_LENGTH),
			);
		}
	}, []);

	const handleEmojiSelect = useCallback(
		(emoji: FlatEmoji, shiftKey?: boolean) => {
			insertEmojiIntoDraft(emoji);
			if (!shiftKey) {
				setIsExpressionPickerOpen(false);
			}
		},
		[insertEmojiIntoDraft],
	);

	const handleStickerSelect = useCallback(
		(sticker: GuildStickerRecord, shiftKey?: boolean) => {
			if (!room) return;
			const senderIdentity = room.localParticipant.identity;
			const messageId = `${senderIdentity}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
			const timestamp = Date.now();
			const payload: VoiceRoomChatWireMessage = {
				type: 'voice_chat_sticker',
				id: messageId,
				channelId: channel.id,
				senderIdentity,
				timestamp,
				text: '',
				sticker: {
					id: sticker.id,
					name: sticker.name,
					url: sticker.url,
				},
			};

			appendMessage({
				id: messageId,
				senderIdentity,
				senderLabel: t`You`,
				text: '',
				sticker: payload.sticker,
				timestamp,
				isOwn: true,
			});
			void publishVoiceRoomMessage(payload);
			if (!shiftKey) {
				setIsExpressionPickerOpen(false);
			}
		},
		[appendMessage, channel.id, publishVoiceRoomMessage, room, t],
	);

	const toggleCollapsed = useCallback(() => {
		setIsCollapsed((collapsed) => !collapsed);
	}, []);

	return (
		<aside
			className={clsx(
				styles.voiceRoomChatPanel,
				isCollapsed && styles.voiceRoomChatPanelCollapsed,
				isMobile && styles.voiceRoomChatPanelMobile,
			)}
		>
			<div className={styles.voiceRoomChatHeader}>
				<button type="button" className={styles.voiceRoomChatToggle} onClick={toggleCollapsed}>
					<ChatCircleTextIcon size={16} weight="bold" />
					<span>{t`Voice Chat`}</span>
					{isCollapsed ? <CaretUpIcon size={14} weight="bold" /> : <CaretDownIcon size={14} weight="bold" />}
				</button>
				{isCollapsed && unreadCount > 0 && <span className={styles.voiceRoomChatUnreadBadge}>{unreadCount}</span>}
			</div>

			{!isCollapsed && (
				<>
					<div className={styles.voiceRoomChatMessages} ref={messagesScrollRef}>
						{messages.length === 0 ? (
							<div className={styles.voiceRoomChatEmpty}>
								{t`Only users in this voice call can see messages here.`}
							</div>
						) : (
							messages.map((message) => (
								<div key={message.id} className={styles.voiceRoomChatMessage}>
									<div className={styles.voiceRoomChatMessageMeta}>
										<span className={styles.voiceRoomChatSender}>{message.senderLabel}</span>
										<span className={styles.voiceRoomChatTimestamp}>
											{new Date(message.timestamp).toLocaleTimeString([], {
												hour: '2-digit',
												minute: '2-digit',
											})}
										</span>
									</div>
									{message.sticker ? (
										<div className={styles.voiceRoomChatStickerWrap}>
											<img
												src={message.sticker.url}
												alt={message.sticker.name}
												className={styles.voiceRoomChatStickerImage}
											/>
										</div>
									) : (
										<div className={styles.voiceRoomChatText}>
											<SafeMarkdown
												content={message.text}
												options={{
													context: MarkdownContext.RESTRICTED_INLINE_REPLY,
													channelId: channel.id,
													guildId: channel.guildId ?? undefined,
												}}
											/>
										</div>
									)}
								</div>
							))
						)}
					</div>

					<form className={styles.voiceRoomChatComposer} onSubmit={handleSubmit}>
						<div className={styles.voiceRoomChatComposerActions}>
							<button
								type="button"
								className={styles.voiceRoomChatExpressionButton}
								onClick={() => {
									setExpressionTab('emojis');
									setIsExpressionPickerOpen((open) => (expressionTab === 'emojis' ? !open : true));
								}}
								title={t`Emojis`}
							>
								<SmileyIcon size={16} weight="fill" />
							</button>
							<button
								type="button"
								className={styles.voiceRoomChatExpressionButton}
								onClick={() => {
									setExpressionTab('stickers');
									setIsExpressionPickerOpen((open) => (expressionTab === 'stickers' ? !open : true));
								}}
								title={t`Stickers`}
							>
								<StickerIcon size={16} weight="fill" />
							</button>
						</div>
						<input
							type="text"
							className={styles.voiceRoomChatInput}
							value={draft}
							onChange={(event) => setDraft(event.currentTarget.value)}
							placeholder={t`Message voice call...`}
							maxLength={VOICE_ROOM_CHAT_MAX_TEXT_LENGTH}
						/>
						<button type="submit" className={styles.voiceRoomChatSendButton} disabled={draft.trim().length === 0}>
							{t`Send`}
						</button>
					</form>
					{isExpressionPickerOpen && (
						<div className={styles.voiceRoomChatExpressionPicker} ref={expressionPickerRef}>
							<div className={styles.voiceRoomChatExpressionTabs}>
								<button
									type="button"
									className={clsx(
										styles.voiceRoomChatExpressionTab,
										expressionTab === 'emojis' && styles.voiceRoomChatExpressionTabActive,
									)}
									onClick={() => setExpressionTab('emojis')}
								>
									{t`Emojis`}
								</button>
								<button
									type="button"
									className={clsx(
										styles.voiceRoomChatExpressionTab,
										expressionTab === 'stickers' && styles.voiceRoomChatExpressionTabActive,
									)}
									onClick={() => setExpressionTab('stickers')}
								>
									{t`Stickers`}
								</button>
							</div>
							<div className={styles.voiceRoomChatExpressionContent}>
								{expressionTab === 'emojis' ? (
									<MobileEmojiPicker channelId={channel.id} handleSelect={handleEmojiSelect} hideSearchBar={false} />
								) : (
									<MobileStickersPicker channelId={channel.id} handleSelect={handleStickerSelect} />
								)}
							</div>
						</div>
					)}
				</>
			)}
		</aside>
	);
});

const VoiceCallViewInner = observer(
	({channel, fullscreenRequestNonce}: {channel: ChannelRecord; fullscreenRequestNonce?: number}) => {
		const {t} = useLingui();
		const containerRef = useRef<HTMLDivElement>(null);
		const hudPointerTimeoutRef = useRef<number | null>(null);
		const previousFullscreenRequestNonceRef = useRef<number | undefined>(undefined);

		const isMobile = MobileLayoutStore.isMobileLayout();
		const pipContent = PiPStore.getContent();
		const pipOpen = PiPStore.getIsOpen();
		const {keyboardModeEnabled} = KeyboardModeStore;
		const disablePiP = VoiceSettingsStore.disablePictureInPicturePopout || PiPStore.getSessionDisable();

		const [isStatsOpen, setIsStatsOpen] = useState(false);
		const [isCallSheetOpen, setIsCallSheetOpen] = useState(false);
		const [isSpectatorsPopoutOpen, setIsSpectatorsPopoutOpen] = useState(false);
		const {
			isFullscreen: isVoiceCallAppFullscreen,
			supportsFullscreen: supportsVoiceCallAppFullscreen,
			enterFullscreen: enterVoiceCallAppFullscreen,
			toggleFullscreen: toggleVoiceCallAppFullscreen,
		} = useVoiceCallAppFullscreen({containerRef});
		const [isPointerHudActive, setIsPointerHudActive] = useState(false);

		const participants = useParticipants();
		const participantCount = participants.length;
		const connectionState = useConnectionState();
		const connectionStateText = useConnectionStateText(connectionState);

		const isInboxPopoutOpen = PopoutStore.isOpen('inbox');
		const isFavorited = channel ? Boolean(FavoritesStore.getChannel(channel.id)) : false;

		const isAnyContextMenuOpen = useMemo(() => {
			const cm = ContextMenuStore.contextMenu;
			const target = cm?.target?.target ?? null;
			const container = containerRef.current;
			if (!cm || !container || !isContextMenuNodeTarget(target)) return false;
			return Boolean(container.contains(target));
		}, [ContextMenuStore.contextMenu]);
		const isChromePinned = isAnyContextMenuOpen || isInboxPopoutOpen || isStatsOpen || isSpectatorsPopoutOpen;

		const {
			layoutMode,
			pinnedParticipantIdentity,
			hasScreenShare,
			cameraTracksAll,
			screenShareTracks,
			filteredCameraTracks,
			focusMainTrack,
			carouselTracks,
			pipTrack,
		} = useVoiceCallTracksAndLayout({channel});
		const mainContentClassName = clsx(
			styles.mainContent,
			!isMobile && layoutMode === 'focus' && styles.mainContentFocusFullscreen,
		);

		const isFocusedOnScreenShare = layoutMode === 'focus' && focusMainTrack?.source === Track.Source.ScreenShare;

		const focusedStreamInfo = useMemo(() => {
			if (!isFocusedOnScreenShare || !focusMainTrack) return null;
			const parsedIdentity = parseVoiceParticipantIdentity(focusMainTrack.participant.identity);
			if (!parsedIdentity.userId || !parsedIdentity.connectionId) return null;
			return {userId: parsedIdentity.userId, connectionId: parsedIdentity.connectionId};
		}, [isFocusedOnScreenShare, focusMainTrack]);

		const focusedStreamerUser = focusedStreamInfo ? UserStore.getUser(focusedStreamInfo.userId) : null;

		const focusedStreamKey = useMemo(() => {
			if (!focusedStreamInfo) return '';
			return getStreamKey(channel.guildId, channel.id, focusedStreamInfo.connectionId);
		}, [focusedStreamInfo, channel.guildId, channel.id]);

		const focusedStreamerDisplayName = useMemo(() => {
			if (!focusedStreamerUser) return '';
			return (
				NicknameUtils.getNickname(focusedStreamerUser, channel.guildId, channel.id) ||
				focusedStreamerUser.username ||
				''
			);
		}, [focusedStreamerUser, channel.guildId, channel.id]);

		const {viewerUsers: spectatorUsers, spectatorEntries} = useStreamSpectators(focusedStreamKey);
		const focusedTrackInfo = useStreamTrackInfo(isFocusedOnScreenShare ? (focusMainTrack ?? null) : null);
		const handleSpectatorsPopoutOpenChange = useCallback((open: boolean) => {
			setIsSpectatorsPopoutOpen(open);
		}, []);

		const {
			refs: statsRefs,
			floatingStyles: statsFloatingStyles,
			context: statsContext,
		} = useFloating({
			open: isStatsOpen,
			onOpenChange: setIsStatsOpen,
			placement: 'bottom-end',
			middleware: [offset(8), flip(), shift({padding: 8})],
		});

		const {getReferenceProps: getStatsReferenceProps, getFloatingProps: getStatsFloatingProps} = useInteractions([
			useClick(statsContext),
			useDismiss(statsContext),
			useRole(statsContext),
		]);
		const statsFloatingProps = isMobile ? {} : getStatsFloatingProps();

		useEffect(() => {
			if (!isMobile && isCallSheetOpen) {
				setIsCallSheetOpen(false);
			}
		}, [isCallSheetOpen, isMobile]);

		const handleBackClick = useCallback(() => window.history.back(), []);

		const clearHudPointerTimeout = useCallback(() => {
			if (hudPointerTimeoutRef.current == null) return;
			window.clearTimeout(hudPointerTimeoutRef.current);
			hudPointerTimeoutRef.current = null;
		}, []);

		const scheduleHudIdleState = useCallback(() => {
			clearHudPointerTimeout();
			hudPointerTimeoutRef.current = window.setTimeout(() => {
				hudPointerTimeoutRef.current = null;
				setIsPointerHudActive(false);
			}, VOICE_HUD_IDLE_TIMEOUT_MS);
		}, [clearHudPointerTimeout]);

		const handleVoiceRootPointerActivity = useCallback(
			(event: React.PointerEvent<HTMLDivElement>) => {
				if (event.pointerType === 'touch') return;
				setIsPointerHudActive(true);
				scheduleHudIdleState();
			},
			[scheduleHudIdleState],
		);

		const handleVoiceRootPointerLeave = useCallback(
			(event: React.PointerEvent<HTMLDivElement>) => {
				if (event.pointerType === 'touch') return;
				clearHudPointerTimeout();
				setIsPointerHudActive(false);
			},
			[clearHudPointerTimeout],
		);

		useEffect(() => {
			return () => {
				clearHudPointerTimeout();
			};
		}, [clearHudPointerTimeout]);

		const handleToggleFavorite = useCallback(() => {
			if (!channel) return;

			if (isFavorited) {
				FavoritesStore.removeChannel(channel.id);
				ToastActionCreators.createToast({type: 'success', children: t`Channel removed from favorites`});
				return;
			}

			FavoritesStore.addChannel(channel.id, channel.guildId ?? ME);
			ToastActionCreators.createToast({type: 'success', children: t`Channel added to favorites`});
		}, [channel, isFavorited]);

		const handleOpenCallSheet = useCallback(() => setIsCallSheetOpen(true), []);
		const handleCloseCallSheet = useCallback(() => setIsCallSheetOpen(false), []);
		const handleToggleVoiceCallAppFullscreen = useCallback(() => {
			void toggleVoiceCallAppFullscreen();
		}, [toggleVoiceCallAppFullscreen]);
		const fullscreenButtonLabel = isVoiceCallAppFullscreen ? t`Exit fullscreen` : t`Enter fullscreen`;
		const FullscreenButtonIcon = useMemo(() => {
			const BaseIcon = isVoiceCallAppFullscreen ? CornersInIcon : CornersOutIcon;
			const BoldIcon = forwardRef<SVGSVGElement, React.ComponentProps<typeof BaseIcon>>((props, ref) => (
				<BaseIcon ref={ref} weight="bold" {...props} />
			));
			BoldIcon.displayName = 'FullscreenButtonIcon';
			return BoldIcon;
		}, [isVoiceCallAppFullscreen]);

		useEffect(() => {
			if (fullscreenRequestNonce == null) return;
			if (previousFullscreenRequestNonceRef.current === fullscreenRequestNonce) return;
			previousFullscreenRequestNonceRef.current = fullscreenRequestNonce;
			void enterVoiceCallAppFullscreen();
		}, [enterVoiceCallAppFullscreen, fullscreenRequestNonce]);

		const openPiPForTrack = useCallback(
			(trackRef: TrackReferenceOrPlaceholder) => {
				const identity = trackRef?.participant?.identity ?? '';
				if (!identity) {
					logger.error('PiP open aborted because track reference is missing', {
						trackRef,
						disablePiP,
					});
					return;
				}

				if (disablePiP) {
					logger.debug('PiP open aborted because picture-in-picture is disabled');
					return;
				}

				const parsedIdentity = parseVoiceParticipantIdentity(identity);
				if (!parsedIdentity.userId || !parsedIdentity.connectionId) {
					logger.error('PiP open aborted because participant identity is malformed', {
						identity,
						trackRef,
					});
					return;
				}

				const contentType = trackRef.source === Track.Source.ScreenShare ? 'stream' : 'camera';
				PiPActionCreators.openPiP({
					type: contentType,
					participantIdentity: identity,
					channelId: channel.id,
					guildId: channel.guildId ?? null,
					connectionId: parsedIdentity.connectionId,
					userId: parsedIdentity.userId,
				});
			},
			[channel.id, channel.guildId, disablePiP],
		);

		const pipSnapshotRef = useRef<{pipTrack: TrackReferenceOrPlaceholder | null}>({
			pipTrack,
		});

		useEffect(() => {
			pipSnapshotRef.current = {pipTrack};
		}, [pipTrack]);

		useEffect(() => {
			return () => {
				if (isMobile) return;
				if (disablePiP) return;
				const snapshot = pipSnapshotRef.current;
				if (!snapshot.pipTrack) return;
				openPiPForTrack(snapshot.pipTrack);
			};
		}, [disablePiP, isMobile, openPiPForTrack]);

		useEffect(() => {
			if (pipOpen && pipContent?.channelId === channel.id) {
				PiPActionCreators.closePiP();
			}
		}, [pipOpen, pipContent, channel.id]);

		const FavoriteIcon = useMemo(() => {
			const Icon = forwardRef<SVGSVGElement, React.ComponentProps<typeof StarIcon>>((props, ref) => (
				<StarIcon ref={ref} weight={isFavorited ? 'fill' : 'bold'} {...props} />
			));
			Icon.displayName = 'FavoriteIcon';
			return Icon;
		}, [isFavorited]);

		const statsReferencePropsRaw = getStatsReferenceProps();
		const {ref: _statsRef, onClick: statsOnClickRaw, ...statsReferenceProps} = statsReferencePropsRaw;
		const statsOnClick = statsOnClickRaw as React.MouseEventHandler<HTMLButtonElement> | undefined;

		return (
			<div
				ref={containerRef}
				data-voice-call-root
				className={clsx(
					styles.root,
					styles.voiceRoot,
					isVoiceCallAppFullscreen && styles.voiceCallFullscreen,
					isPointerHudActive && styles.pointerActive,
					isChromePinned && styles.contextMenuActive,
					keyboardModeEnabled && styles.keyboardModeActive,
				)}
				onPointerEnter={handleVoiceRootPointerActivity}
				onPointerMove={handleVoiceRootPointerActivity}
				onPointerDown={handleVoiceRootPointerActivity}
				onPointerLeave={handleVoiceRootPointerLeave}
			>
				<output className={styles.srOnly} aria-live="polite" aria-atomic="true">
					{participantCount === 1
						? t`${participantCount} participant in call`
						: t`${participantCount} participants in call`}
				</output>

				<NativeDragRegion className={clsx(channelHeaderStyles.headerContainer, styles.voiceChrome, styles.voiceHeader)}>
					<div className={channelHeaderStyles.headerLeftSection}>
						{isMobile ? (
							<FocusRing offset={-2}>
								<button type="button" className={channelHeaderStyles.backButton} onClick={handleBackClick}>
									<ArrowLeftIcon className={channelHeaderStyles.backIconBold} weight="bold" />
								</button>
							</FocusRing>
						) : (
							<FocusRing offset={-2}>
								<button type="button" className={channelHeaderStyles.backButtonDesktop} onClick={handleBackClick}>
									<ListIcon className={channelHeaderStyles.backIcon} />
								</button>
							</FocusRing>
						)}

						<div className={channelHeaderStyles.leftContentContainer}>
							<div className={channelHeaderStyles.channelInfoContainer}>
								{ChannelUtils.getIcon(channel, {className: channelHeaderStyles.channelIcon})}
								<span className={channelHeaderStyles.channelName}>{channel.name ?? ''}</span>
							</div>

							{isFocusedOnScreenShare && focusedStreamerUser && (
								<StreamFocusHeaderInfo
									streamerUser={focusedStreamerUser}
									streamerDisplayName={focusedStreamerDisplayName}
									viewerUsers={spectatorUsers}
									spectatorEntries={spectatorEntries}
									guildId={channel.guildId ?? undefined}
									channelId={channel.id}
									onOpenChange={handleSpectatorsPopoutOpenChange}
								/>
							)}
						</div>
					</div>

					<div className={channelHeaderStyles.headerRightSection}>
						{isFocusedOnScreenShare && focusedTrackInfo && (
							<div className={styles.headerStreamInfo}>
								<StreamInfoPill info={focusedTrackInfo} />
							</div>
						)}

						{channel && !isMobile && AccessibilityStore.showFavorites && (
							<ChannelHeaderIcon
								icon={FavoriteIcon}
								label={isFavorited ? t`Remove from Favorites` : t`Add to Favorites`}
								isSelected={isFavorited}
								onClick={handleToggleFavorite}
							/>
						)}

						{connectionStateText && (
							<div
								className={clsx(
									styles.connectionStatusContainer,
									connectionState === ConnectionState.Connecting && styles.statusConnecting,
									connectionState === ConnectionState.Reconnecting && styles.statusReconnecting,
									connectionState === ConnectionState.Disconnected && styles.statusDisconnected,
									connectionState === ConnectionState.Connected && styles.statusConnected,
								)}
							>
								<div className={styles.connectionStatusDot} />
								{connectionStateText}
							</div>
						)}

						<ChannelHeaderIcon
							ref={statsRefs.setReference}
							icon={ChartBarIcon}
							label={t`Connection Stats`}
							isSelected={isStatsOpen}
							onClick={statsOnClick}
							aria-expanded={isStatsOpen}
							{...statsReferenceProps}
						/>

						{isMobile && (
							<ChannelHeaderIcon icon={PhoneIcon} label={t`View call controls`} onClick={handleOpenCallSheet} />
						)}

						{!isMobile && <InboxButton />}
					</div>
				</NativeDragRegion>

				<div className={mainContentClassName}>
					<VoiceCallLayoutContent
						channel={channel}
						layoutMode={layoutMode}
						focusMainTrack={focusMainTrack}
						carouselTracks={carouselTracks}
						cameraTracksAll={cameraTracksAll}
						filteredCameraTracks={filteredCameraTracks}
						screenShareTracks={screenShareTracks}
						hasScreenShare={hasScreenShare}
						pinnedParticipantIdentity={pinnedParticipantIdentity}
					/>
				</div>
				<VoiceRoomChatPanel channel={channel} isMobile={isMobile} />

				<div className={clsx(styles.controlBarContainer, styles.voiceChrome)}>
					<VoiceControlBar />
				</div>

				<div className={clsx(styles.fullscreenButtonWrap, styles.voiceChrome)}>
					{supportsVoiceCallAppFullscreen && (
						<ChannelHeaderIcon
							icon={FullscreenButtonIcon}
							label={fullscreenButtonLabel}
							isSelected={isVoiceCallAppFullscreen}
							onClick={handleToggleVoiceCallAppFullscreen}
						/>
					)}
				</div>

				{isStatsOpen &&
					(isMobile ? (
						<BottomSheet
							isOpen={isStatsOpen}
							onClose={() => setIsStatsOpen(false)}
							title={t`Connection Stats`}
							snapPoints={[0.3, 0.65, 0.9]}
						>
							<VoiceStatsOverlay onClose={() => setIsStatsOpen(false)} />
						</BottomSheet>
					) : (
						<FloatingFocusManager context={statsContext} modal={false}>
							<div ref={statsRefs.setFloating} style={{...statsFloatingStyles, zIndex: 30}} {...statsFloatingProps}>
								<VoiceStatsOverlay onClose={() => setIsStatsOpen(false)} />
							</div>
						</FloatingFocusManager>
					))}

				{isMobile && (
					<BottomSheet
						isOpen={isCallSheetOpen}
						onClose={handleCloseCallSheet}
						title={channel.name ?? t`Voice call`}
						snapPoints={[0.35, 0.65, 0.95]}
						disablePadding
						surface="primary"
					>
						<div className={styles.voiceCallSheetContent}>
							<CompactVoiceCallView channel={channel} className={styles.voiceCallSheetCompact} />
						</div>
					</BottomSheet>
				)}
			</div>
		);
	},
);

function hasValidRoomForVoiceCallView(channel: ChannelRecord): boolean {
	const room = MediaEngineStore.room;
	if (!room) return false;
	const normalizedGuildId = channel.guildId ?? null;
	return MediaEngineStore.channelId === channel.id && (MediaEngineStore.guildId ?? null) === normalizedGuildId;
}

export const VoiceCallView = observer(({channel, fullscreenRequestNonce}: VoiceCallViewProps) => {
	if (!hasValidRoomForVoiceCallView(channel)) {
		return null;
	}
	return <VoiceCallViewInner channel={channel} fullscreenRequestNonce={fullscreenRequestNonce} />;
});
