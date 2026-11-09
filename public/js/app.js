/**
 * AylusMusic - Main Application Entrypoint
 * Orchestrates onboarding wizard, service worker, audio engine, and routing.
 */

import { settingsManager } from './settings.js';
import { dbManager } from './db.js';
import { authManager } from './auth.js';
import { audioEngine } from './audio-engine.js';
import { audioSourcesManager } from './audio-sources.js';
import { uiManager } from './ui.js';
import { router } from './router.js';
import { spotifyImporter } from './spotify.js';
import { Toast } from './toast.js';
import { sanitize, sleep } from './utils.js';

class App {
  constructor() {
    this.onboardingStep = 1;
    this.userNameInput = '';
    this.selectedSource = '';
    this.customSourceText = '';
  }

  async start() {
    console.log('[AylusMusic] Initializing application...');

    // 1. Apply theme
    settingsManager.init();

    // 2. Register Service Worker
    this._registerServiceWorker();

    // 3. Initialize Database
    try {
      await dbManager.init();
      await audioSourcesManager.ensureInitialSampleTracks();
    } catch (e) {
      console.warn('[DB] Init error:', e);
    }

    // 4. Initialize Auth
    try {
      await authManager.init();
    } catch (e) {
      console.warn('[Auth] Init error:', e);
    }

    // 5. Initialize UI & Audio
    uiManager.init();

    // Check for Spotify OAuth callback in URL
    const urlParams = new URLSearchParams(window.location.search);
    const spotifyCode = urlParams.get('code');
    const spotifyError = urlParams.get('error');

    if (spotifyCode) {
      try {
        Toast.info('Menghubungkan akun Spotify Anda...');
        await spotifyImporter.handleCallback(spotifyCode);
        window.history.replaceState({}, document.title, window.location.pathname);
        Toast.success('Akun Spotify berhasil terhubung!', 'Spotify Terhubung');
      } catch (err) {
        Toast.error(err.message || 'Gagal menghubungkan akun Spotify.', 'Koneksi Gagal');
      }
    } else if (spotifyError) {
      Toast.error(`Koneksi Spotify ditolak: ${spotifyError}`, 'Spotify Ditolak');
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // 6. Register Router endpoints
    router.register('/home', () => uiManager.renderHome());
    router.register('/search', () => uiManager.renderSearch());
    router.register('/library', () => uiManager.renderLibrary());
    router.register('/playlist/:id', (params) => uiManager.renderPlaylistDetail(params.id));
    router.register('/profile', () => uiManager.renderProfile());
    router.register('/settings', () => uiManager.renderSettings());

    // 7. Check Onboarding status
    const isCompleted = localStorage.getItem('aylus_onboarding_completed') === 'true';
    const isAutostart = urlParams.get('autostart') === '1';

    // Loading screen animation (min 1.8s)
    const loadingBar = document.getElementById('loading-bar-fill');
    if (loadingBar) {
      setTimeout(() => { loadingBar.style.width = '100%'; }, 50);
    }

    await sleep(1800);

    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.classList.add('fade-out');
      setTimeout(() => { loadingScreen.remove(); }, 400);
    }

    if (isCompleted || isAutostart) {
      router.init();
    } else {
      this._startOnboardingWizard();
    }
  }

  _registerServiceWorker() {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then((reg) => {
          console.log('[SW] Registered with scope:', reg.scope);

          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                Toast.info('Versi baru AylusMusic tersedia.', 'Pembaruan Aplikasi', {
                  label: 'Muat Ulang',
                  onClick: () => {
                    newWorker.postMessage({ type: 'SKIP_WAITING' });
                    window.location.reload();
                  }
                });
              }
            });
          });
        }).catch((err) => {
          console.warn('[SW] Registration failed:', err);
        });
      });
    }
  }

  _startOnboardingWizard() {
    const onboardingEl = document.getElementById('onboarding-screen');
    if (!onboardingEl) {
      router.init();
      return;
    }

    onboardingEl.classList.remove('hidden');
    this.renderOnboardingStep(2); // Step 2: Welcome & Name
  }

  renderOnboardingStep(step) {
    this.onboardingStep = step;
    const card = document.getElementById('onboarding-card-content');
    if (!card) return;

    if (step === 2) {
      // Step 2: Welcome & Nickname
      card.innerHTML = `
        <div class="onboarding-step-indicator">
          <div class="onboarding-step-dot active"></div>
          <div class="onboarding-step-dot"></div>
          <div class="onboarding-step-dot"></div>
        </div>

        <div class="text-center mb-6">
          <div class="w-20 h-20 mx-auto mb-3">
            <img src="/assets/logo.png" alt="AylusMusic Logo" class="w-full h-full object-contain filter drop-shadow-lg" />
          </div>
          <h2 class="onboarding-title">Selamat datang di AylusMusic</h2>
          <p class="onboarding-subtitle">Pemutar musik PWA modern, hemat penyimpanan, dan bisa dinikmati offline.</p>
        </div>

        <form id="onboarding-step2-form" class="space-y-4">
          <div>
            <label for="nickname-input" class="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">Biasa dipanggil apa?</label>
            <input 
              type="text" 
              id="nickname-input" 
              placeholder="Contoh: Alex, Sari, Budi" 
              maxlength="24"
              minlength="2"
              required
              class="w-full text-base py-3"
              autofocus
            />
            <p id="name-validation-err" class="text-xs text-red-400 mt-1 hidden">Nama panggilan wajib diisi (2–24 karakter).</p>
          </div>

          <button type="submit" class="btn btn-primary w-full text-sm py-3 justify-center">
            Lanjut
            <svg class="w-4 h-4 ml-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
        </form>
      `;

      const form = document.getElementById('onboarding-step2-form');
      const input = document.getElementById('nickname-input');
      const err = document.getElementById('name-validation-err');

      form.onsubmit = (e) => {
        e.preventDefault();
        const val = input.value.trim().replace(/<[^>]*>?/gm, '');
        if (val.length < 2 || val.length > 24) {
          err.classList.remove('hidden');
          input.focus();
          return;
        }
        err.classList.add('hidden');
        this.userNameInput = val;
        authManager.setUserName(val);
        this.renderOnboardingStep(3); // Step 3: Discovery Source
      };
    } else if (step === 3) {
      // Step 3: Exactly 12 Discovery Sources
      const sources = [
        'Instagram',
        'TikTok',
        'YouTube',
        'Facebook',
        'X (Twitter)',
        'WhatsApp',
        'Telegram',
        'Teman',
        'Keluarga',
        'Google / Pencarian',
        'Kampus / Komunitas',
        'Lainnya'
      ];

      card.innerHTML = `
        <div class="onboarding-step-indicator">
          <div class="onboarding-step-dot completed"></div>
          <div class="onboarding-step-dot active"></div>
          <div class="onboarding-step-dot"></div>
        </div>

        <h2 class="onboarding-title">Tahu AylusMusic dari mana?</h2>
        <p class="onboarding-subtitle">Bantu kami mengetahui bagaimana Anda menemukan aplikasi ini.</p>

        <div class="source-chips-grid">
          ${sources.map(src => `
            <button type="button" class="source-chip" data-source="${src}">
              ${src}
            </button>
          `).join('')}
        </div>

        <div id="custom-source-container" class="mb-4 hidden">
          <label for="custom-source-input" class="block text-xs font-semibold text-slate-300 mb-1">Ceritakan singkat:</label>
          <input type="text" id="custom-source-input" placeholder="Tuliskan dari mana Anda mengetahui Aylus..." class="w-full text-xs" />
        </div>

        <div class="flex items-center gap-3 mt-6">
          <button type="button" id="step3-back-btn" class="btn btn-secondary flex-1 text-sm py-2.5 justify-center">Kembali</button>
          <button type="button" id="step3-next-btn" class="btn btn-primary flex-1 text-sm py-2.5 justify-center">Lanjut</button>
        </div>
      `;

      const chips = card.querySelectorAll('.source-chip');
      const customContainer = document.getElementById('custom-source-container');
      const customInput = document.getElementById('custom-source-input');

      chips.forEach(chip => {
        chip.onclick = () => {
          chips.forEach(c => c.classList.remove('selected'));
          chip.classList.add('selected');
          const src = chip.getAttribute('data-source');
          this.selectedSource = src;
          if (src === 'Lainnya') {
            customContainer.classList.remove('hidden');
            customInput.focus();
          } else {
            customContainer.classList.add('hidden');
          }
        };
      });

      document.getElementById('step3-back-btn').onclick = () => this.renderOnboardingStep(2);
      document.getElementById('step3-next-btn').onclick = () => {
        if (!this.selectedSource) {
          Toast.warning('Pilih salah satu sumber terlebih dahulu.');
          return;
        }
        const finalSource = this.selectedSource === 'Lainnya' 
          ? (customInput?.value?.trim() || 'Lainnya')
          : this.selectedSource;
        authManager.setDiscoverySource(finalSource);
        this.renderOnboardingStep(4); // Step 4: Sign in Google vs Guest
      };
    } else if (step === 4) {
      // Step 4: Masuk (Google vs Guest) with Comparison Table
      card.innerHTML = `
        <div class="onboarding-step-indicator">
          <div class="onboarding-step-dot completed"></div>
          <div class="onboarding-step-dot completed"></div>
          <div class="onboarding-step-dot active"></div>
        </div>

        <h2 class="onboarding-title">Pilih Cara Masuk</h2>
        <p class="onboarding-subtitle">Pilih masuk dengan Google untuk sinkronisasi antar perangkat atau lanjut sebagai Tamu.</p>

        <!-- Google vs Guest Comparison Table -->
        <div class="comparison-table-wrapper">
          <table class="comparison-table">
            <thead>
              <tr>
                <th>Fitur & Kapasitas</th>
                <th class="text-cyan-400">Google</th>
                <th class="text-amber-400">Tamu</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Sinkronisasi Lintas Perangkat</td>
                <td><span class="check-icon">✓</span></td>
                <td><span class="lock-icon">✕</span></td>
              </tr>
              <tr>
                <td>Backup Otomatis Cloud (Firestore)</td>
                <td><span class="check-icon">✓</span></td>
                <td><span class="lock-icon">✕</span></td>
              </tr>
              <tr>
                <td>Impor Playlist Spotify</td>
                <td><span class="check-icon">Tanpa Batas</span></td>
                <td><span class="text-slate-400 text-xs">Maks 1 (50 lagu)</span></td>
              </tr>
              <tr>
                <td>Volume Boost Web Audio</td>
                <td><span class="check-icon font-bold">Hingga 300%</span></td>
                <td><span class="text-slate-400 text-xs">Maks 150%</span></td>
              </tr>
              <tr>
                <td>Equalizer 10-Band</td>
                <td><span class="check-icon">Preset & Kustom</span></td>
                <td><span class="text-slate-400 text-xs">Preset Bawaan</span></td>
              </tr>
              <tr>
                <td>Unduhan Musik Offline</td>
                <td><span class="check-icon">Sesuai Kuota HP</span></td>
                <td><span class="text-slate-400 text-xs">Maks 20 lagu</span></td>
              </tr>
              <tr>
                <td>Statistik Mendengarkan Musik</td>
                <td><span class="check-icon">✓ Lengkap</span></td>
                <td><span class="lock-icon">✕</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex flex-col gap-2.5 mt-5">
          <button id="auth-google-login-btn" class="btn btn-gold w-full text-sm py-3 justify-center shadow-lg">
            <svg class="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.748L12.545,10.239z"/>
            </svg>
            Masuk dengan Google (Disarankan)
          </button>

          <button id="auth-guest-btn" class="btn btn-secondary w-full text-xs py-2.5 justify-center">
            Lanjut sebagai Tamu (Guest)
          </button>
        </div>
      `;

      document.getElementById('auth-google-login-btn').onclick = async () => {
        const success = await authManager.signInWithGoogle();
        if (success) {
          this.renderOnboardingStep(5);
        }
      };

      document.getElementById('auth-guest-btn').onclick = () => {
        authManager.continueAsGuest();
        this.renderOnboardingStep(5);
      };
    } else if (step === 5) {
      // Step 5: Post-login prompt "Halo, [nama]! Mau impor playlist Spotify sekarang?"
      const userName = authManager.userName || this.userNameInput;

      card.innerHTML = `
        <div class="text-center py-4">
          <div class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
            </svg>
          </div>
          <h2 class="text-xl font-bold text-white mb-2">Halo, ${sanitize(userName)}!</h2>
          <p class="text-xs text-slate-300 max-w-sm mx-auto mb-6 leading-relaxed">
            Mau impor playlist Spotify Anda sekarang agar seluruh lagu favorit langsung siap di AylusMusic?
          </p>

          <div class="flex flex-col gap-2.5">
            <button id="post-login-import-btn" class="btn btn-gold w-full text-xs py-3 justify-center">
              Ya, Impor Playlist Spotify Sekarang
            </button>
            <button id="post-login-skip-btn" class="btn btn-secondary w-full text-xs py-2.5 justify-center">
              Lewati & Masuk ke Beranda
            </button>
          </div>
        </div>
      `;

      const finishOnboarding = () => {
        localStorage.setItem('aylus_onboarding_completed', 'true');
        const onboardingEl = document.getElementById('onboarding-screen');
        if (onboardingEl) {
          onboardingEl.classList.add('fade-out');
          setTimeout(() => onboardingEl.remove(), 350);
        }
        router.init();
      };

      document.getElementById('post-login-import-btn').onclick = () => {
        finishOnboarding();
        setTimeout(() => uiManager.showSpotifyImportModal(), 400);
      };

      document.getElementById('post-login-skip-btn').onclick = () => {
        finishOnboarding();
      };
    }
  }
}

export const app = new App();

// Auto start when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.start());
  } else {
    app.start();
  }
}
