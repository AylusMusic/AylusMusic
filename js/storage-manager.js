/**
 * AylusMusic - Storage & Offline Cache Manager
 * Storage estimation, Cache Storage for audio, and LRU auto-cleanup.
 */

import { formatBytes } from './utils.js';
import { dbManager } from './db.js';
import { Toast } from './toast.js';

const AUDIO_CACHE_NAME = 'aylus-audio-cache';
const COVERS_CACHE_NAME = 'aylus-covers-cache';

class StorageManager {
  constructor() {
    this.quotaLimitMb = parseInt(localStorage.getItem('aylus_quota_limit_mb') || '1024', 10); // default 1GB
  }

  setQuotaLimitMb(limitMb) {
    this.quotaLimitMb = parseInt(limitMb, 10) || 1024;
    localStorage.setItem('aylus_quota_limit_mb', this.quotaLimitMb.toString());
  }

  getQuotaLimitMb() {
    return this.quotaLimitMb;
  }

  /**
   * Get detailed storage usage and breakdown
   */
  async getStorageUsage() {
    let usage = 0;
    let quota = 0;

    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        usage = est.usage || 0;
        quota = est.quota || 0;
      } catch (e) {
        console.warn('Storage estimate failed:', e);
      }
    }

    // Estimate audio cache size
    let audioCacheBytes = 0;
    let audioCacheCount = 0;
    if (typeof caches !== 'undefined') {
      try {
        const cache = await caches.open(AUDIO_CACHE_NAME);
        const keys = await cache.keys();
        audioCacheCount = keys.length;
        // Approximation: ~3.5MB per cached audio track
        audioCacheBytes = audioCacheCount * 3.5 * 1024 * 1024;
      } catch (e) {}
    }

    // Tracks count & offline count from IndexedDB
    const allTracks = await dbManager.getAllTracks();
    const offlineTracks = allTracks.filter(t => t.offline);

    const percent = quota > 0 ? ((usage / quota) * 100).toFixed(1) : 0;
    const limitBytes = this.quotaLimitMb * 1024 * 1024;
    const quotaUsedPercent = limitBytes > 0 ? Math.min(100, ((usage / limitBytes) * 100)).toFixed(1) : 0;

    return {
      usage,
      quota,
      usageFormatted: formatBytes(usage),
      quotaFormatted: formatBytes(quota),
      percent,
      quotaUsedPercent,
      limitFormatted: `${this.quotaLimitMb} MB`,
      audioCacheCount,
      audioCacheBytesFormatted: formatBytes(audioCacheBytes),
      totalTracks: allTracks.length,
      offlineTracksCount: offlineTracks.length
    };
  }

  /**
   * Download audio track for offline playback
   */
  async downloadTrackForOffline(track, isGuest = false) {
    if (!track.audioUrl) {
      Toast.error(`Lagu "${track.title}" belum memiliki sumber audio untuk diunduh.`, 'Audio Belum Tersedia');
      return false;
    }

    // Guest quota check: max 20 offline tracks
    if (isGuest) {
      const all = await dbManager.getAllTracks();
      const currentOffline = all.filter(t => t.offline).length;
      if (currentOffline >= 20) {
        Toast.warning('Mode Tamu dibatasi maksimal 20 lagu offline. Masuk dengan Google untuk unduhan tanpa batas.', 'Batas Kuota Tamu');
        return false;
      }
    }

    try {
      Toast.info(`Mengunduh "${track.title}" untuk offline...`, 'Memulai Unduhan');

      const response = await fetch(track.audioUrl, { mode: 'cors' });
      if (!response.ok) throw new Error('Gagal mengunduh file audio dari server');

      const blob = await response.blob();
      const cache = await caches.open(AUDIO_CACHE_NAME);
      const cacheKey = new Request(track.audioUrl);
      await cache.put(cacheKey, new Response(blob));

      // Mark track as offline in IndexedDB
      track.offline = true;
      track.cachedAt = Date.now();
      await dbManager.saveTrack(track);

      Toast.success(`"${track.title}" siap diputar secara offline!`, 'Unduhan Berhasil');
      this.checkAndApplyLRUEviction();
      return true;
    } catch (err) {
      console.warn('Offline download error:', err);
      // If CORS prevented direct fetch, fallback store blob if local
      if (track.audioType === 'local') {
        track.offline = true;
        await dbManager.saveTrack(track);
        Toast.success(`"${track.title}" tersimpan dari file lokal.`, 'Tersedia Offline');
        return true;
      }
      Toast.error('Gagal mengunduh audio offline. Pastikan koneksi internet stabil.', 'Unduhan Gagal');
      return false;
    }
  }

  /**
   * Remove track from offline cache
   */
  async removeTrackOffline(track) {
    try {
      if (typeof caches !== 'undefined' && track.audioUrl) {
        const cache = await caches.open(AUDIO_CACHE_NAME);
        await cache.delete(new Request(track.audioUrl));
      }
      track.offline = false;
      await dbManager.saveTrack(track);
      Toast.info(`"${track.title}" dihapus dari unduhan offline.`);
      return true;
    } catch (e) {
      console.warn('Remove offline error:', e);
      return false;
    }
  }

  /**
   * Clear all cached offline audio files
   */
  async clearAllOfflineAudio() {
    if (typeof caches !== 'undefined') {
      await caches.delete(AUDIO_CACHE_NAME);
    }
    const all = await dbManager.getAllTracks();
    for (const t of all) {
      if (t.offline) {
        t.offline = false;
        await dbManager.saveTrack(t);
      }
    }
    Toast.success('Semua cache audio offline berhasil dibersihkan.', 'Pembersihan Selesai');
    return true;
  }

  /**
   * LRU (Least Recently Used) automatic cleanup when exceeding quota limit
   */
  async checkAndApplyLRUEviction() {
    try {
      if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.estimate) return;
      const est = await navigator.storage.estimate();
      const currentUsage = est.usage || 0;
      const limitBytes = this.quotaLimitMb * 1024 * 1024;

      if (currentUsage > limitBytes) {
        console.log('[StorageManager] Usage exceeds quota limit. Running LRU eviction...');
        const allTracks = await dbManager.getAllTracks();
        const offlineTracks = allTracks.filter(t => t.offline);

        // Sort by last played timestamp ascending (oldest first)
        offlineTracks.sort((a, b) => (a.lastPlayedAt || 0) - (b.lastPlayedAt || 0));

        const cache = await caches.open(AUDIO_CACHE_NAME);
        let evictedCount = 0;

        for (const track of offlineTracks) {
          if (track.audioUrl) {
            await cache.delete(new Request(track.audioUrl));
            track.offline = false;
            await dbManager.saveTrack(track);
            evictedCount++;
          }
          const checkEst = await navigator.storage.estimate();
          if ((checkEst.usage || 0) <= limitBytes * 0.85) {
            break; // safely below limit
          }
        }

        if (evictedCount > 0) {
          Toast.info(`Pembersihan otomatis LRU: ${evictedCount} lagu terlama dihapus dari cache offline untuk menjaga kapasitas penyimpanan.`, 'Hemat Ruang');
        }
      }
    } catch (e) {
      console.warn('LRU Eviction error:', e);
    }
  }
}

export const storageManager = new StorageManager();
