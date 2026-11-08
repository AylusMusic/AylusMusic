/**
 * AylusMusic - Settings & Preferences Module
 */

import { audioEngine } from './audio-engine.js';
import { storageManager } from './storage-manager.js';
import { Toast, Dialog } from './toast.js';

class SettingsManager {
  constructor() {
    this.theme = localStorage.getItem('aylus_theme') || 'dark';
    this.crossfadeSeconds = parseInt(localStorage.getItem('aylus_crossfade') || '2', 10);
    this.wakeLock = localStorage.getItem('aylus_wakelock') !== 'false';
  }

  init() {
    this.applyTheme(this.theme);
  }

  applyTheme(theme) {
    this.theme = theme;
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('aylus_theme', theme);

    // Sync theme-color meta tag
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', theme === 'dark' ? '#06303A' : '#F4FFFD');
    }
  }

  toggleTheme() {
    const next = this.theme === 'dark' ? 'light' : 'dark';
    this.applyTheme(next);
    Toast.info(`Tema diubah ke ${next === 'dark' ? 'Gelap' : 'Terang'}`);
    return next;
  }

  setCrossfade(seconds) {
    this.crossfadeSeconds = Math.max(0, Math.min(12, parseInt(seconds, 10) || 0));
    localStorage.setItem('aylus_crossfade', this.crossfadeSeconds.toString());
  }

  setWakeLock(enabled) {
    this.wakeLock = !!enabled;
    localStorage.setItem('aylus_wakelock', this.wakeLock ? 'true' : 'false');
  }

  resetOnboarding() {
    localStorage.removeItem('aylus_onboarding_completed');
    localStorage.removeItem('aylus_nickname');
    localStorage.removeItem('aylus_discovery_source');
    localStorage.removeItem('aylus_is_guest');
    Toast.success('Pengenalan awal telah direset. Halaman akan dimuat ulang...', 'Reset Berhasil');
    setTimeout(() => {
      window.location.reload();
    }, 1200);
  }
}

export const settingsManager = new SettingsManager();
