/**
 * AylusMusic - Playback Controller & Media Session API
 */

import { audioEngine } from './audio-engine.js';
import { dbManager } from './db.js';
import { Toast } from './toast.js';
import { youtubeService } from './youtube.js';

class PlayerController {
  constructor() {
    this.currentTrack = null;
    this.queue = [];
    this.queueIndex = -1;
    this.originalQueue = []; // for un-shuffling
    this.isPlaying = false;
    this.repeatMode = 'off'; // 'off' | 'all' | 'one'
    this.isShuffled = false;
    this.playbackRate = 1.0;
    this.sleepTimerMinutes = null;
    this.sleepTimerTimeout = null;
    this.sleepTimerEndTime = null;

    // Wake lock
    this.wakeLockSentinel = null;
    this.wakeLockEnabled = true;

    this.listeners = [];
    this._setupAudioEvents();
    this._setupYouTubeEvents();
    this._setupMediaSession();
    this._setupKeyboardShortcuts();
  }

  _setupYouTubeEvents() {
    youtubeService.on((event, data) => {
      if (this.currentTrack && this.currentTrack.audioType === 'youtube') {
        if (event === 'stateChange') {
          if (data.stateName === 'playing') {
            this.isPlaying = true;
            this._updateMediaSessionPlaybackState('playing');
            this._requestWakeLock();
            this._notify();
          } else if (data.stateName === 'paused') {
            this.isPlaying = false;
            this._updateMediaSessionPlaybackState('paused');
            this._releaseWakeLock();
            this._notify();
          } else if (data.stateName === 'ended') {
            if (this.repeatMode === 'one') {
              youtubeService.seekTo(0);
              youtubeService.resumeVideo();
            } else {
              this.next(false);
            }
          }
        } else if (event === 'timeupdate') {
          this._updateMediaSessionPosition();
          this._notify('timeupdate');
        } else if (event === 'error') {
          if (data === 150 || data === 101) {
            Toast.warning('Video ini dibatasi embed oleh YouTube. Beralih ke track berikutnya...', 'YouTube Music');
          } else {
            Toast.warning('Kendala memutar video YouTube ini. Melanjutkan ke lagu berikutnya...', 'Pemutar YouTube');
          }
          this.next(false);
        }
      }
    });
  }

  _setupAudioEvents() {
    const audio = audioEngine.audioElement;
    if (!audio) return;

    audio.addEventListener('play', () => {
      this.isPlaying = true;
      this._updateMediaSessionPlaybackState('playing');
      this._requestWakeLock();
      this._notify();
    });

    audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this._updateMediaSessionPlaybackState('paused');
      this._releaseWakeLock();
      this._notify();
    });

    audio.addEventListener('timeupdate', () => {
      this._updateMediaSessionPosition();
      this._notify('timeupdate');
    });

    audio.addEventListener('ended', () => {
      if (this.repeatMode === 'one') {
        audio.currentTime = 0;
        audio.play().catch(e => console.warn(e));
      } else {
        this.next(false); // auto advance
      }
    });

    audio.addEventListener('error', (e) => {
      console.warn('[Audio Player] Playback error:', e);
      if (this.currentTrack && !this.currentTrack.hasAudio) {
        Toast.info(`Lagu "${this.currentTrack.title}" berstatus "Hanya Metadata". Silakan tautkan sumber audio lokal atau legal.`, 'Perlu Sumber Audio');
      } else {
        Toast.error('Gagal memutar audio sumber ini. Memeriksa file berikutnya...', 'Audio Bermasalah');
      }
      this.isPlaying = false;
      this._notify();
    });
  }

  _setupMediaSession() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    const actionHandlers = [
      ['play', () => this.resume()],
      ['pause', () => this.pause()],
      ['previoustrack', () => this.prev()],
      ['nexttrack', () => this.next()],
      ['seekto', (details) => {
        if (details.seekTime !== undefined) {
          this.seek(details.seekTime);
        }
      }],
      ['seekbackward', (details) => {
        const offset = details.seekOffset || 10;
        this.seek(Math.max(0, audioEngine.audioElement.currentTime - offset));
      }],
      ['seekforward', (details) => {
        const offset = details.seekOffset || 10;
        this.seek(Math.min(audioEngine.audioElement.duration || 0, audioEngine.audioElement.currentTime + offset));
      }]
    ];

    for (const [action, handler] of actionHandlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (error) {
        console.warn(`Media session action ${action} not supported:`, error);
      }
    }
  }

  _updateMediaSessionMetadata(track) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !track) return;

    const coverUrl = track.coverUrl || '/assets/logo.png';
    const artwork = [
      { src: coverUrl, sizes: '96x96', type: 'image/png' },
      { src: coverUrl, sizes: '128x128', type: 'image/png' },
      { src: coverUrl, sizes: '192x192', type: 'image/png' },
      { src: coverUrl, sizes: '256x256', type: 'image/png' },
      { src: coverUrl, sizes: '512x512', type: 'image/png' }
    ];

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || 'AylusMusic Track',
        artist: track.artist || 'AylusMusic',
        album: track.album || 'AylusMusic Collection',
        artwork
      });
    } catch (e) {
      console.warn('[MediaSession] metadata set error:', e);
    }
  }

  _updateMediaSessionPlaybackState(state) {
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = state;
      } catch (e) {}
    }
  }

  _updateMediaSessionPosition() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const isYT = this.currentTrack && this.currentTrack.audioType === 'youtube';
    const audio = audioEngine.audioElement;
    const duration = isYT ? (youtubeService.getDuration() || this.currentTrack?.duration || 0) : (audio?.duration || this.currentTrack?.duration || 0);
    const position = isYT ? youtubeService.getCurrentTime() : (audio?.currentTime || 0);

    if (!duration || isNaN(duration) || duration <= 0) return;

    try {
      navigator.mediaSession.setPositionState({
        duration: duration,
        playbackRate: this.playbackRate,
        position: Math.min(position, duration)
      });
    } catch (e) {}
  }

  // --- Screen Wake Lock ---
  async _requestWakeLock() {
    if (!this.wakeLockEnabled || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    try {
      if (!this.wakeLockSentinel) {
        this.wakeLockSentinel = await navigator.wakeLock.request('screen');
        this.wakeLockSentinel.addEventListener('release', () => {
          this.wakeLockSentinel = null;
        });
      }
    } catch (err) {
      // Non-critical, wake lock can be rejected on battery saver
    }
  }

  async _releaseWakeLock() {
    if (this.wakeLockSentinel) {
      try {
        await this.wakeLockSentinel.release();
        this.wakeLockSentinel = null;
      } catch (e) {}
    }
  }

  // --- Keyboard Shortcuts ---
  _setupKeyboardShortcuts() {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (e) => {
      // Do not trigger shortcuts if typing inside input / textarea
      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          this.togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          this.seek((audioEngine.audioElement?.currentTime || 0) - 5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          this.seek((audioEngine.audioElement?.currentTime || 0) + 5);
          break;
        case 'ArrowUp':
          e.preventDefault();
          audioEngine.setVolume(audioEngine.volume + 0.05);
          this._notify('volume');
          break;
        case 'ArrowDown':
          e.preventDefault();
          audioEngine.setVolume(audioEngine.volume - 0.05);
          this._notify('volume');
          break;
        case 'KeyM':
          e.preventDefault();
          this.toggleMute();
          break;
        case 'KeyS':
          e.preventDefault();
          this.toggleShuffle();
          break;
        case 'KeyR':
          e.preventDefault();
          this.cycleRepeat();
          break;
      }
    });
  }

  // --- Core Playback Methods ---
  async playTrack(track, queueList = null) {
    if (!track) return;
    await audioEngine.ensureAudioContext();

    this.currentTrack = track;

    if (queueList && Array.isArray(queueList) && queueList.length > 0) {
      this.originalQueue = [...queueList];
      this.queue = this.isShuffled ? this._shuffleArray([...queueList]) : [...queueList];
      this.queueIndex = this.queue.findIndex(t => t.id === track.id);
      if (this.queueIndex === -1) {
        this.queue.unshift(track);
        this.queueIndex = 0;
      }
    } else if (this.queue.length === 0) {
      this.queue = [track];
      this.originalQueue = [track];
      this.queueIndex = 0;
    } else {
      this.queueIndex = this.queue.findIndex(t => t.id === track.id);
      if (this.queueIndex === -1) {
        this.queue.push(track);
        this.queueIndex = this.queue.length - 1;
      }
    }

    const audio = audioEngine.audioElement;

    // Cek apakah track YouTube atau perlu auto-resolve ke versi penuh YouTube Music
    const isExplicitYouTube = track.audioType === 'youtube' || !!track.youtubeId;
    const isShortPreview = !isExplicitYouTube && (
      !track.audioUrl ||
      track.audioUrl.includes('p.scdn.co') ||
      (track.duration && track.duration <= 35 && !track.isLocal)
    );

    if (isExplicitYouTube) {
      // Matikan audio HTML5 biasa jika sedang berbunyi
      if (audio) {
        audio.pause();
        audio.src = '';
      }
      track.audioType = 'youtube';
      try {
        await youtubeService.playVideo(track.youtubeId);
        this.isPlaying = true;
      } catch (err) {
        console.warn('[Player] YouTube play error:', err);
        Toast.warning('Sedang menghubungkan ke YouTube Music...', 'Pemutar Musik');
      }
    } else if (isShortPreview) {
      // Auto-resolve Spotify preview (19-30s) atau metadata-only ke YouTube Music versi lengkap
      Toast.info(`Mencari versi lagu penuh untuk "${track.title}"...`, 'YouTube Music');
      const resolved = await youtubeService.resolveFullAudio(track);
      if (resolved && track.youtubeId) {
        if (audio) {
          audio.pause();
          audio.src = '';
        }
        track.audioType = 'youtube';
        try {
          await youtubeService.playVideo(track.youtubeId);
          this.isPlaying = true;
          Toast.success(`Memutar versi penuh: ${track.title}`, 'YouTube Music');
        } catch (err) {
          console.warn('[Player] YouTube playback failed after resolve:', err);
        }
      } else if (track.audioUrl) {
        // Fallback ke audioUrl asli jika offline / resolve gagal
        youtubeService.pauseVideo();
        audio.src = track.audioUrl;
        audio.playbackRate = this.playbackRate;
        try {
          await audio.play();
          this.isPlaying = true;
        } catch (err) {
          console.warn('[Player] Audio play interrupted:', err.message);
        }
      } else {
        audio.src = '';
        this.isPlaying = false;
        Toast.info(`"${track.title}" ditambahkan ke antrean. Tautkan video YouTube atau file audio untuk memutar.`, 'Info Audio');
      }
    } else if (track.audioUrl) {
      // Audio lokal / direct file / cache
      youtubeService.pauseVideo();
      audio.src = track.audioUrl;
      audio.playbackRate = this.playbackRate;
      try {
        await audio.play();
        this.isPlaying = true;
      } catch (err) {
        console.warn('[Player] Audio play interrupted:', err.message);
      }
    } else {
      // Track has no audio stream
      youtubeService.pauseVideo();
      audio.src = '';
      this.isPlaying = false;
      Toast.info(`"${track.title}" ditambahkan ke antrean (Hanya metadata). Tautkan sumber audio untuk memutar.`, 'Info Audio');
    }

    this._updateMediaSessionMetadata(track);
    this._notify();

    // Record into history
    dbManager.addHistory(track).catch(e => console.warn('History save error:', e));
  }

  async togglePlay() {
    if (!this.currentTrack) {
      if (this.queue.length > 0) {
        return this.playTrack(this.queue[0]);
      }
      return;
    }
    if (this.isPlaying) {
      this.pause();
    } else {
      await this.resume();
    }
  }

  async resume() {
    await audioEngine.ensureAudioContext();
    if (this.currentTrack && this.currentTrack.audioType === 'youtube') {
      youtubeService.resumeVideo();
      this.isPlaying = true;
      this._notify();
      return;
    }
    const audio = audioEngine.audioElement;
    if (audio && audio.src) {
      try {
        await audio.play();
        this.isPlaying = true;
      } catch (err) {
        console.warn('Resume error:', err);
      }
    }
    this._notify();
  }

  pause() {
    if (this.currentTrack && this.currentTrack.audioType === 'youtube') {
      youtubeService.pauseVideo();
      this.isPlaying = false;
      this._notify();
      return;
    }
    const audio = audioEngine.audioElement;
    if (audio) {
      audio.pause();
      this.isPlaying = false;
    }
    this._notify();
  }

  next(manual = true) {
    if (!this.queue.length) return;
    let nextIndex = this.queueIndex + 1;
    if (nextIndex >= this.queue.length) {
      if (this.repeatMode === 'all' || manual) {
        nextIndex = 0;
      } else {
        // end of queue, stop
        this.pause();
        return;
      }
    }
    this.queueIndex = nextIndex;
    const nextTrack = this.queue[this.queueIndex];
    if (nextTrack) {
      this.playTrack(nextTrack);
    }
  }

  prev() {
    const isYT = this.currentTrack && this.currentTrack.audioType === 'youtube';
    const currentTime = isYT ? youtubeService.getCurrentTime() : (audioEngine.audioElement?.currentTime || 0);

    // If played more than 3 seconds, restart current track
    if (currentTime > 3) {
      this.seek(0);
      return;
    }

    if (!this.queue.length) return;
    let prevIndex = this.queueIndex - 1;
    if (prevIndex < 0) {
      prevIndex = this.queue.length - 1;
    }
    this.queueIndex = prevIndex;
    const prevTrack = this.queue[this.queueIndex];
    if (prevTrack) {
      this.playTrack(prevTrack);
    }
  }

  seek(seconds) {
    const isYT = this.currentTrack && this.currentTrack.audioType === 'youtube';
    if (isYT) {
      youtubeService.seekTo(seconds);
      this._updateMediaSessionPosition();
      this._notify('timeupdate');
      return;
    }
    const audio = audioEngine.audioElement;
    if (audio && audio.duration && !isNaN(audio.duration)) {
      audio.currentTime = Math.max(0, Math.min(audio.duration, seconds));
      this._updateMediaSessionPosition();
      this._notify('timeupdate');
    }
  }

  toggleShuffle() {
    this.isShuffled = !this.isShuffled;
    if (this.isShuffled) {
      const current = this.currentTrack;
      const remaining = this.originalQueue.filter(t => t.id !== current?.id);
      this.queue = current ? [current, ...this._shuffleArray(remaining)] : this._shuffleArray([...this.originalQueue]);
      this.queueIndex = 0;
      Toast.info('Putar acak (Shuffle) aktif');
    } else {
      this.queue = [...this.originalQueue];
      this.queueIndex = this.queue.findIndex(t => t.id === this.currentTrack?.id);
      Toast.info('Putar berurutan aktif');
    }
    this._notify();
  }

  cycleRepeat() {
    if (this.repeatMode === 'off') {
      this.repeatMode = 'all';
      Toast.info('Ulangi semua lagu (Repeat All)');
    } else if (this.repeatMode === 'all') {
      this.repeatMode = 'one';
      Toast.info('Ulangi lagu saat ini (Repeat One)');
    } else {
      this.repeatMode = 'off';
      Toast.info('Pengulangan nonaktif');
    }
    this._notify();
  }

  toggleMute() {
    const audio = audioEngine.audioElement;
    if (!audio) return;
    audio.muted = !audio.muted;
    if (audioEngine.masterGain && audioEngine.audioContext) {
      audioEngine.masterGain.gain.setValueAtTime(audio.muted ? 0 : audioEngine.volume, audioEngine.audioContext.currentTime);
    }
    this._notify('volume');
  }

  setSpeed(rate) {
    this.playbackRate = parseFloat(rate) || 1.0;
    const audio = audioEngine.audioElement;
    if (audio) {
      audio.playbackRate = this.playbackRate;
    }
    this._notify();
  }

  // --- Sleep Timer ---
  setSleepTimer(minutes) {
    if (this.sleepTimerTimeout) {
      clearTimeout(this.sleepTimerTimeout);
      this.sleepTimerTimeout = null;
      this.sleepTimerEndTime = null;
      this.sleepTimerMinutes = null;
    }

    if (!minutes || minutes <= 0) {
      Toast.info('Sleep Timer dibatalkan');
      this._notify('sleeptimer');
      return;
    }

    this.sleepTimerMinutes = minutes;
    this.sleepTimerEndTime = Date.now() + minutes * 60 * 1000;

    this.sleepTimerTimeout = setTimeout(() => {
      this.pause();
      Toast.info('Sleep Timer telah berakhir. Pemutaran dihentikan.', 'Waktunya Istirahat');
      this.sleepTimerMinutes = null;
      this.sleepTimerTimeout = null;
      this.sleepTimerEndTime = null;
      this._notify('sleeptimer');
    }, minutes * 60 * 1000);

    Toast.success(`Sleep Timer diatur: ${minutes} menit`, 'Sleep Timer Aktif');
    this._notify('sleeptimer');
  }

  _shuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  onStateChange(callback) {
    this.listeners.push(callback);
    callback(this.getState());
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  _notify(type = 'state') {
    const state = this.getState();
    this.listeners.forEach(cb => cb(state, type));
  }

  getState() {
    const isYT = this.currentTrack && this.currentTrack.audioType === 'youtube';
    const audio = audioEngine.audioElement;
    const currentTime = isYT ? youtubeService.getCurrentTime() : (audio?.currentTime || 0);
    const duration = isYT ? (youtubeService.getDuration() || this.currentTrack?.duration || 0) : (audio?.duration || this.currentTrack?.duration || 0);

    return {
      currentTrack: this.currentTrack,
      isPlaying: this.isPlaying,
      queue: this.queue,
      queueIndex: this.queueIndex,
      currentTime: currentTime,
      duration: duration,
      repeatMode: this.repeatMode,
      isShuffled: this.isShuffled,
      volume: audioEngine.volume,
      playbackRate: this.playbackRate,
      sleepTimerMinutes: this.sleepTimerMinutes,
      sleepTimerEndTime: this.sleepTimerEndTime
    };
  }
}

export const player = new PlayerController();
