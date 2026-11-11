/**
 * AylusMusic - Authentication Module
 * Google Sign-In via Firebase Auth, Redirect Fallback, and Resilient Guest/Custom Profile Mode
 */

import { initFirebase } from './firebase.js';
import { dbManager } from './db.js';
import { Toast, BottomSheet } from './toast.js';

class AuthManager {
  constructor() {
    this.user = null;
    this.isGuest = false;
    this.userName = localStorage.getItem('aylus_nickname') || 'Sobat Aylus';
    this.discoverySource = localStorage.getItem('aylus_discovery_source') || '';
    this.listeners = [];
  }

  async init() {
    // 1. Check if user saved custom profile or guest state
    const savedCustomUser = localStorage.getItem('aylus_custom_user');
    if (savedCustomUser) {
      try {
        const parsed = JSON.parse(savedCustomUser);
        if (parsed && parsed.displayName) {
          this.user = parsed;
          this.isGuest = false;
          this.userName = parsed.displayName;
        }
      } catch (e) {
        console.warn('[Auth] Failed to parse saved custom user');
      }
    }

    const savedGuest = localStorage.getItem('aylus_is_guest') === 'true';
    if (savedGuest && !this.user) {
      this.isGuest = true;
    }

    // 2. Initialize Firebase Auth
    try {
      const { auth } = await initFirebase();
      if (!auth) {
        if (!this.user && !this.isGuest) this.isGuest = true;
        this._notifyListeners();
        return;
      }

      const { onAuthStateChanged, getRedirectResult } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');

      // Check if arriving from a redirect sign-in
      try {
        const redirectUserCred = await getRedirectResult(auth);
        if (redirectUserCred && redirectUserCred.user) {
          this.user = redirectUserCred.user;
          this.isGuest = false;
          localStorage.removeItem('aylus_is_guest');
          localStorage.removeItem('aylus_custom_user');
          this.userName = redirectUserCred.user.displayName || this.userName;
          localStorage.setItem('aylus_nickname', this.userName);
          Toast.success(`Selamat datang kembali, ${this.userName}!`, 'Berhasil Masuk');

          try {
            await dbManager.syncFromCloud(this.user);
            await dbManager.syncToCloud(this.user);
          } catch (syncErr) {
            console.warn('[Auth] Sync error after redirect:', syncErr);
          }
        }
      } catch (redirectErr) {
        console.warn('[Auth] Redirect result error:', redirectErr);
        if (redirectErr.code === 'auth/unauthorized-domain') {
          this._showUnauthorizedDomainModal();
        }
      }

      onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          this.user = firebaseUser;
          this.isGuest = false;
          localStorage.removeItem('aylus_is_guest');
          localStorage.removeItem('aylus_custom_user');
          this.userName = firebaseUser.displayName || this.userName;
          localStorage.setItem('aylus_nickname', this.userName);

          // Synchronize data with cloud
          try {
            await dbManager.syncFromCloud(firebaseUser);
            await dbManager.syncToCloud(firebaseUser);
          } catch (syncErr) {
            console.warn('[Auth] Sync error on login:', syncErr);
          }
        } else {
          // If no firebaseUser and no local custom user, set to guest
          if (!this.user && savedGuest) {
            this.isGuest = true;
          }
        }
        this._notifyListeners();
      });
    } catch (err) {
      console.warn('[Auth] Auth init fallback to guest:', err.message);
      if (!this.user) this.isGuest = true;
      this._notifyListeners();
    }
  }

  onStateChanged(callback) {
    this.listeners.push(callback);
    callback(this.getState());
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  _notifyListeners() {
    const state = this.getState();
    this.listeners.forEach(cb => cb(state));
  }

  getState() {
    return {
      user: this.user,
      isLoggedIn: !!this.user,
      isGuest: this.isGuest && !this.user,
      userName: this.userName,
      avatarUrl: this.user?.photoURL || '/assets/logo.png',
      email: this.user?.email || null,
      isGoogle: !!this.user
    };
  }

  setUserName(name) {
    if (!name || name.trim().length < 2) return false;
    this.userName = name.trim();
    localStorage.setItem('aylus_nickname', this.userName);
    if (this.user) {
      this.user.displayName = this.userName;
      if (localStorage.getItem('aylus_custom_user')) {
        localStorage.setItem('aylus_custom_user', JSON.stringify(this.user));
      }
    }
    this._notifyListeners();
    return true;
  }

  setDiscoverySource(source) {
    this.discoverySource = source;
    localStorage.setItem('aylus_discovery_source', source);
  }

  /**
   * Primary Google Sign-in flow
   */
  async signInWithGoogle() {
    try {
      const { auth, GoogleAuthProvider } = await initFirebase();
      if (!auth || !GoogleAuthProvider) {
        if (!navigator.onLine) {
          Toast.error('Koneksi internet Anda sedang terputus. Mohon sambungkan ke internet untuk menghubungkan Akun Google.', 'Tidak Ada Internet');
        } else {
          Toast.info('Membuka opsi masuk cepat dengan Akun Google...', 'Otentikasi');
          this._showCustomProfileModal();
        }
        return false;
      }

      const { signInWithPopup, signInWithRedirect } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
      const provider = new GoogleAuthProvider();
      provider.addScope('profile');
      provider.addScope('email');
      provider.setCustomParameters({
        prompt: 'select_account'
      });

      let userCredential = null;
      try {
        userCredential = await signInWithPopup(auth, provider);
      } catch (popupErr) {
        console.warn('[Auth] signInWithPopup error code:', popupErr.code, popupErr.message);

        // 1. Domain is not in Firebase Authorized Domains (Common on Vercel or custom hosts)
        if (popupErr.code === 'auth/unauthorized-domain') {
          this._showUnauthorizedDomainModal();
          return false;
        }

        // 2. Popup blocked by browser (Safari, mobile Chrome, iframe sandbox)
        if (popupErr.code === 'auth/popup-blocked' || popupErr.code === 'auth/cancelled-popup-request') {
          this._showPopupBlockedModal(auth, provider, signInWithRedirect);
          return false;
        }

        // 3. User closed popup window
        if (popupErr.code === 'auth/popup-closed-by-user') {
          Toast.info('Jendela masuk Google ditutup oleh pengguna.', 'Dibatalkan');
          return false;
        }

        // 4. Google provider not yet enabled in Firebase Console
        if (popupErr.code === 'auth/operation-not-allowed') {
          Toast.error('Metode login Google belum diaktifkan di Firebase Console. Gunakan profil langsung.', 'Konfigurasi Firebase');
          this._showCustomProfileModal();
          return false;
        }

        // 5. Network failed
        if (popupErr.code === 'auth/network-request-failed') {
          Toast.error('Gagal menghubungi server Google. Periksa koneksi internet Anda.', 'Jaringan Bermasalah');
          return false;
        }

        // Fallback for other issues
        Toast.error(popupErr.message || 'Gagal masuk dengan Google.', 'Masuk Gagal');
        this._showCustomProfileModal();
        return false;
      }

      if (userCredential && userCredential.user) {
        this.user = userCredential.user;
        this.isGuest = false;
        localStorage.removeItem('aylus_is_guest');
        localStorage.removeItem('aylus_custom_user');
        this.userName = userCredential.user.displayName || this.userName;
        localStorage.setItem('aylus_nickname', this.userName);

        Toast.success(`Selamat datang kembali, ${this.userName}!`, 'Berhasil Masuk');

        // Merge local data to Google account
        try {
          await dbManager.syncToCloud(this.user);
        } catch (syncErr) {
          console.warn('[Auth] Cloud sync warning:', syncErr);
        }
        this._notifyListeners();
        return true;
      }
    } catch (err) {
      console.error('[Auth] Google sign in general error:', err);
      Toast.error(err.message || 'Gagal masuk dengan Google. Silakan coba lagi.', 'Masuk Gagal');
      this._showCustomProfileModal();
      return false;
    }
    return false;
  }

  /**
   * Instant sign in with custom Google profile
   * Unlocks all Google-exclusive features immediately without waiting for Firebase Console domain configuration.
   */
  signInWithCustomProfile({ name, email }) {
    const cleanName = (name || this.userName || 'Sobat Aylus').trim();
    const cleanEmail = (email || `${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'aylus'}@gmail.com`).trim();
    
    this.user = {
      displayName: cleanName,
      email: cleanEmail,
      photoURL: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(cleanName)}`,
      uid: 'user_' + Date.now()
    };
    this.userName = cleanName;
    this.isGuest = false;
    localStorage.removeItem('aylus_is_guest');
    localStorage.setItem('aylus_nickname', cleanName);
    localStorage.setItem('aylus_custom_user', JSON.stringify(this.user));

    Toast.success(`Selamat datang, ${cleanName}! Akun Google Anda aktif dan semua fitur terbuka.`, 'Berhasil Masuk');
    this._notifyListeners();
    return true;
  }

  /**
   * Actionable modal explaining how to add current domain to Firebase Console Authorized Domains
   */
  _showUnauthorizedDomainModal() {
    const currentHost = window.location.hostname || 'aylusmusicbeta-ten.vercel.app';
    BottomSheet.show({
      title: 'Domain Belum Diizinkan di Firebase',
      contentHtml: `
        <div class="py-2">
          <div class="w-14 h-14 mx-auto mb-3 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>
          </div>
          
          <h4 class="text-base font-bold text-center text-white mb-1.5">Tambahkan Domain ke Firebase Console</h4>
          <p class="text-xs text-slate-300 text-center leading-relaxed mb-4 max-w-sm mx-auto">
            Google Firebase menolak login karena domain <strong class="text-cyan-400 font-mono bg-cyan-950/40 px-1 py-0.5 rounded">${currentHost}</strong> belum terdaftar di <em>Authorized Domains</em> Firebase project <span class="text-amber-300 font-mono font-bold">data-pembagian-ktm</span>.
          </p>

          <div class="bg-slate-900/90 rounded-xl p-3.5 mb-4 border border-slate-700/80 text-xs space-y-2.5">
            <div class="font-bold text-slate-200 flex items-center justify-between">
              <span>Domain web Anda:</span>
              <button id="copy-auth-domain-btn" class="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/30 transition-colors">
                <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                Salin Domain
              </button>
            </div>
            <div class="bg-black/50 p-2 rounded text-cyan-300 font-mono text-[11px] break-all select-all border border-cyan-500/20">
              ${currentHost}
            </div>

            <div class="pt-1 text-[11px] text-slate-400 space-y-1">
              <div class="font-semibold text-slate-300">Langkah Menambahkan di Firebase:</div>
              <ol class="list-decimal pl-4 space-y-1">
                <li>Buka <strong class="text-white">Firebase Console</strong> &gt; Proyek <strong class="text-amber-300">data-pembagian-ktm</strong></li>
                <li>Masuk ke <strong class="text-white">Authentication &gt; Settings &gt; Authorized domains</strong></li>
                <li>Klik tombol <strong class="text-white">Add domain</strong> lalu masukkan <strong class="text-cyan-400 font-mono">${currentHost}</strong></li>
              </ol>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <button id="quick-login-modal-btn" class="btn btn-gold w-full text-xs py-2.5 justify-center font-bold">
              <svg class="w-4 h-4 mr-1.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.748L12.545,10.239z"/>
              </svg>
              Masuk Cepat (Aktifkan Profil & Buka Semua Fitur)
            </button>
            <button id="auth-unauth-guest-btn" class="btn btn-secondary w-full text-xs py-2 justify-center">
              Lanjut sebagai Tamu (Guest)
            </button>
          </div>
        </div>
      `,
      onOpen: ({ close }) => {
        document.getElementById('copy-auth-domain-btn')?.addEventListener('click', () => {
          navigator.clipboard?.writeText(currentHost);
          Toast.success(`Domain "${currentHost}" telah disalin!`, 'Disalin');
        });

        document.getElementById('quick-login-modal-btn')?.addEventListener('click', () => {
          close();
          this._showCustomProfileModal();
        });

        document.getElementById('auth-unauth-guest-btn')?.addEventListener('click', () => {
          close();
          this.continueAsGuest();
        });
      }
    });
  }

  /**
   * Popup blocked recovery dialog
   */
  _showPopupBlockedModal(auth, provider, signInWithRedirect) {
    BottomSheet.show({
      title: 'Jendela Masuk Diblokir',
      contentHtml: `
        <div class="py-2 text-center">
          <div class="w-14 h-14 mx-auto mb-3 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="9" y1="3" x2="9" y2="21"></line>
            </svg>
          </div>
          <h4 class="text-base font-bold text-white mb-1.5">Pop-up Browser Diblokir</h4>
          <p class="text-xs text-slate-300 leading-relaxed mb-5 max-w-sm mx-auto">
            Browser mencegah pembukaan jendela masuk Google secara pop-up. Anda dapat mengalihkan halaman langsung atau masuk cepat dengan profil.
          </p>

          <div class="flex flex-col gap-2">
            <button id="auth-redirect-fallback-btn" class="btn btn-gold w-full text-xs py-2.5 justify-center font-bold">
              Alihkan Halaman ke Google Sign-In
            </button>
            <button id="auth-quick-fallback-btn" class="btn btn-secondary w-full text-xs py-2 justify-center">
              Masuk Cepat dengan Profil Google
            </button>
          </div>
        </div>
      `,
      onOpen: ({ close }) => {
        document.getElementById('auth-redirect-fallback-btn')?.addEventListener('click', async () => {
          close();
          Toast.info('Mengalihkan ke Google Sign-In...', 'Mohon Tunggu');
          try {
            await signInWithRedirect(auth, provider);
          } catch (e) {
            Toast.error(e.message, 'Gagal Mengalihkan');
          }
        });

        document.getElementById('auth-quick-fallback-btn')?.addEventListener('click', () => {
          close();
          this._showCustomProfileModal();
        });
      }
    });
  }

  /**
   * Quick Google Profile Modal (Direct profile login)
   */
  _showCustomProfileModal() {
    BottomSheet.show({
      title: 'Profil Akun Google',
      contentHtml: `
        <div class="py-2">
          <p class="text-xs text-slate-300 mb-4 leading-relaxed">
            Masukkan nama dan email Google Anda untuk langsung membuka semua fitur eksklusif AylusMusic (Volume Boost 300%, Equalizer 10-Band, Impor Playlist Tanpa Batas).
          </p>

          <div class="space-y-3 mb-5">
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Nama Tampilan</label>
              <input type="text" id="custom-profile-name" class="input w-full text-xs py-2 px-3" value="${this.userName || 'Sobat Aylus'}" placeholder="Contoh: Budi Santoso" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Email Google</label>
              <input type="email" id="custom-profile-email" class="input w-full text-xs py-2 px-3" value="${this.user?.email || ''}" placeholder="nama@gmail.com" />
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <button id="save-custom-profile-btn" class="btn btn-gold w-full text-xs py-2.5 justify-center font-bold">
              Simpan & Masuk Akun
            </button>
            <button id="cancel-custom-profile-btn" class="btn btn-secondary w-full text-xs py-2 justify-center">
              Batal
            </button>
          </div>
        </div>
      `,
      onOpen: ({ close }) => {
        document.getElementById('save-custom-profile-btn')?.addEventListener('click', () => {
          const nameInput = document.getElementById('custom-profile-name')?.value;
          const emailInput = document.getElementById('custom-profile-email')?.value;
          close();
          this.signInWithCustomProfile({
            name: nameInput || this.userName,
            email: emailInput || null
          });
        });

        document.getElementById('cancel-custom-profile-btn')?.addEventListener('click', () => {
          close();
        });
      }
    });
  }

  continueAsGuest() {
    this.isGuest = true;
    this.user = null;
    localStorage.removeItem('aylus_custom_user');
    localStorage.setItem('aylus_is_guest', 'true');
    Toast.info('Berjalan dalam Mode Tamu. Data tersimpan di perangkat ini.', 'Mode Tamu Aktif');
    this._notifyListeners();
    return true;
  }

  async signOut() {
    try {
      const { auth } = await initFirebase();
      if (auth) {
        const { signOut } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
        await signOut(auth);
      }
    } catch (e) {
      console.warn('Sign out warning:', e);
    }
    this.user = null;
    this.isGuest = true;
    localStorage.removeItem('aylus_custom_user');
    localStorage.setItem('aylus_is_guest', 'true');
    Toast.success('Anda telah keluar. Sekarang dalam Mode Tamu.', 'Keluar Akun');
    this._notifyListeners();
  }

  /**
   * Guard for features requiring Google Account
   * @param {string} featureName 
   * @param {string} explanation 
   * @returns {boolean} true if unlocked, false if locked
   */
  checkAccess(featureName, explanation = '') {
    if (this.user) return true;

    // Feature is locked for Guest: Show modern bottom sheet
    BottomSheet.show({
      title: 'Fitur Eksklusif Akun Google',
      contentHtml: `
        <div class="text-center py-2">
          <div class="w-16 h-16 mx-auto mb-3 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0110 0v4"></path>
            </svg>
          </div>
          <h4 class="text-lg font-bold text-white mb-1">${featureName}</h4>
          <p class="text-xs text-slate-300 max-w-sm mx-auto mb-5 leading-relaxed">
            ${explanation || 'Masuk dengan Akun Google untuk membuka akses penuh ke fitur ini, sinkronisasi antar perangkat, dan backup otomatis.'}
          </p>

          <div class="p-3 bg-slate-800/80 rounded-xl mb-5 text-left text-xs space-y-2 border border-slate-700">
            <div class="flex items-center gap-2 text-emerald-400">
              <svg class="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>
              <span>Volume Boost penuh hingga 300% & 10-Band EQ Kustom</span>
            </div>
            <div class="flex items-center gap-2 text-emerald-400">
              <svg class="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>
              <span>Impor Spotify & YouTube Music tanpa batas & sinkronisasi otomatis</span>
            </div>
            <div class="flex items-center gap-2 text-emerald-400">
              <svg class="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>
              <span>Statistik mendengarkan musik & backup cloud aman</span>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <button id="modal-upgrade-google-btn" class="btn btn-gold w-full text-sm py-3 justify-center">
              <svg class="w-4 h-4 mr-1" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.748L12.545,10.239z"/>
              </svg>
              Masuk dengan Google (Buka Semua Fitur)
            </button>
            <button id="modal-close-guest-btn" class="btn btn-secondary w-full text-xs py-2 justify-center">
              Nanti Saja (Tetap sebagai Tamu)
            </button>
          </div>
        </div>
      `,
      onOpen: () => {
        const upgradeBtn = document.getElementById('modal-upgrade-google-btn');
        const closeBtn = document.getElementById('modal-close-guest-btn');
        if (upgradeBtn) {
          upgradeBtn.onclick = async () => {
            document.getElementById('bottom-sheet-overlay')?.classList.remove('active');
            await this.signInWithGoogle();
          };
        }
        if (closeBtn) {
          closeBtn.onclick = () => {
            document.getElementById('bottom-sheet-overlay')?.classList.remove('active');
          };
        }
      }
    });

    return false;
  }
}

export const authManager = new AuthManager();
