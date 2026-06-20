// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Message} from '@app/features/messaging/models/MessagingMessage';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import Users from '@app/features/user/state/Users';
import MediaEngine from '@app/features/voice/engine/MediaEngineFacade';
import WatchTogetherState, {
	type WatchTogetherControl,
	type WatchTogetherParticipant,
	type WatchTogetherSession,
} from '@app/features/voice/state/WatchTogetherState';
import {isIPTVVoiceParticipantIdentity, parseVoiceParticipantIdentity} from '@app/features/voice/utils/VoiceParticipantIdentity';
import type {YouTubeWatchCandidate} from '@app/features/voice/utils/YouTubeWatchTogetherUtils';
import {findYouTubeWatchCandidate} from '@app/features/voice/utils/YouTubeWatchTogetherUtils';

export const WATCH_TOGETHER_TOPIC = 'fluxer.watch-together.v1';

const TEXT_ENCODER = new TextEncoder();

export type WatchTogetherMessage =
	| {type: 'invite'; protocolVersion: 1; session: WatchTogetherSession}
	| {
			type: 'response';
			protocolVersion: 1;
			sessionId: string;
			hostUserId: string;
			userId: string;
			userName: string;
			accepted: boolean;
	  }
	| {type: 'start'; protocolVersion: 1; sessionId: string; hostUserId: string; startedAt: number}
	| {type: 'control'; protocolVersion: 1; control: WatchTogetherControl};

function createSessionId(messageId: string): string {
	const randomPart = Math.random().toString(36).slice(2, 10);
	return `${messageId}-${Date.now().toString(36)}-${randomPart}`;
}

function getDisplayNameForUserId(userId: string): string {
	return Users.getUser(userId)?.displayName ?? (Users.currentUserId === userId ? Users.getCurrentUser()?.displayName : undefined) ?? userId;
}

function collectCurrentVoiceParticipants(): WatchTogetherParticipant[] {
	const room = MediaEngine.room;
	const participants = new Map<string, WatchTogetherParticipant>();
	const addIdentity = (identity: string): void => {
		if (!identity || isIPTVVoiceParticipantIdentity(identity)) return;
		const {userId} = parseVoiceParticipantIdentity(identity);
		if (!userId || participants.has(userId)) return;
		participants.set(userId, {userId, name: getDisplayNameForUserId(userId)});
	};
	if (room?.localParticipant.identity) {
		addIdentity(room.localParticipant.identity);
	}
	for (const participant of room?.remoteParticipants.values() ?? []) {
		addIdentity(participant.identity);
	}
	return Array.from(participants.values());
}

async function publishWatchTogetherMessage(message: WatchTogetherMessage): Promise<void> {
	const room = MediaEngine.room;
	if (!room) {
		throw new Error('You need to be connected to a voice channel.');
	}
	await room.localParticipant.publishData(TEXT_ENCODER.encode(JSON.stringify(message)), {
		reliable: true,
		topic: WATCH_TOGETHER_TOPIC,
	});
}

export async function startFromMessage(params: {
	message: Message;
	linkUrl?: string | null;
	candidate?: YouTubeWatchCandidate | null;
}): Promise<void> {
	const candidate =
		params.candidate ?? findYouTubeWatchCandidate({linkUrl: params.linkUrl, text: params.message.content});
	if (!candidate) {
		ToastCommands.error('This is not a supported YouTube link.');
		return;
	}
	if (!params.message.isCurrentUserAuthor()) {
		ToastCommands.error('Only the person who posted the YouTube link can start watch together.');
		return;
	}
	const channelId = MediaEngine.channelId;
	if (!channelId || !MediaEngine.room) {
		ToastCommands.error('Join a voice channel first.');
		return;
	}
	const session: WatchTogetherSession = {
		id: createSessionId(params.message.id),
		channelId,
		guildId: MediaEngine.guildId,
		hostUserId: params.message.author.id,
		hostName: params.message.author.displayName,
		videoId: candidate.videoId,
		url: candidate.url,
		startSeconds: candidate.startSeconds,
		createdAt: Date.now(),
		participants: collectCurrentVoiceParticipants(),
		acceptedUserIds: [params.message.author.id],
		declinedUserIds: [],
		startedAt: null,
		messageId: params.message.id,
	};

	try {
		await publishWatchTogetherMessage({type: 'invite', protocolVersion: 1, session});
		WatchTogetherState.startSession(session);
		ToastCommands.success('Watch together started.');
	} catch {
		ToastCommands.error('Could not start watch together.');
	}
}

export async function publishStart(session: WatchTogetherSession): Promise<void> {
	const startedAt = Date.now();
	WatchTogetherState.markStarted(session.id, startedAt);
	await publishWatchTogetherMessage({
		type: 'start',
		protocolVersion: 1,
		sessionId: session.id,
		hostUserId: session.hostUserId,
		startedAt,
	});
}

export async function publishResponse(params: {
	session: WatchTogetherSession;
	userId: string;
	userName: string;
	accepted: boolean;
}): Promise<void> {
	await publishWatchTogetherMessage({
		type: 'response',
		protocolVersion: 1,
		sessionId: params.session.id,
		hostUserId: params.session.hostUserId,
		userId: params.userId,
		userName: params.userName,
		accepted: params.accepted,
	});
}

export async function publishControl(control: WatchTogetherControl): Promise<void> {
	await publishWatchTogetherMessage({
		type: 'control',
		protocolVersion: 1,
		control: {...control, actorUserId: control.actorUserId ?? Users.currentUserId ?? undefined},
	});
}
