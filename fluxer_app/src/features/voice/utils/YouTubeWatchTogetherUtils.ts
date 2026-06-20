// SPDX-License-Identifier: AGPL-3.0-or-later

const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION_RE = /[),.!?;:]+$/;

export interface YouTubeWatchCandidate {
	videoId: string;
	url: string;
	startSeconds: number;
}

function isYouTubeHost(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	return (
		normalized === 'youtu.be' ||
		normalized === 'youtube.com' ||
		normalized === 'www.youtube.com' ||
		normalized === 'm.youtube.com' ||
		normalized === 'music.youtube.com' ||
		normalized.endsWith('.youtube-nocookie.com')
	);
}

function normalizeVideoId(videoId: string | null | undefined): string | null {
	if (!videoId) return null;
	const trimmed = videoId.trim();
	if (!YOUTUBE_VIDEO_ID_RE.test(trimmed)) return null;
	return trimmed;
}

function parseStartTime(raw: string | null): number {
	if (!raw) return 0;
	const trimmed = raw.trim().toLowerCase();
	if (!trimmed) return 0;
	if (/^\d+$/.test(trimmed)) {
		return Math.max(0, Number.parseInt(trimmed, 10));
	}
	const match = trimmed.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
	if (!match) return 0;
	const hours = Number.parseInt(match[1] ?? '0', 10);
	const minutes = Number.parseInt(match[2] ?? '0', 10);
	const seconds = Number.parseInt(match[3] ?? '0', 10);
	return hours * 3600 + minutes * 60 + seconds;
}

function cleanCandidateUrl(candidate: string): string {
	let cleaned = candidate.trim();
	while (TRAILING_PUNCTUATION_RE.test(cleaned)) {
		cleaned = cleaned.replace(TRAILING_PUNCTUATION_RE, '');
	}
	return cleaned;
}

export function parseYouTubeWatchUrl(input: string): YouTubeWatchCandidate | null {
	const cleaned = cleanCandidateUrl(input);
	let url: URL;
	try {
		url = new URL(cleaned);
	} catch {
		return null;
	}
	if (!isYouTubeHost(url.hostname)) return null;

	let videoId: string | null = null;
	if (url.hostname.toLowerCase() === 'youtu.be') {
		videoId = normalizeVideoId(url.pathname.split('/').filter(Boolean)[0]);
	} else if (url.pathname === '/watch') {
		videoId = normalizeVideoId(url.searchParams.get('v'));
	} else {
		const [kind, id] = url.pathname.split('/').filter(Boolean);
		if (kind === 'embed' || kind === 'shorts' || kind === 'live') {
			videoId = normalizeVideoId(id);
		}
	}

	if (!videoId) return null;
	return {
		videoId,
		url: cleaned,
		startSeconds: parseStartTime(url.searchParams.get('t') ?? url.searchParams.get('start')),
	};
}

export function findYouTubeWatchCandidate(params: {
	linkUrl?: string | null;
	text?: string | null;
}): YouTubeWatchCandidate | null {
	if (params.linkUrl) {
		const fromLink = parseYouTubeWatchUrl(params.linkUrl);
		if (fromLink) return fromLink;
	}

	const text = params.text ?? '';
	for (const match of text.matchAll(URL_RE)) {
		const candidate = parseYouTubeWatchUrl(match[0]);
		if (candidate) return candidate;
	}
	return null;
}
