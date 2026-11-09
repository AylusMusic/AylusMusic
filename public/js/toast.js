/**
 * AylusMusic - Modern Toast, Modal & BottomSheet System
 * Zero-alert/confirm/prompt architecture.
 */

import { sanitize } from './utils.js';

class ToastManager {
  constructor() {
    this.container = null;
    this.init();
  }

  init() {
    if (typeof document === 'undefined') return;
    let existing = document.getElementById('toast-container');
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'toast-container';
      existing.setAttribute('aria-live', 'polite');
      existing.setAttribute('role', 'region');
      existing.setAttribute('aria-label', 'Notifikasi aplikasi');
      document.body.appendChild(existing);
    }
    this.container = existing;
  }

  /**
   * Show toast notification
   * @param {Object} options 
   * @param {string} options.title
   * @param {string} options.message
   * @param {'success'|'error'|'warning'|'info'} [options.type='info']
   * @param {number} [options.duration=4000]
   * @param {{ label: string, onClick: Function }} [options.action]
   */
  show({ title = '', message = '', type = 'info', duration = 4000, action = null }) {
    if (!this.container) this.init();
    if (!this.container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');

    // SVG icons based on type
    const icons = {
      success: `<svg class="toast-icon text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
      error: `<svg class="toast-icon text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
      warning: `<svg class="toast-icon text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`,
      info: `<svg class="toast-icon text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`
    };

    const actionHtml = action ? `
      <div class="toast-action">
        <button class="btn btn-outline text-xs py-1 px-2.5 h-auto min-h-[32px]">${sanitize(action.label)}</button>
      </div>
    ` : '';

    toast.innerHTML = `
      ${icons[type] || icons.info}
      <div class="toast-content">
        ${title ? `<div class="toast-title">${sanitize(title)}</div>` : ''}
        <div class="toast-message">${sanitize(message)}</div>
        ${actionHtml}
      </div>
      <button class="icon-btn text-xs min-h-[32px] min-w-[32px] w-7 h-7 ml-1 text-slate-400 hover:text-white" aria-label="Tutup notifikasi">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
      <div class="toast-progress" style="animation-duration: ${duration}ms;"></div>
    `;

    // Action button handler
    if (action) {
      const actionBtn = toast.querySelector('.toast-action button');
      if (actionBtn) {
        actionBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          action.onClick();
          this.dismiss(toast);
        });
      }
    }

    // Close button handler
    const closeBtn = toast.querySelector('button[aria-label="Tutup notifikasi"]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.dismiss(toast));
    }

    // Swipe / Click to dismiss
    let startX = 0;
    toast.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
    }, { passive: true });

    toast.addEventListener('touchend', (e) => {
      const diffX = e.changedTouches[0].clientX - startX;
      if (Math.abs(diffX) > 60) {
        this.dismiss(toast);
      }
    }, { passive: true });

    this.container.appendChild(toast);

    // Auto dismiss
    const timeout = setTimeout(() => {
      this.dismiss(toast);
    }, duration);

    toast._dismissTimeout = timeout;
    return toast;
  }

  dismiss(toast) {
    if (!toast || toast._isDismissing) return;
    toast._isDismissing = true;
    clearTimeout(toast._dismissTimeout);
    toast.classList.add('toast-removing');
    setTimeout(() => {
      if (toast.parentElement) {
        toast.parentElement.removeChild(toast);
      }
    }, 220);
  }

  success(message, title = 'Berhasil') {
    return this.show({ title, message, type: 'success' });
  }

  error(message, title = 'Terjadi Masalah', action = null) {
    return this.show({ title, message, type: 'error', duration: 5500, action });
  }

  warning(message, title = 'Perhatian') {
    return this.show({ title, message, type: 'warning' });
  }

  info(message, title = 'Info') {
    return this.show({ title, message, type: 'info' });
  }
}

export const Toast = new ToastManager();

/**
 * Modern Confirmation Dialog (Replaces window.confirm)
 */
export const Dialog = {
  confirm({
    title = 'Konfirmasi',
    message = 'Apakah Anda yakin ingin melanjutkan?',
    confirmText = 'Lanjutkan',
    cancelText = 'Batal',
    isDanger = false
  }) {
    return new Promise((resolve) => {
      let overlay = document.getElementById('dialog-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'dialog-overlay';
        overlay.className = 'modal-overlay';
        document.body.appendChild(overlay);
      }

      overlay.innerHTML = `
        <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
          <h3 id="dialog-title" class="text-xl font-bold mb-2 text-white">${sanitize(title)}</h3>
          <p class="text-sm text-slate-300 leading-relaxed mb-6">${sanitize(message)}</p>
          <div class="flex items-center justify-end gap-3">
            <button id="dialog-cancel-btn" class="btn btn-secondary text-sm">${sanitize(cancelText)}</button>
            <button id="dialog-confirm-btn" class="btn ${isDanger ? 'btn-danger' : 'btn-primary'} text-sm">${sanitize(confirmText)}</button>
          </div>
        </div>
      `;

      overlay.classList.add('active');

      const cancelBtn = overlay.querySelector('#dialog-cancel-btn');
      const confirmBtn = overlay.querySelector('#dialog-confirm-btn');

      const close = (result) => {
        overlay.classList.remove('active');
        setTimeout(() => {
          overlay.innerHTML = '';
        }, 250);
        resolve(result);
      };

      cancelBtn.addEventListener('click', () => close(false));
      confirmBtn.addEventListener('click', () => close(true));

      overlay.onclick = (e) => {
        if (e.target === overlay) close(false);
      };
    });
  }
};

/**
 * Modern Bottom Sheet Component
 */
export const BottomSheet = {
  show({ title = '', contentHtml = '', onClose = null, onOpen = null }) {
    let sheetOverlay = document.getElementById('bottom-sheet-overlay');
    if (!sheetOverlay) {
      sheetOverlay = document.createElement('div');
      sheetOverlay.id = 'bottom-sheet-overlay';
      sheetOverlay.className = 'bottom-sheet-overlay';
      document.body.appendChild(sheetOverlay);
    }

    sheetOverlay.innerHTML = `
      <div class="bottom-sheet-card" role="dialog" aria-modal="true">
        <div class="bottom-sheet-handle"></div>
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold text-white">${sanitize(title)}</h3>
          <button id="close-sheet-btn" class="icon-btn text-slate-400 hover:text-white" aria-label="Tutup">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="bottom-sheet-body">
          ${contentHtml}
        </div>
      </div>
    `;

    sheetOverlay.classList.add('active');

    const close = () => {
      sheetOverlay.classList.remove('active');
      if (typeof onClose === 'function') onClose();
    };

    const closeBtn = sheetOverlay.querySelector('#close-sheet-btn');
    if (closeBtn) closeBtn.onclick = close;

    sheetOverlay.onclick = (e) => {
      if (e.target === sheetOverlay) close();
    };

    if (typeof onOpen === 'function') {
      try {
        onOpen({ close });
      } catch (e) {
        console.error('BottomSheet onOpen error:', e);
      }
    }

    return { close };
  }
};
