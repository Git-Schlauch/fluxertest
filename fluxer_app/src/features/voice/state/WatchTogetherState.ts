// SPDX-License-Identifier: AGPL-3.0-or-later

import {makeAutoObservable} from 'mobx';

export type WatchTogetherControlAction = 'play' | 'pause' | 'sync';

export interface WatchTogetherParticipant {
	userId: string;
	name: string;
}

export interface WatchTogetherSession {
	id: string;
	channelId: string;
	guildId: string | null;
	hostUserId: string;
	hostName: string;
	videoId: string;
	url: string;
	startSeconds: number;
	createdAt: number;
	participants: WatchTogetherParticipant[];
	acceptedUserIds: string[];
	declinedUserIds: string[];
	startedAt: number | null;
	messageId?: string;
}

export interface WatchTogetherControl {
	sessionId: string;
	channelId: string;
	hostUserId: string;
	actorUserId?: string;
	action: WatchTogetherControlAction;
	positionSeconds: number;
	sentAt: number;
}

class WatchTogetherState {
	pendingInvite: WatchTogetherSession | null = null;
	activeSession: WatchTogetherSession | null = null;
	lastRemoteControl: WatchTogetherControl | null = null;
	remoteControlVersion = 0;
	private declinedSessionIds = new Set<string>();
	private dismissedSessionIds = new Set<string>();

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
	}

	receiveInvite(session: WatchTogetherSession): void {
		if (this.declinedSessionIds.has(session.id)) return;
		if (this.dismissedSessionIds.has(session.id)) return;
		if (this.activeSession?.id === session.id) return;
		this.pendingInvite = session;
	}

	acceptInvite(): WatchTogetherSession | null {
		const invite = this.pendingInvite;
		if (!invite) return null;
		this.pendingInvite = null;
		this.activeSession = invite;
		return invite;
	}

	declineInvite(sessionId?: string): WatchTogetherSession | null {
		const invite = this.pendingInvite;
		const declinedId = sessionId ?? invite?.id;
		if (declinedId) {
			this.declinedSessionIds.add(declinedId);
		}
		if (!invite || (sessionId && invite.id !== sessionId)) {
			return null;
		}
		this.pendingInvite = null;
		return invite;
	}

	startSession(session: WatchTogetherSession): void {
		this.pendingInvite = null;
		this.activeSession = session;
		this.lastRemoteControl = null;
		this.remoteControlVersion += 1;
	}

	markAccepted(sessionId: string, userId: string): void {
		if (this.activeSession?.id !== sessionId) return;
		if (!this.activeSession.acceptedUserIds.includes(userId)) {
			this.activeSession.acceptedUserIds.push(userId);
		}
		this.activeSession.declinedUserIds = this.activeSession.declinedUserIds.filter((id) => id !== userId);
	}

	markDeclined(sessionId: string, userId: string): void {
		if (this.activeSession?.id !== sessionId) return;
		if (!this.activeSession.declinedUserIds.includes(userId)) {
			this.activeSession.declinedUserIds.push(userId);
		}
	}

	markStarted(sessionId: string, startedAt: number): void {
		if (this.dismissedSessionIds.has(sessionId)) return;
		if (this.pendingInvite?.id === sessionId) {
			this.pendingInvite.startedAt = startedAt;
		}
		if (this.activeSession?.id !== sessionId) return;
		this.activeSession.startedAt = startedAt;
	}

	closeSession(sessionId?: string): void {
		const dismissedId = sessionId ?? this.activeSession?.id ?? this.pendingInvite?.id;
		if (dismissedId) {
			this.dismissedSessionIds.add(dismissedId);
		}
		if (!sessionId || this.pendingInvite?.id === sessionId) {
			this.pendingInvite = null;
		}
		if (!sessionId || this.activeSession?.id === sessionId) {
			this.activeSession = null;
			this.lastRemoteControl = null;
		}
	}

	receiveRemoteControl(control: WatchTogetherControl): void {
		if (this.activeSession?.id !== control.sessionId) return;
		this.lastRemoteControl = control;
		this.remoteControlVersion += 1;
	}

	pruneForChannel(channelId: string | null): void {
		if (this.pendingInvite && this.pendingInvite.channelId !== channelId) {
			this.pendingInvite = null;
		}
		if (this.activeSession && this.activeSession.channelId !== channelId) {
			this.closeSession(this.activeSession.id);
		}
	}
}

export default new WatchTogetherState();
