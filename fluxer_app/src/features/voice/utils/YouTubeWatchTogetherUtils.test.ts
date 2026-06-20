// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it} from 'vitest';
import {findYouTubeWatchCandidate, parseYouTubeWatchUrl} from './YouTubeWatchTogetherUtils';

describe('YouTubeWatchTogetherUtils', () => {
	it('parses standard YouTube watch URLs', () => {
		expect(parseYouTubeWatchUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.videoId).toBe('dQw4w9WgXcQ');
	});

	it('parses short URLs and start time strings', () => {
		expect(parseYouTubeWatchUrl('https://youtu.be/dQw4w9WgXcQ?t=1m05s')).toMatchObject({
			videoId: 'dQw4w9WgXcQ',
			startSeconds: 65,
		});
	});

	it('parses shorts, embed, and live URLs', () => {
		expect(parseYouTubeWatchUrl('https://youtube.com/shorts/dQw4w9WgXcQ')?.videoId).toBe('dQw4w9WgXcQ');
		expect(parseYouTubeWatchUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')?.videoId).toBe('dQw4w9WgXcQ');
		expect(parseYouTubeWatchUrl('https://www.youtube.com/live/dQw4w9WgXcQ')?.videoId).toBe('dQw4w9WgXcQ');
	});

	it('finds a YouTube URL inside message text', () => {
		expect(findYouTubeWatchCandidate({text: 'watch this https://youtu.be/dQw4w9WgXcQ.'})?.videoId).toBe(
			'dQw4w9WgXcQ',
		);
	});

	it('rejects non-YouTube URLs and malformed ids', () => {
		expect(parseYouTubeWatchUrl('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
		expect(parseYouTubeWatchUrl('https://youtube.com/watch?v=bad')).toBeNull();
	});
});
