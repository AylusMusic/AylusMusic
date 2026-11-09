import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, formatTime, formatBytes, fuzzySimilarity, scoreTrackMatch, generateId } from '../js/utils.js';

test('sanitize strips HTML tags and escapes special characters', () => {
  assert.equal(sanitize('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
  assert.equal(sanitize('John & Jane'), 'John &amp; Jane');
  assert.equal(sanitize("Let's rock"), 'Let&#x27;s rock');
});

test('formatTime correctly formats seconds to mm:ss and hh:mm:ss', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(45), '0:45');
  assert.equal(formatTime(75), '1:15');
  assert.equal(formatTime(3600), '1:00:00');
  assert.equal(formatTime(3665), '1:01:05');
  assert.equal(formatTime(NaN), '0:00');
});

test('formatBytes formats file sizes correctly', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(1048576), '1 MB');
  assert.equal(formatBytes(1073741824 * 2.5), '2.5 GB');
});

test('fuzzySimilarity matches identical and similar titles', () => {
  assert.equal(fuzzySimilarity('Viva La Vida', 'Viva La Vida'), 1.0);
  assert.ok(fuzzySimilarity('Viva La Vida', 'viva la vida') > 0.95);
  assert.ok(fuzzySimilarity('Viva La Vida', 'Viva La Vida (Official Audio)') >= 0.8);
  assert.ok(fuzzySimilarity('Coldplay', 'Metallica') < 0.4);
});

test('scoreTrackMatch correctly scores candidate local music files', () => {
  const track = { title: 'Yellow', artist: 'Coldplay' };
  const goodMatch = { name: 'Coldplay - Yellow.mp3' };
  const badMatch = { name: 'Adele - Hello.mp3' };

  const score1 = scoreTrackMatch(track, goodMatch);
  const score2 = scoreTrackMatch(track, badMatch);

  assert.ok(score1 > 0.8, `Expected score1 > 0.8, got ${score1}`);
  assert.ok(score2 < 0.5, `Expected score2 < 0.5, got ${score2}`);
});

test('generateId returns unique ids with prefix', () => {
  const id1 = generateId('track');
  const id2 = generateId('track');
  assert.ok(id1.startsWith('track_'));
  assert.notEqual(id1, id2);
});

test('Spotify URL parser recognizes global, intl-id, album, track, and URI formats', () => {
  const parseSpotifyLink = (link: string) => {
    if (!link) return null;
    const clean = link.trim();
    const webMatch = clean.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album|track)\/([a-zA-Z0-9]+)/i);
    if (webMatch && webMatch[2]) {
      return { type: webMatch[1].toLowerCase(), id: webMatch[2] };
    }
    const uriMatch = clean.match(/spotify:(playlist|album|track):([a-zA-Z0-9]+)/i);
    if (uriMatch && uriMatch[2]) {
      return { type: uriMatch[1].toLowerCase(), id: uriMatch[2] };
    }
    if (/^[a-zA-Z0-9]{22}$/.test(clean)) {
      return { type: 'playlist', id: clean };
    }
    return null;
  };

  // Indonesian localized link with query params
  const res1 = parseSpotifyLink('https://open.spotify.com/intl-id/playlist/37i9dQZF1DXcBWIGoYBM5M?si=e2f819');
  assert.deepEqual(res1, { type: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' });

  // Standard global playlist link
  const res2 = parseSpotifyLink('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
  assert.deepEqual(res2, { type: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' });

  // Album link
  const res3 = parseSpotifyLink('https://open.spotify.com/intl-id/album/4m2880jivSbbyEGAKfITCa');
  assert.deepEqual(res3, { type: 'album', id: '4m2880jivSbbyEGAKfITCa' });

  // Track link
  const res4 = parseSpotifyLink('https://open.spotify.com/track/3zOYmiNOuyDL0ClxJcEJ0T?si=abc');
  assert.deepEqual(res4, { type: 'track', id: '3zOYmiNOuyDL0ClxJcEJ0T' });

  // Spotify URI
  const res5 = parseSpotifyLink('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M');
  assert.deepEqual(res5, { type: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' });

  // Bare ID
  const res6 = parseSpotifyLink('37i9dQZF1DXcBWIGoYBM5M');
  assert.deepEqual(res6, { type: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' });
});
