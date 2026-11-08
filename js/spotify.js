/**
 * AylusMusic - Spotify Web API PKCE & Playlist Importer Module
 * 
 * PANDUAN INTEGRASI SPOTIFY DEVELOPER:
 * 1. Buka https://developer.spotify.com/dashboard dan buat aplikasi baru.
 * 2. Masukkan Redirect URI sama dengan URL aplikasi ini (misalnya https://domain-anda.com/ atau http://localhost:3000/).
 * 3. Salin Client ID ke konstanta SPOTIFY_CLIENT_ID di bawah ini atau simpan lewat Pengaturan Aplikasi.
 * 4. Mode PKCE murni di sisi browser (klien) tanpa Client Secret, aman untuk PWA.
 */

import { generateId, compressImageToWebP, sleep } from './utils.js';
import { dbManager } from './db.js';
import { Toast } from './toast.js';

// Konstanta Client ID Spotify (dapat dioverride via Pengaturan Aplikasi)
export const DEFAULT_SPOTIFY_CLIENT_ID = 'e9c3e9a7e02a4bf7a809b7c8df4f5a33';
export const SPOTIFY_SCOPES = 'playlist-read-private playlist-read-collaborative user-library-read';

export function getSpotifyClientId() {
  return localStorage.getItem('aylus_spotify_client_id') || DEFAULT_SPOTIFY_CLIENT_ID;
}

export function setSpotifyClientId(id) {
  if (id) {
    localStorage.setItem('aylus_spotify_client_id', id.trim());
  } else {
    localStorage.removeItem('aylus_spotify_client_id');
  }
}

export function getRedirectUri() {
  if (typeof window === 'undefined') return '';
  return window.location.origin + window.location.pathname;
}

// --- PKCE Helpers (RFC 7636) ---
function generateRandomString(length) {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

async function generateCodeChallenge(codeVerifier) {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export class SpotifyImporter {
  constructor() {
    this.accessToken = localStorage.getItem('aylus_spotify_access_token');
    this.tokenExpiry = parseInt(localStorage.getItem('aylus_spotify_token_expiry') || '0', 10);
    this.refreshToken = localStorage.getItem('aylus_spotify_refresh_token');
  }

  isAuthorized() {
    return !!this.accessToken && Date.now() < this.tokenExpiry;
  }

  /**
   * Start Spotify PKCE Authorization
   */
  async redirectToSpotifyAuth() {
    const clientId = getSpotifyClientId();
    const redirectUri = getRedirectUri();
    const verifier = generateRandomString(128);
    const challenge = await generateCodeChallenge(verifier);

    localStorage.setItem('aylus_spotify_code_verifier', verifier);

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SPOTIFY_SCOPES,
      code_challenge_method: 'S256',
      code_challenge: challenge
    });

    window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  /**
   * Handle OAuth redirect with authorization code
   */
  async handleCallback(code) {
    const verifier = localStorage.getItem('aylus_spotify_code_verifier');
    const clientId = getSpotifyClientId();
    const redirectUri = getRedirectUri();

    if (!verifier) {
      throw new Error('Code verifier Spotify tidak ditemukan.');
    }

    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier
    });

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error_description || 'Gagal menukarkan token Spotify');
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;
    this.refreshToken = data.refresh_token || this.refreshToken;

    localStorage.setItem('aylus_spotify_access_token', this.accessToken);
    localStorage.setItem('aylus_spotify_token_expiry', this.tokenExpiry.toString());
    if (this.refreshToken) {
      localStorage.setItem('aylus_spotify_refresh_token', this.refreshToken);
    }
    localStorage.removeItem('aylus_spotify_code_verifier');

    return this.accessToken;
  }

  /**
   * Fetch user playlists from Spotify
   */
  async fetchMyPlaylists() {
    if (!this.isAuthorized()) {
      throw new Error('Belum terhubung dengan akun Spotify');
    }

    const res = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
      headers: { Authorization: `Bearer ${this.accessToken}` }
    });

    if (!res.ok) {
      throw new Error('Gagal memuat playlist Spotify Anda');
    }

    const json = await res.json();
    return (json.items || []).map(p => ({
      id: p.id,
      name: p.name,
      description: p.description || '',
      trackCount: p.tracks?.total || 0,
      coverUrl: p.images?.[0]?.url || '/assets/logo.png',
      uri: p.uri
    }));
  }

  /**
   * Import selected playlist from Spotify with progress callback and cancel signal
   */
  async importPlaylist(spotifyPlaylist, options = {}) {
    const { onProgress = null, cancelSignal = null } = options;

    const playlistId = spotifyPlaylist.id;
    let tracks = [];
    let nextUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;

    // Create or find playlist in DB
    const existingPlaylists = await dbManager.getPlaylists();
    let localPlaylist = existingPlaylists.find(p => p.spotifyId === playlistId);

    if (!localPlaylist) {
      // Compress cover image to WebP
      const compressedCover = await compressImageToWebP(spotifyPlaylist.coverUrl, 256);
      localPlaylist = await dbManager.savePlaylist({
        name: spotifyPlaylist.name,
        description: spotifyPlaylist.description || `Impor dari Spotify (${spotifyPlaylist.trackCount} lagu)`,
        coverUrl: compressedCover,
        isSpotify: true,
        spotifyId: playlistId,
        trackCount: spotifyPlaylist.trackCount
      });
    }

    let loadedCount = 0;
    while (nextUrl) {
      if (cancelSignal && cancelSignal.isCancelled) {
        throw new Error('Impor dibatalkan oleh pengguna.');
      }

      let res = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${this.accessToken}` }
      });

      // Handle Rate Limiting (429)
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '2', 10);
        console.warn(`[Spotify] Rate limited. Retrying in ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        res = await fetch(nextUrl, {
          headers: { Authorization: `Bearer ${this.accessToken}` }
        });
      }

      if (!res.ok) {
        throw new Error('Gagal mengambil daftar lagu dari Spotify');
      }

      const page = await res.json();
      const items = page.items || [];

      for (const item of items) {
        if (!item.track) continue;
        const tr = item.track;
        const rawCover = tr.album?.images?.[0]?.url || spotifyPlaylist.coverUrl || '/assets/logo.png';
        const coverWebP = await compressImageToWebP(rawCover, 256);

        tracks.push({
          id: generateId(`sp_${tr.id || ''}`),
          playlistId: localPlaylist.id,
          title: tr.name,
          artist: (tr.artists || []).map(a => a.name).join(', ') || 'Artis Tak Dikenal',
          album: tr.album?.name || '',
          duration: Math.round((tr.duration_ms || 180000) / 1000),
          coverUrl: coverWebP,
          isrc: tr.external_ids?.isrc || null,
          hasAudio: false,
          audioUrl: '',
          audioType: 'metadata',
          spotifyUri: tr.uri
        });

        loadedCount++;
        if (typeof onProgress === 'function') {
          onProgress(loadedCount, spotifyPlaylist.trackCount || loadedCount);
        }
      }

      nextUrl = page.next;
    }

    // Save batch to IndexedDB
    await dbManager.saveTracksBatch(tracks);

    // Update playlist count
    localPlaylist.trackCount = tracks.length;
    await dbManager.savePlaylist(localPlaylist);

    return { playlist: localPlaylist, tracks };
  }

  /**
   * Parse Public Spotify Playlist Link / ID
   * Examples:
   * https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=...
   * spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
   */
  parsePlaylistLink(link) {
    if (!link) return null;
    const clean = link.trim();
    // HTTP URL regex
    const httpMatch = clean.match(/open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
    if (httpMatch && httpMatch[1]) return httpMatch[1];

    // URI format
    const uriMatch = clean.match(/spotify:playlist:([a-zA-Z0-9]+)/);
    if (uriMatch && uriMatch[1]) return uriMatch[1];

    // Bare ID (22 alphanumeric chars)
    if (/^[a-zA-Z0-9]{22}$/.test(clean)) return clean;

    return null;
  }

  /**
   * Fetch public playlist info using Spotify oEmbed or API
   */
  async fetchPublicPlaylistInfo(playlistId) {
    const spotifyUrl = `https://open.spotify.com/playlist/${playlistId}`;
    try {
      const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`);
      if (res.ok) {
        const data = await res.json();
        return {
          id: playlistId,
          name: data.title || 'Spotify Playlist',
          coverUrl: data.thumbnail_url || '/assets/logo.png',
          description: 'Playlist Publik Spotify',
          trackCount: 30 // estimate
        };
      }
    } catch (e) {
      console.warn('oEmbed fetch failed:', e);
    }

    return {
      id: playlistId,
      name: `Spotify Playlist (${playlistId.substring(0, 8)})`,
      coverUrl: '/assets/logo.png',
      description: 'Playlist Spotify',
      trackCount: 20
    };
  }

  /**
   * Parse CSV file in standard Exportify format
   * Header columns: Spotify ID, Track Name, Artist Name(s), Album Name, Track Duration (ms), ISRC, Album Image URL
   */
  async parseExportifyCsv(csvText, playlistName = 'Playlist Hasil Impor CSV') {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) {
      throw new Error('File CSV kosong atau tidak memiliki baris data');
    }

    // Helper parse CSV line taking quotes into account
    const parseLine = (line) => {
      const result = [];
      let cur = '';
      let insideQuote = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          insideQuote = !insideQuote;
        } else if (c === ',' && !insideQuote) {
          result.push(cur.trim().replace(/^"|"$/g, ''));
          cur = '';
        } else {
          cur += c;
        }
      }
      result.push(cur.trim().replace(/^"|"$/g, ''));
      return result;
    };

    const headers = parseLine(lines[0]).map(h => h.toLowerCase());

    const titleIdx = headers.findIndex(h => h.includes('track name') || h === 'title' || h === 'name');
    const artistIdx = headers.findIndex(h => h.includes('artist'));
    const albumIdx = headers.findIndex(h => h.includes('album name') || h === 'album');
    const durationIdx = headers.findIndex(h => h.includes('duration'));
    const isrcIdx = headers.findIndex(h => h === 'isrc');
    const imageIdx = headers.findIndex(h => h.includes('image') || h.includes('cover'));

    if (titleIdx === -1) {
      throw new Error('Kolom judul lagu ("Track Name") tidak ditemukan dalam CSV');
    }

    const playlist = await dbManager.savePlaylist({
      name: playlistName,
      description: `Diimpor dari file CSV Exportify (${lines.length - 1} lagu)`,
      coverUrl: '/assets/logo.png',
      isSpotify: true,
      trackCount: lines.length - 1
    });

    const tracks = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseLine(lines[i]);
      if (!cols[titleIdx]) continue;

      const durationMs = durationIdx !== -1 ? parseInt(cols[durationIdx], 10) : 180000;
      const durationSecs = !isNaN(durationMs) ? Math.round(durationMs / 1000) : 180;

      tracks.push({
        id: generateId('csv_tr'),
        playlistId: playlist.id,
        title: cols[titleIdx],
        artist: artistIdx !== -1 ? cols[artistIdx] || 'Artis Tak Dikenal' : 'Artis Tak Dikenal',
        album: albumIdx !== -1 ? cols[albumIdx] || '' : '',
        duration: durationSecs,
        coverUrl: (imageIdx !== -1 && cols[imageIdx]) ? cols[imageIdx] : '/assets/logo.png',
        isrc: isrcIdx !== -1 ? cols[isrcIdx] || null : null,
        hasAudio: false,
        audioUrl: '',
        audioType: 'metadata'
      });
    }

    await dbManager.saveTracksBatch(tracks);
    playlist.trackCount = tracks.length;
    await dbManager.savePlaylist(playlist);

    return { playlist, tracks };
  }
}

export const spotifyImporter = new SpotifyImporter();
