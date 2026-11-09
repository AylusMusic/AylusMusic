/**
 * AylusMusic - YouTube Music & Video Integration Module
 * Full-length audio playback via YouTube IFrame API, playlist importer, and real-time music search.
 */

import { generateId, compressImageToWebP } from './utils.js';
import { dbManager } from './db.js';
import { Toast } from './toast.js';

class YouTubeService {
  constructor() {
    this.player = null;
    this.isReady = false;
    this.currentVideoId = null;
    this.playbackState = 'unstarted'; // 'playing', 'paused', 'buffering', 'ended'
    this.stateListeners = [];
    this.timeUpdateTimer = null;

    this._initIframeApi();
  }

  _initIframeApi() {
    if (typeof window === 'undefined') return;

    // Callback when YouTube API is loaded
    const existingCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (existingCallback) existingCallback();
      this._createPlayer();
    };

    // If script not in document, inject it
    if (!document.getElementById('yt-iframe-script')) {
      const tag = document.createElement('script');
      tag.id = 'yt-iframe-script';
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      if (firstScriptTag && firstScriptTag.parentNode) {
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      } else {
        document.head.appendChild(tag);
      }
    } else if (window.YT && window.YT.Player) {
      this._createPlayer();
    }
  }

  _createPlayer() {
    let host = document.getElementById('yt-player-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'yt-player-host';
      host.style.cssText = 'position:fixed;width:1px;height:1px;bottom:0;right:0;opacity:0.01;pointer-events:none;z-index:-1;';
      document.body.appendChild(host);
    }

    try {
      this.player = new window.YT.Player('yt-player-host', {
        height: '1',
        width: '1',
        host: 'https://www.youtube-nocookie.com',
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          enablejsapi: 1,
          origin: window.location.origin
        },
        events: {
          onReady: () => {
            this.isReady = true;
            console.log('[YouTubeService] IFrame Player is Ready');
          },
          onStateChange: (event) => {
            this._handleStateChange(event.data);
          },
          onError: (event) => {
            console.warn('[YouTubeService] Error:', event.data);
            this._notify('error', event.data);
          }
        }
      });
    } catch (err) {
      console.warn('[YouTubeService] Failed to create player:', err);
    }
  }

  _handleStateChange(state) {
    // YT.PlayerState: -1 (UNSTARTED), 0 (ENDED), 1 (PLAYING), 2 (PAUSED), 3 (BUFFERING), 5 (CUED)
    if (state === 1) {
      this.playbackState = 'playing';
      this._startTimeUpdateTimer();
    } else if (state === 2) {
      this.playbackState = 'paused';
      this._stopTimeUpdateTimer();
    } else if (state === 0) {
      this.playbackState = 'ended';
      this._stopTimeUpdateTimer();
    }
    this._notify('stateChange', { state, stateName: this.playbackState });
  }

  _startTimeUpdateTimer() {
    this._stopTimeUpdateTimer();
    this.timeUpdateTimer = setInterval(() => {
      if (this.isReady && this.player && typeof this.player.getCurrentTime === 'function') {
        const currentTime = this.player.getCurrentTime() || 0;
        const duration = this.player.getDuration() || 0;
        this._notify('timeupdate', { currentTime, duration });
      }
    }, 250);
  }

  _stopTimeUpdateTimer() {
    if (this.timeUpdateTimer) {
      clearInterval(this.timeUpdateTimer);
      this.timeUpdateTimer = null;
    }
  }

  on(listener) {
    if (typeof listener === 'function') {
      this.stateListeners.push(listener);
    }
  }

  _notify(event, data = {}) {
    this.stateListeners.forEach(fn => {
      try { fn(event, data); } catch (e) { console.error(e); }
    });
  }

  // --- YouTube Playback Controls ---
  async playVideo(videoId) {
    this.currentVideoId = videoId;
    if (!this.isReady || !this.player) {
      // Retry in 300ms if iframe is still initializing
      await new Promise(r => setTimeout(r, 350));
    }
    if (this.player && typeof this.player.loadVideoById === 'function') {
      try {
        this.player.loadVideoById(videoId);
        this.player.playVideo();
      } catch (err) {
        console.warn('[YouTubeService] loadVideoById error:', err);
      }
    }
  }

  pauseVideo() {
    if (this.player && typeof this.player.pauseVideo === 'function') {
      this.player.pauseVideo();
    }
  }

  resumeVideo() {
    if (this.player && typeof this.player.playVideo === 'function') {
      this.player.playVideo();
    }
  }

  seekTo(seconds) {
    if (this.player && typeof this.player.seekTo === 'function') {
      this.player.seekTo(seconds, true);
    }
  }

  setVolume(volPercent) {
    // volPercent: 0 to 100
    if (this.player && typeof this.player.setVolume === 'function') {
      this.player.setVolume(Math.max(0, Math.min(100, Math.round(volPercent))));
    }
  }

  getCurrentTime() {
    if (this.player && typeof this.player.getCurrentTime === 'function') {
      return this.player.getCurrentTime() || 0;
    }
    return 0;
  }

  getDuration() {
    if (this.player && typeof this.player.getDuration === 'function') {
      return this.player.getDuration() || 0;
    }
    return 0;
  }

  // --- Link Parser ---
  parseYouTubeLink(link) {
    if (!link) return null;
    const clean = link.trim();

    // 1. Playlist URL (music.youtube.com or youtube.com)
    const plMatch = clean.match(/[?&]list=([a-zA-Z0-9_-]+)/i);
    if (plMatch && plMatch[1]) {
      return { type: 'playlist', id: plMatch[1] };
    }

    // 2. Short URL: youtu.be/[id]
    const shortMatch = clean.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/i);
    if (shortMatch && shortMatch[1]) {
      return { type: 'video', id: shortMatch[1] };
    }

    // 3. Watch URL: youtube.com/watch?v=[id] or music.youtube.com/watch?v=[id]
    const watchMatch = clean.match(/[?&]v=([a-zA-Z0-9_-]{11})/i);
    if (watchMatch && watchMatch[1]) {
      return { type: 'video', id: watchMatch[1] };
    }

    // 4. Bare Playlist ID
    if (/^PL[a-zA-Z0-9_-]+$/i.test(clean)) {
      return { type: 'playlist', id: clean };
    }

    // 5. Bare Video ID (11 chars)
    if (/^[a-zA-Z0-9_-]{11}$/.test(clean)) {
      return { type: 'video', id: clean };
    }

    return null;
  }

  // --- Search YouTube Music ---
  async search(query) {
    if (!query || !query.trim()) return [];
    try {
      const res = await fetch(`/api/youtube?q=${encodeURIComponent(query.trim())}`);
      if (res.ok) {
        const json = await res.json();
        return json.tracks || [];
      }
    } catch (err) {
      console.warn('[YouTubeService] Search error:', err);
    }
    return [];
  }

  async searchYouTube(query) {
    return this.search(query);
  }

  // --- Resolve full song for any track (Spotify preview replacement) ---
  async resolveFullAudio(track) {
    if (track.youtubeId) return track.youtubeId;

    const searchTerm = `${track.artist} - ${track.title}`;
    const results = await this.search(searchTerm);
    if (results && results.length > 0) {
      const best = results[0];
      track.youtubeId = best.youtubeId;
      track.hasAudio = true;
      track.audioType = 'youtube';
      track.audioUrl = `https://www.youtube.com/watch?v=${best.youtubeId}`;
      if (best.duration && (!track.duration || track.duration < 60)) {
        track.duration = best.duration;
      }
      // Save resolution to DB so next play is immediate
      dbManager.saveTrack(track).catch(e => console.warn('Cache track error:', e));
      return best.youtubeId;
    }
    return null;
  }

  // --- Import Playlist from YouTube ---
  async importPlaylist(linkOrId, options = {}) {
    const { onProgress = null } = options;
    const parsed = this.parseYouTubeLink(linkOrId);

    if (!parsed) {
      throw new Error('Link YouTube tidak valid. Format yang didukung: https://music.youtube.com/playlist?list=... atau https://www.youtube.com/playlist?list=...');
    }

    if (parsed.type === 'video') {
      // Single track import
      const videoRes = await fetch(`/api/youtube?videoId=${parsed.id}`);
      const vData = await videoRes.json();
      
      const playlist = await dbManager.savePlaylist({
        name: vData.title || 'YouTube Music Single',
        description: 'Lagu tunggal diimpor dari YouTube Music (Durasi Penuh)',
        coverUrl: vData.coverUrl,
        isSpotify: false,
        trackCount: 1
      });

      const track = {
        id: generateId(`yt_${parsed.id}_`),
        playlistId: playlist.id,
        youtubeId: parsed.id,
        title: vData.title || 'Lagu YouTube',
        artist: vData.artist || 'Artis YouTube',
        album: playlist.name,
        duration: vData.duration || 210,
        coverUrl: vData.coverUrl,
        hasAudio: true,
        audioUrl: `https://www.youtube.com/watch?v=${parsed.id}`,
        audioType: 'youtube'
      };

      await dbManager.saveTrack(track);
      return { playlist, tracks: [track] };
    }

    // Playlist Import
    const playlistId = parsed.id;
    const res = await fetch(`/api/youtube?list=${playlistId}`);
    if (!res.ok) {
      throw new Error(`Gagal mengambil playlist dari YouTube (Status: ${res.status}). Pastikan playlist berstatus Publik.`);
    }

    const data = await res.json();
    const rawTracks = data.tracks || [];

    if (rawTracks.length === 0) {
      throw new Error('Playlist YouTube ini kosong atau tidak memiliki video yang bisa diakses.');
    }

    const coverWebP = await compressImageToWebP(data.coverUrl || rawTracks[0]?.coverUrl || '/assets/logo.png', 256);

    const playlist = await dbManager.savePlaylist({
      name: data.name || 'YouTube Music Playlist',
      description: `Diimpor dari YouTube Music (${rawTracks.length} lagu - Durasi Penuh)`,
      coverUrl: coverWebP,
      isSpotify: false,
      trackCount: rawTracks.length
    });

    const tracks = [];
    for (let i = 0; i < rawTracks.length; i++) {
      const t = rawTracks[i];
      tracks.push({
        id: generateId(`yt_${t.youtubeId}_`),
        playlistId: playlist.id,
        youtubeId: t.youtubeId,
        title: t.title,
        artist: t.artist,
        album: playlist.name,
        duration: t.duration || 210,
        coverUrl: t.coverUrl || coverWebP,
        hasAudio: true,
        audioUrl: t.audioUrl || `https://www.youtube.com/watch?v=${t.youtubeId}`,
        audioType: 'youtube'
      });

      if (typeof onProgress === 'function') {
        onProgress(i + 1, rawTracks.length);
      }
    }

    await dbManager.saveTracksBatch(tracks);
    playlist.trackCount = tracks.length;
    await dbManager.savePlaylist(playlist);

    return { playlist, tracks };
  }
}

export const youtubeService = new YouTubeService();
