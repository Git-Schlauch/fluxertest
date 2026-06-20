// SPDX-License-Identifier: AGPL-3.0-or-later

import {Button} from '@app/features/ui/button/Button';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import * as WatchTogetherCommands from '@app/features/voice/commands/WatchTogetherCommands';
import {WATCH_TOGETHER_TOPIC, type WatchTogetherMessage} from '@app/features/voice/commands/WatchTogetherCommands';
import MediaEngine, {useMediaEngineVersion} from '@app/features/voice/engine/MediaEngineFacade';
import WatchTogetherState, {
	type WatchTogetherParticipant,
	type WatchTogetherSession,
} from '@app/features/voice/state/WatchTogetherState';
import Users from '@app/features/user/state/Users';
import {Trans} from '@lingui/react/macro';
import {MonitorPlayIcon, PauseIcon, PlayIcon, XIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
} from 'react';
import {RoomEvent, type Participant} from 'livekit-client';
import styles from './WatchTogetherLayer.module.css';

const YOUTUBE_EMBED_ORIGIN = 'https://www.youtube.com';
const YOUTUBE_PLAYER_STATE = {
	PLAYING: 1,
	PAUSED: 2,
} as const;

interface YouTubeInfoDelivery {
	currentTime?: unknown;
	playerState?: unknown;
}

interface YouTubeFrameMessage {
	event?: unknown;
	info?: unknown;
}

function decodeWatchTogetherMessage(payload: Uint8Array): WatchTogetherMessage | null {
	try {
		const parsed = JSON.parse(new TextDecoder().decode(payload)) as Partial<WatchTogetherMessage>;
		if (parsed.protocolVersion !== 1 || typeof parsed.type !== 'string') {
			return null;
		}
		return parsed as WatchTogetherMessage;
	} catch {
		return null;
	}
}

function isSessionForCurrentVoiceChannel(session: WatchTogetherSession): boolean {
	return session.channelId === MediaEngine.channelId && session.guildId === MediaEngine.guildId;
}

const PLAYER_DEFAULT_WIDTH = 720;
const PLAYER_DEFAULT_HEIGHT = 460;
const PLAYER_MARGIN = 16;

function createYouTubeEmbedUrl(session: WatchTogetherSession, hasStarted: boolean): string {
	const url = new URL(`https://www.youtube.com/embed/${encodeURIComponent(session.videoId)}`);
	url.searchParams.set('autoplay', hasStarted ? '1' : '0');
	url.searchParams.set('enablejsapi', '1');
	url.searchParams.set('playsinline', '1');
	url.searchParams.set('rel', '0');
	url.searchParams.set('modestbranding', '1');
	url.searchParams.set('origin', window.location.origin);
	if (session.startSeconds > 0) {
		url.searchParams.set('start', Math.floor(session.startSeconds).toString());
	}
	return url.toString();
}

function createInitialPlayerPlacement(): {x: number; y: number; width: number; height: number} {
	if (typeof window === 'undefined') {
		return {x: 0, y: 0, width: PLAYER_DEFAULT_WIDTH, height: PLAYER_DEFAULT_HEIGHT};
	}
	const width = Math.min(PLAYER_DEFAULT_WIDTH, window.innerWidth - PLAYER_MARGIN * 2);
	const height = Math.min(PLAYER_DEFAULT_HEIGHT, window.innerHeight - PLAYER_MARGIN * 2);
	return {
		x: Math.max(PLAYER_MARGIN, window.innerWidth - width - PLAYER_MARGIN),
		y: Math.max(PLAYER_MARGIN, window.innerHeight - height - PLAYER_MARGIN),
		width,
		height,
	};
}

function clampPlayerPlacement(x: number, y: number, width: number, height: number): {x: number; y: number} {
	return {
		x: Math.min(Math.max(PLAYER_MARGIN, x), Math.max(PLAYER_MARGIN, window.innerWidth - width - PLAYER_MARGIN)),
		y: Math.min(Math.max(PLAYER_MARGIN, y), Math.max(PLAYER_MARGIN, window.innerHeight - height - PLAYER_MARGIN)),
	};
}

function shouldKeepIframePointerEnabled(): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia('(hover: none), (pointer: coarse)').matches;
}

function hasUserAccepted(session: WatchTogetherSession, userId: string | null): boolean {
	return Boolean(userId && session.acceptedUserIds.includes(userId));
}

function getWaitingParticipants(session: WatchTogetherSession): WatchTogetherParticipant[] {
	return session.participants.filter(
		(participant) =>
			participant.userId !== session.hostUserId &&
			!session.acceptedUserIds.includes(participant.userId) &&
			!session.declinedUserIds.includes(participant.userId),
	);
}

function haveAllParticipantsAccepted(session: WatchTogetherSession): boolean {
	return session.participants.every((participant) => session.acceptedUserIds.includes(participant.userId));
}

function postYouTubeEvent(iframe: HTMLIFrameElement | null, event: Record<string, unknown>): void {
	iframe?.contentWindow?.postMessage(JSON.stringify(event), YOUTUBE_EMBED_ORIGIN);
}

function postYouTubeCommand(iframe: HTMLIFrameElement | null, func: string, args: unknown[] = []): void {
	postYouTubeEvent(iframe, {event: 'command', func, args});
}

function parseYouTubeFrameMessage(data: unknown): YouTubeFrameMessage | null {
	if (typeof data === 'object' && data !== null) {
		return data as YouTubeFrameMessage;
	}
	if (typeof data !== 'string' || !data.startsWith('{')) {
		return null;
	}
	try {
		const parsed = JSON.parse(data) as unknown;
		return typeof parsed === 'object' && parsed !== null ? (parsed as YouTubeFrameMessage) : null;
	} catch {
		return null;
	}
}

function getInfoDelivery(message: YouTubeFrameMessage): YouTubeInfoDelivery | null {
	return typeof message.info === 'object' && message.info !== null ? (message.info as YouTubeInfoDelivery) : null;
}

function readMessageCurrentTime(message: YouTubeFrameMessage): number | null {
	const info = getInfoDelivery(message);
	if (!info || typeof info.currentTime !== 'number' || !Number.isFinite(info.currentTime)) {
		return null;
	}
	return info.currentTime;
}

function readMessagePlayerState(message: YouTubeFrameMessage): number | null {
	if (message.event === 'onStateChange' && typeof message.info === 'number') {
		return message.info;
	}
	const info = getInfoDelivery(message);
	if (!info || typeof info.playerState !== 'number') {
		return null;
	}
	return info.playerState;
}

const WatchTogetherPlayer = observer(({session}: {session: WatchTogetherSession}) => {
	const currentUserId = Users.currentUserId;
	const isHost = currentUserId === session.hostUserId;
	const hasStarted = Boolean(session.startedAt);
	const canControl = hasStarted && hasUserAccepted(session, currentUserId);
	const waitingParticipants = getWaitingParticipants(session);
	const allParticipantsAccepted = haveAllParticipantsAccepted(session);
	const embedUrl = useMemo(() => createYouTubeEmbedUrl(session, hasStarted), [hasStarted, session]);
	const [placement, setPlacement] = useState(createInitialPlayerPlacement);
	const [allowIframePointer, setAllowIframePointer] = useState(shouldKeepIframePointerEnabled);
	const [playerState, setPlayerState] = useState<number | null>(null);
	const panelRef = useRef<HTMLElement | null>(null);
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const iframePointerTimeoutRef = useRef<number | null>(null);
	const keepIframePointerEnabledRef = useRef(shouldKeepIframePointerEnabled());
	const lastPositionRef = useRef(session.startSeconds);
	const lastPlayerStateRef = useRef<number | null>(null);
	const lastPublishedStateRef = useRef<number | null>(null);
	const suppressControlRef = useRef(false);
	const remoteControlVersion = WatchTogetherState.remoteControlVersion;
	const remoteControl = WatchTogetherState.lastRemoteControl;

	const publishStart = useCallback(() => {
		if (!isHost || session.startedAt) return;
		void WatchTogetherCommands.publishStart(session).catch(() => {
			ToastCommands.error('Could not start watch together.');
		});
	}, [isHost, session]);

	const startListening = useCallback(() => {
		postYouTubeEvent(iframeRef.current, {event: 'listening', id: session.id});
	}, [session.id]);

	const publishControl = useCallback(
		(action: 'play' | 'pause' | 'sync') => {
			if (!canControl || !currentUserId) return;
			void WatchTogetherCommands.publishControl({
				sessionId: session.id,
				channelId: session.channelId,
				hostUserId: session.hostUserId,
				actorUserId: currentUserId,
				action,
				positionSeconds: lastPositionRef.current,
				sentAt: Date.now(),
			}).catch(() => undefined);
		},
		[canControl, currentUserId, session.channelId, session.hostUserId, session.id],
	);

	const disableIframePointer = useCallback(() => {
		if (iframePointerTimeoutRef.current !== null) {
			window.clearTimeout(iframePointerTimeoutRef.current);
			iframePointerTimeoutRef.current = null;
		}
		if (keepIframePointerEnabledRef.current) {
			setAllowIframePointer(true);
			return;
		}
		setAllowIframePointer(false);
		iframeRef.current?.blur();
		window.focus();
	}, []);

	const enableIframePointer = useCallback(() => {
		if (iframePointerTimeoutRef.current !== null) {
			window.clearTimeout(iframePointerTimeoutRef.current);
			iframePointerTimeoutRef.current = null;
		}
		setAllowIframePointer(true);
	}, []);

	const scheduleIframePointerDisable = useCallback(
		(delayMs = 5000) => {
			if (iframePointerTimeoutRef.current !== null) {
				window.clearTimeout(iframePointerTimeoutRef.current);
			}
			iframePointerTimeoutRef.current = window.setTimeout(disableIframePointer, delayMs);
		},
		[disableIframePointer],
	);

	const closePlayer = useCallback(() => {
		disableIframePointer();
		WatchTogetherState.closeSession(session.id);
	}, [disableIframePointer, session.id]);

	const handleLocalPlayPause = useCallback(() => {
		if (!canControl) return;
		disableIframePointer();
		const action = lastPlayerStateRef.current === YOUTUBE_PLAYER_STATE.PLAYING ? 'pause' : 'play';
		const nextState = action === 'play' ? YOUTUBE_PLAYER_STATE.PLAYING : YOUTUBE_PLAYER_STATE.PAUSED;
		lastPublishedStateRef.current = nextState;
		lastPlayerStateRef.current = nextState;
		setPlayerState(nextState);
		postYouTubeCommand(iframeRef.current, action === 'play' ? 'playVideo' : 'pauseVideo');
		publishControl(action);
	}, [canControl, disableIframePointer, publishControl]);

	const handleOverlayButtonPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>) => {
			event.stopPropagation();
			disableIframePointer();
		},
		[disableIframePointer],
	);

	const handleDragStart = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			if ((event.target as HTMLElement).closest('button')) return;
			event.preventDefault();
			disableIframePointer();
			const dragHandle = event.currentTarget;
			dragHandle.setPointerCapture(event.pointerId);
			const panel = panelRef.current;
			const rect = panel?.getBoundingClientRect();
			const startX = event.clientX;
			const startY = event.clientY;
			const originX = rect?.left ?? placement.x;
			const originY = rect?.top ?? placement.y;
			const width = rect?.width ?? placement.width;
			const height = rect?.height ?? placement.height;
			const handleMove = (moveEvent: PointerEvent): void => {
				const next = clampPlayerPlacement(
					originX + moveEvent.clientX - startX,
					originY + moveEvent.clientY - startY,
					width,
					height,
				);
				setPlacement((current) => ({...current, ...next}));
			};
			const handleUp = (): void => {
				if (dragHandle.hasPointerCapture(event.pointerId)) {
					dragHandle.releasePointerCapture(event.pointerId);
				}
				document.removeEventListener('pointermove', handleMove);
				document.removeEventListener('pointerup', handleUp);
			};
			document.addEventListener('pointermove', handleMove);
			document.addEventListener('pointerup', handleUp, {once: true});
		},
		[disableIframePointer, placement.height, placement.width, placement.x, placement.y],
	);

	const handleResizePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			event.stopPropagation();
			disableIframePointer();
			const resizeHandle = event.currentTarget;
			resizeHandle.setPointerCapture(event.pointerId);
			const startX = event.clientX;
			const startY = event.clientY;
			const startWidth = panelRef.current?.getBoundingClientRect().width ?? placement.width;
			const startHeight = panelRef.current?.getBoundingClientRect().height ?? placement.height;
			const handleMove = (moveEvent: PointerEvent): void => {
				setPlacement((current) => {
					const width = Math.min(
						Math.max(360, startWidth + moveEvent.clientX - startX),
						window.innerWidth - current.x - PLAYER_MARGIN,
					);
					const height = Math.min(
						Math.max(260, startHeight + moveEvent.clientY - startY),
						window.innerHeight - current.y - PLAYER_MARGIN,
					);
					return {...current, width, height};
				});
			};
			const handleUp = (): void => {
				if (resizeHandle.hasPointerCapture(event.pointerId)) {
					resizeHandle.releasePointerCapture(event.pointerId);
				}
				document.removeEventListener('pointermove', handleMove);
				document.removeEventListener('pointerup', handleUp);
			};
			document.addEventListener('pointermove', handleMove);
			document.addEventListener('pointerup', handleUp, {once: true});
		},
		[disableIframePointer, placement.height, placement.width],
	);

	useEffect(() => {
		const handleResize = (): void => {
			setPlacement((current) => ({
				...current,
				...clampPlayerPlacement(current.x, current.y, current.width, current.height),
			}));
		};
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	}, []);

	useEffect(() => {
		const mediaQuery = window.matchMedia('(hover: none), (pointer: coarse)');
		const updateIframePointerMode = (): void => {
			keepIframePointerEnabledRef.current = mediaQuery.matches;
			if (mediaQuery.matches) {
				setAllowIframePointer(true);
			}
		};
		updateIframePointerMode();
		mediaQuery.addEventListener('change', updateIframePointerMode);
		return () => mediaQuery.removeEventListener('change', updateIframePointerMode);
	}, []);

	useEffect(() => {
		if (isHost && !hasStarted && allParticipantsAccepted) {
			publishStart();
		}
	}, [allParticipantsAccepted, hasStarted, isHost, publishStart]);

	useEffect(() => {
		const handler = (event: MessageEvent<unknown>): void => {
			if (event.origin !== YOUTUBE_EMBED_ORIGIN || event.source !== iframeRef.current?.contentWindow) {
				return;
			}
			const message = parseYouTubeFrameMessage(event.data);
			if (!message) return;
			const currentTime = readMessageCurrentTime(message);
			if (currentTime !== null) {
				lastPositionRef.current = currentTime;
			}
			const playerState = readMessagePlayerState(message);
			if (playerState === null) return;
			lastPlayerStateRef.current = playerState;
			setPlayerState(playerState);
			if (!hasStarted && playerState === YOUTUBE_PLAYER_STATE.PLAYING) {
				postYouTubeCommand(iframeRef.current, 'pauseVideo');
				return;
			}
			if (
				!canControl ||
				suppressControlRef.current ||
				(playerState !== YOUTUBE_PLAYER_STATE.PLAYING && playerState !== YOUTUBE_PLAYER_STATE.PAUSED)
			) {
				return;
			}
			if (lastPublishedStateRef.current === playerState) return;
			lastPublishedStateRef.current = playerState;
			publishControl(playerState === YOUTUBE_PLAYER_STATE.PLAYING ? 'play' : 'pause');
		};
		window.addEventListener('message', handler);
		return () => window.removeEventListener('message', handler);
	}, [canControl, hasStarted, publishControl]);

	useEffect(() => {
		startListening();
		const firstRetry = window.setTimeout(startListening, 500);
		const secondRetry = window.setTimeout(startListening, 1500);
		return () => {
			window.clearTimeout(firstRetry);
			window.clearTimeout(secondRetry);
		};
	}, [embedUrl, startListening]);

	useEffect(() => {
		return () => {
			if (iframePointerTimeoutRef.current !== null) {
				window.clearTimeout(iframePointerTimeoutRef.current);
			}
		};
	}, []);

	useEffect(() => {
		if (!hasStarted) return;
		startListening();
		const firstPlay = window.setTimeout(() => postYouTubeCommand(iframeRef.current, 'playVideo'), 350);
		const secondPlay = window.setTimeout(() => postYouTubeCommand(iframeRef.current, 'playVideo'), 1200);
		return () => {
			window.clearTimeout(firstPlay);
			window.clearTimeout(secondPlay);
		};
	}, [hasStarted, startListening]);

	useEffect(() => {
		if (!isHost) return;
		const interval = window.setInterval(() => {
			if (lastPlayerStateRef.current === YOUTUBE_PLAYER_STATE.PLAYING) {
				publishControl('sync');
			}
		}, 5000);
		return () => window.clearInterval(interval);
	}, [isHost, publishControl]);

	useEffect(() => {
		if (!remoteControl || remoteControl.sessionId !== session.id) return;
		if (remoteControl.actorUserId && remoteControl.actorUserId === currentUserId) return;
		if (!remoteControl.actorUserId && remoteControl.hostUserId === currentUserId) return;
		const driftSeconds = Math.abs(lastPositionRef.current - remoteControl.positionSeconds);
		const shouldSeek = remoteControl.action === 'sync' ? driftSeconds > 5 : driftSeconds > 2;
		suppressControlRef.current = true;
		if (shouldSeek) {
			postYouTubeCommand(iframeRef.current, 'seekTo', [remoteControl.positionSeconds, true]);
			lastPositionRef.current = remoteControl.positionSeconds;
		}
		if (remoteControl.action === 'sync') {
			window.setTimeout(() => {
				suppressControlRef.current = false;
			}, 350);
			return;
		}
		if (remoteControl.action === 'pause') {
			postYouTubeCommand(iframeRef.current, 'pauseVideo');
			lastPlayerStateRef.current = YOUTUBE_PLAYER_STATE.PAUSED;
			setPlayerState(YOUTUBE_PLAYER_STATE.PAUSED);
		} else {
			postYouTubeCommand(iframeRef.current, 'playVideo');
			lastPlayerStateRef.current = YOUTUBE_PLAYER_STATE.PLAYING;
			setPlayerState(YOUTUBE_PLAYER_STATE.PLAYING);
		}
		window.setTimeout(() => {
			suppressControlRef.current = false;
		}, 350);
	}, [currentUserId, remoteControl, remoteControlVersion, session.id]);

	return (
		<section
			ref={panelRef}
			className={styles.playerPanel}
			style={{left: placement.x, top: placement.y, width: placement.width, height: placement.height}}
			aria-label="Watch together player"
			data-flx="voice.watch-together.player"
		>
			<div
				className={styles.playerHeader}
				onPointerDown={handleDragStart}
				data-flx="voice.watch-together.player-header"
			>
				<div className={styles.hostLabel} data-flx="voice.watch-together.player-host-label">
					<p className={styles.title} data-flx="voice.watch-together.player-title">
						<Trans>Watch together</Trans>
					</p>
					<span className={styles.meta} data-flx="voice.watch-together.player-meta">
						{hasStarted ? (
							<Trans>{session.acceptedUserIds.length} watching</Trans>
						) : isHost && waitingParticipants.length > 0 ? (
							<Trans>Waiting for {waitingParticipants.length} people</Trans>
						) : isHost ? (
							<Trans>Ready to start</Trans>
						) : (
							<Trans>Hosted by {session.hostName}</Trans>
						)}
					</span>
				</div>
				{isHost && !hasStarted && (
					<Button
						compact
						onPointerDown={(event) => {
							event.stopPropagation();
							disableIframePointer();
						}}
						onClick={publishStart}
						data-flx="voice.watch-together.manual-start-button"
					>
						<Trans>Start</Trans>
					</Button>
				)}
				<Button
					square
					variant="secondary"
					compact
					aria-label="Close watch together"
					icon={<XIcon size={16} weight="bold" />}
					onPointerDown={(event) => {
						event.preventDefault();
						event.stopPropagation();
						closePlayer();
					}}
					onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
						event.stopPropagation();
						closePlayer();
					}}
					data-flx="voice.watch-together.close-player-button"
				/>
			</div>
			<div
				className={styles.playerFrame}
				onPointerEnter={enableIframePointer}
				onPointerLeave={disableIframePointer}
				data-flx="voice.watch-together.player-frame"
			>
				{/* biome-ignore lint/a11y/useIframeTitle: project policy forbids the native title attribute (NoNativeTitleAttribute test); aria-label provides the accessible name */}
				<iframe
					key={session.id}
					ref={iframeRef}
					className={allowIframePointer ? styles.playerIframeInteractive : undefined}
					allow="autoplay; fullscreen"
					allowFullScreen
					sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
					src={embedUrl}
					aria-label="Watch together YouTube video"
					onLoad={startListening}
					onPointerDown={() => scheduleIframePointerDisable()}
					data-flx="voice.watch-together.player-iframe"
				/>
				{!hasStarted && (
					<div className={styles.lobbyOverlay} data-flx="voice.watch-together.lobby-overlay">
						<p className={styles.lobbyTitle} data-flx="voice.watch-together.lobby-title">
							<Trans>Waiting to start</Trans>
						</p>
						<p className={styles.lobbyText} data-flx="voice.watch-together.lobby-text">
							{isHost && waitingParticipants.length > 0 ? (
								<Trans>Playback will begin when everyone has joined, or you can start manually.</Trans>
							) : isHost ? (
								<Trans>Everyone is ready.</Trans>
							) : (
								<Trans>Playback will begin when the host starts the watch party.</Trans>
							)}
						</p>
					</div>
				)}
				<div className={styles.touchControls} data-flx="voice.watch-together.touch-controls">
					{canControl && (
						<Button
							square
							variant="secondary"
							compact
							aria-label={
								playerState === YOUTUBE_PLAYER_STATE.PLAYING
									? 'Pause watch together video'
									: 'Play watch together video'
							}
							icon={
								playerState === YOUTUBE_PLAYER_STATE.PLAYING ? (
									<PauseIcon size={18} weight="fill" />
								) : (
									<PlayIcon size={18} weight="fill" />
								)
							}
							onPointerDown={handleOverlayButtonPointerDown}
							onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
								event.preventDefault();
								event.stopPropagation();
								handleLocalPlayPause();
							}}
							data-flx="voice.watch-together.touch-play-pause-button"
						/>
					)}
					<Button
						square
						variant="secondary"
						compact
						aria-label="Close watch together"
						icon={<XIcon size={16} weight="bold" />}
						onPointerDown={handleOverlayButtonPointerDown}
						onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
							event.preventDefault();
							event.stopPropagation();
							closePlayer();
						}}
						data-flx="voice.watch-together.touch-close-player-button"
					/>
				</div>
			</div>
			<div
				className={styles.resizeHandle}
				role="separator"
				aria-label="Resize watch together player"
				onPointerDown={handleResizePointerDown}
				data-flx="voice.watch-together.resize-handle"
			/>
		</section>
	);
});

WatchTogetherPlayer.displayName = 'WatchTogetherPlayer';

export const WatchTogetherLayer = observer(() => {
	useMediaEngineVersion();
	const currentUser = Users.getCurrentUser();
	const pendingInvite = WatchTogetherState.pendingInvite;
	const activeSession = WatchTogetherState.activeSession;
	const currentChannelId = MediaEngine.channelId;

	useEffect(() => {
		WatchTogetherState.pruneForChannel(currentChannelId);
	}, [currentChannelId]);

	useEffect(() => {
		const room = MediaEngine.room;
		if (!room) return;
		const handler = (payload: Uint8Array, _participant?: Participant, _kind?: unknown, topic?: string): void => {
			if (topic !== WATCH_TOGETHER_TOPIC) return;
			const message = decodeWatchTogetherMessage(payload);
			if (!message) return;
			const currentUserId = Users.currentUserId;
			if (message.type === 'invite') {
				if (!isSessionForCurrentVoiceChannel(message.session)) return;
				if (message.session.hostUserId === currentUserId) return;
				WatchTogetherState.receiveInvite(message.session);
				return;
			}
			if (message.type === 'response') {
				if (message.hostUserId !== currentUserId || WatchTogetherState.activeSession?.id !== message.sessionId) {
					return;
				}
				if (message.accepted) {
					WatchTogetherState.markAccepted(message.sessionId, message.userId);
				} else {
					WatchTogetherState.markDeclined(message.sessionId, message.userId);
				}
				ToastCommands.success(
					message.accepted
						? `${message.userName} joined watch together.`
						: `${message.userName} declined watch together.`,
				);
				return;
			}
			if (message.type === 'start') {
				const targetSession = WatchTogetherState.activeSession ?? WatchTogetherState.pendingInvite;
				if (message.hostUserId !== targetSession?.hostUserId) return;
				WatchTogetherState.markStarted(message.sessionId, message.startedAt);
				return;
			}
			if (message.type === 'control') {
				if (message.control.channelId !== MediaEngine.channelId) return;
				WatchTogetherState.receiveRemoteControl(message.control);
			}
		};
		room.on(RoomEvent.DataReceived, handler);
		return () => {
			room.off(RoomEvent.DataReceived, handler);
		};
	}, [currentChannelId]);

	const inviteActions = useMemo(() => {
		if (!pendingInvite || !currentUser) return null;
		const publishResponse = (accepted: boolean, session: WatchTogetherSession) => {
			void WatchTogetherCommands.publishResponse({
				session,
				userId: currentUser.id,
				userName: currentUser.displayName,
				accepted,
			}).catch(() => undefined);
		};
		return {
			accept: () => {
				const accepted = WatchTogetherState.acceptInvite();
				if (accepted) {
					WatchTogetherState.markAccepted(accepted.id, currentUser.id);
					publishResponse(true, accepted);
				}
			},
			decline: () => {
				const declined = WatchTogetherState.declineInvite();
				if (declined) {
					publishResponse(false, declined);
				}
			},
		};
	}, [currentUser, pendingInvite]);

	if (!pendingInvite && !activeSession) {
		return null;
	}

	return (
		<div className={styles.layer} data-flx="voice.watch-together.layer">
			{pendingInvite && inviteActions && (
				<section
					className={styles.invite}
					aria-label="Watch together invitation"
					data-flx="voice.watch-together.invite"
				>
					<div className={styles.inviteHeader} data-flx="voice.watch-together.invite-header">
						<p className={styles.title} data-flx="voice.watch-together.invite-title">
							<MonitorPlayIcon size={18} weight="fill" /> <Trans>Watch together</Trans>
						</p>
						<Button
							square
							variant="secondary"
							compact
							aria-label="Dismiss watch together invitation"
							icon={<XIcon size={16} weight="bold" />}
							onClick={inviteActions.decline}
							data-flx="voice.watch-together.dismiss-invite-button"
						/>
					</div>
					<p className={styles.description} data-flx="voice.watch-together.invite-description">
						<Trans>{pendingInvite.hostName} wants to watch a YouTube video with this voice channel.</Trans>
					</p>
					<div className={styles.actions} data-flx="voice.watch-together.invite-actions">
						<Button variant="secondary" compact onClick={inviteActions.decline}>
							<Trans>Decline</Trans>
						</Button>
						<Button compact onClick={inviteActions.accept}>
							<Trans>Accept</Trans>
						</Button>
					</div>
				</section>
			)}
			{activeSession && <WatchTogetherPlayer session={activeSession} />}
		</div>
	);
});

WatchTogetherLayer.displayName = 'WatchTogetherLayer';
