/**
 * AylusMusic - Authentication Module
 * Google Sign-In via Firebase Auth & Guest Mode with Data Merging
 */

import { initFirebase, auth } from './firebase.js';
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
    // Check local storage guest state
    const savedGuest = localStorage.getItem('aylus_is_guest') === 'true';
    if (savedGuest) {
      this.isGuest = true;
    }

    try {
      const { auth } = await initFirebase();
      if (!auth) {
        if (!this.isGuest) this.isGuest = true;
        this._notifyListeners();
        return;
      }

      const { onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');

      onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          this.user = firebaseUser;
          this.isGuest = false;
          localStorage.removeItem('aylus_is_guest');
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
          this.user = null;
          // Retain guest if marked
          if (savedGuest) {
            this.isGuest = true;
          }
        }
        this._notifyListeners();
      });
    } catch (err) {
      console.warn('[Auth] Auth init fallback to guest:', err.message);
      this.isGuest = true;
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
      isGuest: this.isGuest,
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
    this._notifyListeners();
    return true;
  }

  setDiscoverySource(source) {
    this.discoverySource = source;
    localStorage.setItem('aylus_discovery_source', source);
  }

  async signInWithGoogle() {
    try {
      const { auth, GoogleAuthProvider } = await initFirebase();
      if (!auth || !GoogleAuthProvider) {
        Toast.error('Layanan otentikasi sedang tidak terhubung. Menggunakan mode Tamu.', 'Offline / Error');
        return false;
      }

      const { signInWithPopup, signInWithRedirect } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
      const provider = new GoogleAuthProvider();
      provider.addScope('profile');
      provider.addScope('email');

      let userCredential = null;
      try {
        userCredential = await signInWithPopup(auth, provider);
      } catch (popupErr) {
        // Fallback to redirect if popup is blocked or on mobile browsers
        if (popupErr.code === 'auth/popup-blocked' || popupErr.code === 'auth/cancelled-popup-request') {
          Toast.info('Membuka halaman masuk Google...', 'Mengalihkan');
          await signInWithRedirect(auth, provider);
          return true;
        } else if (popupErr.code === 'auth/popup-closed-by-user') {
          Toast.info('Jendela masuk Google ditutup.', 'Dibatalkan');
          return false;
        } else if (popupErr.code === 'auth/unauthorized-domain') {
          Toast.error('Domain ini belum didaftarkan di Authorized Domains Firebase Console. Lanjut sebagai Tamu sementara.', 'Domain Belum Diizinkan');
          this.continueAsGuest();
          return false;
        } else {
          throw popupErr;
        }
      }

      if (userCredential && userCredential.user) {
        this.user = userCredential.user;
        this.isGuest = false;
        localStorage.removeItem('aylus_is_guest');
        this.userName = userCredential.user.displayName || this.userName;
        localStorage.setItem('aylus_nickname', this.userName);

        Toast.success(`Selamat datang kembali, ${this.userName}!`, 'Berhasil Masuk');

        // Merge local data to Google account
        await dbManager.syncToCloud(this.user);
        this._notifyListeners();
        return true;
      }
    } catch (err) {
      console.error('[Auth] Google sign in error:', err);
      Toast.error(err.message || 'Gagal masuk dengan Google. Silakan coba lagi.', 'Masuk Gagal');
      return false;
    }
    return false;
  }

  continueAsGuest() {
    this.isGuest = true;
    this.user = null;
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
              <span>Impor Spotify tanpa batas & sinkronisasi otomatis</span>
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
