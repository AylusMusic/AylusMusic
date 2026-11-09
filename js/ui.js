/**
 * AylusMusic - UI Rendering Engine
 * Modular views, reactive player state synchronization, and accessible controls.
 */

import { sanitize, formatTime, formatBytes } from './utils.js';
import { dbManager } from './db.js';
import { authManager } from './auth.js';
import { player } from './player.js';
import { audioEngine, EQ_PRESETS, EQ_FREQUENCIES } from './audio-engine.js';
import { libraryManager } from './library.js';
import { storageManager } from './storage-manager.js';
import { spotifyImporter, getSpotifyClientId, setSpotifyClientId, getRedirectUri } from './spotify.js';
import { youtubeService } from './youtube.js';
import { audioSourcesManager } from './audio-sources.js';
import { settingsManager } from './settings.js';
import { Toast, Dialog, BottomSheet } from './toast.js';
import { router } from './router.js';

class UIManager {
  constructor() {
    this.mainContainer = null;
    this.currentView = 'home';
    this.searchQuery = '';
    this.searchFilter = 'all';
    this.activePlaylistId = null;
    this.pwaInstallPrompt = null;
  }

  init() {
    this.mainContainer = document.getElementById('main-viewport');
    this._bindPlayerBarEvents();
    this._bindFullscreenPlayerEvents();
    this._bindGlobalInstallPrompt();
    this._bindOnlineOfflineEvents();
  }

  // --- Online / Offline Status Indicator ---
  _bindOnlineOfflineEvents() {
    const updateOnlineStatus = () => {
      const isOnline = navigator.onLine;
      const indicator = document.getElementById('network-status-indicator');
      if (indicator) {
        if (isOnline) {
          indicator.className = 'badge badge-cool text-xs py-1 px-2.5 hidden';
          indicator.innerHTML = '● Online';
        } else {
          indicator.className = 'badge badge-gold text-xs py-1 px-2.5';
          indicator.innerHTML = '● Mode Offline (Data Lokal)';
        }
      }
      if (!isOnline) {
        Toast.warning('Koneksi terputus. Mode Offline aktif. Lagu yang diunduh tetap dapat diputar.', 'Mode Offline');
      } else {
        Toast.success('Koneksi internet terhubung kembali.', 'Kembali Online');
      }
    };

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
  }

  // --- PWA Installation Support ---
  _bindGlobalInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.pwaInstallPrompt = e;
      const installBtns = document.querySelectorAll('.pwa-install-trigger');
      installBtns.forEach(btn => btn.classList.remove('hidden'));
    });

    window.addEventListener('appinstalled', () => {
      this.pwaInstallPrompt = null;
      document.querySelectorAll('.pwa-install-trigger').forEach(btn => btn.classList.add('hidden'));
      Toast.success('AylusMusic berhasil diinstall ke perangkat Anda!', 'PWA Terpasang');
    });
  }

  triggerPwaInstall() {
    if (this.pwaInstallPrompt) {
      this.pwaInstallPrompt.prompt();
      this.pwaInstallPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          console.log('[PWA] User accepted installation prompt');
        }
        this.pwaInstallPrompt = null;
      });
      return;
    }

    // Check if on iOS Safari
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS) {
      BottomSheet.show({
        title: 'Install AylusMusic di iOS',
        contentHtml: `
          <div class="p-2 text-center text-sm">
            <p class="text-slate-300 mb-4 leading-relaxed">
              Untuk menginstall AylusMusic sebagai aplikasi di iPhone atau iPad Anda:
            </p>
            <ol class="text-left text-xs space-y-3 bg-slate-800/80 p-4 rounded-xl border border-slate-700/60 mb-5">
              <li class="flex items-start gap-2">
                <span class="font-bold text-cyan-400">1.</span>
                <span>Ketuk ikon <strong>Bagikan (Share)</strong> pada bilah bawah browser Safari.</span>
              </li>
              <li class="flex items-start gap-2">
                <span class="font-bold text-cyan-400">2.</span>
                <span>Gulir ke bawah lalu pilih <strong>"Tambah ke Layar Utama" (Add to Home Screen)</strong>.</span>
              </li>
              <li class="flex items-start gap-2">
                <span class="font-bold text-cyan-400">3.</span>
                <span>Ketuk <strong>Tambah</strong> di pojok kanan atas.</span>
              </li>
            </ol>
            <button id="close-ios-guide" class="btn btn-primary w-full text-xs py-2.5">Mengerti</button>
          </div>
        `,
        onOpen: () => {
          document.getElementById('close-ios-guide')?.addEventListener('click', () => {
            document.getElementById('bottom-sheet-overlay')?.classList.remove('active');
          });
        }
      });
    } else {
      Toast.info('Untuk menginstall, buka menu browser Anda (tiga titik di pojok atas) lalu pilih "Install aplikasi".', 'Install AylusMusic');
    }
  }

  // --- Views Navigation ---
  async renderHome() {
    this.currentView = 'home';
    const auth = authManager.getState();
    const playlists = await dbManager.getPlaylists();
    const history = await dbManager.getHistory(8);

    // Time-based greeting
    const hour = new Date().getHours();
    let greeting = 'Selamat Pagi';
    if (hour >= 11 && hour < 15) greeting = 'Selamat Siang';
    else if (hour >= 15 && hour < 18) greeting = 'Selamat Sore';
    else if (hour >= 18 || hour < 4) greeting = 'Selamat Malam';

    let historyHtml = '';
    if (history.length > 0) {
      historyHtml = `
        <section class="mb-8">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-bold text-white flex items-center gap-2">
              <svg class="w-5 h-5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              Baru Saja Diputar
            </h2>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            ${history.map(item => `
              <div class="track-row glass-panel glass-panel-hover" data-track-id="${item.track.id}">
                <img src="${item.track.coverUrl || '/assets/logo.png'}" alt="Cover" class="track-cover-sm" loading="lazy" />
                <div class="track-details">
                  <div class="track-title">${sanitize(item.track.title)}</div>
                  <div class="track-meta">${sanitize(item.track.artist)}</div>
                </div>
                <button class="icon-btn play-track-btn text-cyan-400" aria-label="Putar" data-track-id="${item.track.id}">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </button>
              </div>
            `).join('')}
          </div>
        </section>
      `;
    }

    let playlistsHtml = '';
    if (playlists.length > 0) {
      playlistsHtml = `
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          ${playlists.map(pl => `
            <div class="glass-panel glass-panel-hover p-3 rounded-2xl cursor-pointer playlist-card relative group flex flex-col justify-between" data-playlist-id="${pl.id}">
              <div>
                <div class="aspect-square w-full rounded-xl overflow-hidden mb-3 bg-slate-800 shadow-md relative">
                  <img src="${pl.coverUrl || '/assets/logo.png'}" alt="${sanitize(pl.name)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                  ${pl.isSpotify ? `<span class="badge badge-gold absolute top-2 right-2 text-[10px]">Spotify</span>` : ''}
                </div>
                <h3 class="font-bold text-sm text-white truncate">${sanitize(pl.name)}</h3>
                <p class="text-xs text-slate-400 mt-0.5 truncate">${pl.trackCount || 0} lagu</p>
              </div>
              <div class="mt-3 flex items-center justify-between">
                <span class="text-[11px] text-cyan-400 font-medium">Buka Playlist</span>
                <button class="icon-btn text-cyan-400 w-8 h-8 hover:bg-cyan-500/20" aria-label="Putar Playlist" data-play-playlist="${pl.id}">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    } else {
      playlistsHtml = `
        <div class="glass-panel p-8 text-center rounded-2xl">
          <p class="text-sm text-slate-300 mb-4">Belum ada playlist di pustaka Anda.</p>
          <button class="btn btn-primary text-xs" id="home-create-playlist-btn">Buat Playlist Pertama</button>
        </div>
      `;
    }

    this.mainContainer.innerHTML = `
      <div class="max-w-6xl mx-auto">
        <!-- Hero Header -->
        <header class="mb-8">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p class="text-xs font-semibold uppercase tracking-wider text-cyan-400 mb-1">${greeting}</p>
              <h1 class="text-2xl sm:text-3xl font-extrabold text-white">${sanitize(auth.userName)} 👋</h1>
            </div>
            <div class="flex items-center gap-2">
              <button id="quick-import-spotify-btn" class="btn btn-gold text-xs py-2 px-3.5">
                <svg class="w-4 h-4 mr-1" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                </svg>
                Impor Spotify
              </button>
              <button id="quick-add-local-btn" class="btn btn-secondary text-xs py-2 px-3.5">
                <svg class="w-4 h-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v16m8-8H4"/></svg>
                Musik Lokal
              </button>
            </div>
          </div>
        </header>

        <!-- Recently Played -->
        ${historyHtml}

        <!-- Playlists Collection -->
        <section class="mb-10">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-bold text-white flex items-center gap-2">
              <svg class="w-5 h-5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13M9 9l12-2M6 21a3 3 0 100-6 3 3 0 000 6zm12-2a3 3 0 100-6 3 3 0 000 6z"/></svg>
              Daftar Playlist Anda
            </h2>
            <button class="btn btn-outline text-xs py-1.5 px-3" id="home-view-library-btn">Lihat Semua</button>
          </div>
          ${playlistsHtml}
        </section>
      </div>
    `;

    // Bind event handlers
    document.getElementById('quick-import-spotify-btn')?.addEventListener('click', () => {
      this.showSpotifyImportModal();
    });

    document.getElementById('quick-add-local-btn')?.addEventListener('click', () => {
      this.promptAddLocalMusic();
    });

    document.getElementById('home-create-playlist-btn')?.addEventListener('click', () => {
      this.promptCreatePlaylist();
    });

    document.getElementById('home-view-library-btn')?.addEventListener('click', () => {
      router.navigate('/library');
    });

    // Playlist cards click
    this.mainContainer.querySelectorAll('.playlist-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button[data-play-playlist]')) return;
        const plId = card.getAttribute('data-playlist-id');
        if (plId) router.navigate(`/playlist/${plId}`);
      });
    });

    // Play playlist button click
    this.mainContainer.querySelectorAll('button[data-play-playlist]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const plId = btn.getAttribute('data-play-playlist');
        const tracks = await dbManager.getTracksByPlaylist(plId);
        if (tracks.length > 0) {
          player.playTrack(tracks[0], tracks);
        } else {
          Toast.info('Playlist ini masih kosong.');
        }
      });
    });

    // Individual track play button
    this.mainContainer.querySelectorAll('.play-track-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const trId = btn.getAttribute('data-track-id');
        const track = await dbManager.getTrack(trId);
        if (track) {
          player.playTrack(track);
        }
      });
    });
  }

  // --- Search View ---
  async renderSearch() {
    this.currentView = 'search';
    const allTracks = await dbManager.getAllTracks();
    const allPlaylists = await dbManager.getPlaylists();

    const q = this.searchQuery.toLowerCase().trim();

    let filteredTracks = allTracks;
    let filteredPlaylists = allPlaylists;

    if (q) {
      filteredTracks = allTracks.filter(t => 
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.artist && t.artist.toLowerCase().includes(q)) ||
        (t.album && t.album.toLowerCase().includes(q))
      );
      filteredPlaylists = allPlaylists.filter(p =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q))
      );
    }

    this.mainContainer.innerHTML = `
      <div class="max-w-4xl mx-auto">
        <header class="mb-6">
          <div class="flex items-center justify-between mb-4">
            <h1 class="text-2xl font-bold text-white">Cari Musik</h1>
            <span class="badge badge-cool text-xs py-1 px-2.5 flex items-center gap-1">
              <svg class="w-3 h-3 fill-current text-red-500" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
              Didukung YouTube Music
            </span>
          </div>

          <form id="search-form" class="relative">
            <input 
              type="search" 
              id="search-input" 
              value="${sanitize(this.searchQuery)}" 
              placeholder="Cari lagu, artis, atau judul musik apa saja..." 
              class="w-full pl-12 pr-28 py-3.5 rounded-2xl bg-slate-800/90 border border-slate-700 text-white text-base focus:border-cyan-400"
              autofocus
            />
            <svg class="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <button type="submit" id="search-online-btn" class="btn btn-primary absolute right-2 top-1/2 -translate-y-1/2 text-xs py-1.5 px-3 min-h-[36px]">
              Cari Online
            </button>
          </form>
        </header>

        <!-- Search Results List -->
        <div id="search-results-box">
          <!-- Section YouTube Music Online Results -->
          <div id="yt-search-section" class="mb-8 ${this.ytSearchResults?.length ? '' : 'hidden'}">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-xs font-bold uppercase tracking-wider text-red-400 flex items-center gap-1.5">
                <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                Hasil dari YouTube Music (Versi Penuh)
              </h3>
              <span class="text-[11px] text-slate-400">${this.ytSearchResults?.length || 0} lagu</span>
            </div>
            <div class="space-y-1" id="yt-search-list">
              ${(this.ytSearchResults || []).map(t => this._renderTrackRowHtml(t)).join('')}
            </div>
          </div>

          ${q ? `
            <div class="mb-6">
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400">Pustaka Lokal (${filteredTracks.length})</h3>
                ${filteredTracks.length === 0 ? `
                  <button type="button" id="trigger-yt-search-btn" class="text-xs text-cyan-400 hover:underline">
                    Cari "${sanitize(q)}" di YouTube Music →
                  </button>
                ` : ''}
              </div>
              ${filteredTracks.length > 0 ? `
                <div class="space-y-1">
                  ${filteredTracks.map(t => this._renderTrackRowHtml(t)).join('')}
                </div>
              ` : `
                <div class="glass-panel p-4 rounded-xl text-center">
                  <p class="text-sm text-slate-400 mb-3">Belum ada di pustaka lokal Anda.</p>
                  <button type="button" id="btn-search-yt-direct" class="btn btn-primary text-xs py-2 px-4" style="background: linear-gradient(135deg, #e11d48, #0fb5ae);">
                    Cari & Putar Langsung dari YouTube Music
                  </button>
                </div>
              `}
            </div>

            <div class="mb-6">
              <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Playlist (${filteredPlaylists.length})</h3>
              ${filteredPlaylists.length > 0 ? `
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  ${filteredPlaylists.map(pl => `
                    <div class="glass-panel p-3 rounded-xl cursor-pointer hover:border-cyan-400/50 transition" onclick="window.location.hash='#/playlist/${pl.id}'">
                      <div class="font-bold text-sm text-white truncate">${sanitize(pl.name)}</div>
                      <div class="text-xs text-slate-400">${pl.trackCount} lagu</div>
                    </div>
                  `).join('')}
                </div>
              ` : `
                <p class="text-sm text-slate-400 italic">Tidak ada playlist yang cocok.</p>
              `}
            </div>
          ` : `
            <div class="py-12 text-center text-slate-400 space-y-4">
              <div class="w-16 h-16 mx-auto rounded-full bg-slate-800/80 flex items-center justify-center text-red-400">
                <svg class="w-8 h-8 fill-current" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
              </div>
              <h2 class="text-base font-bold text-white">Semua Musik Tersedia di Sini</h2>
              <p class="text-xs max-w-sm mx-auto text-slate-400">Ketik lagu apa saja atau tempel judul artis untuk mendengarkan lagu versi penuh melalui integrasi YouTube Music.</p>
              <div class="flex flex-wrap justify-center gap-2 pt-2">
                <button type="button" class="btn btn-secondary text-xs py-1.5 px-3 quick-search-tag" data-tag="Nadin Amizah">Nadin Amizah</button>
                <button type="button" class="btn btn-secondary text-xs py-1.5 px-3 quick-search-tag" data-tag="Sheila on 7">Sheila on 7</button>
                <button type="button" class="btn btn-secondary text-xs py-1.5 px-3 quick-search-tag" data-tag="Taylor Swift">Taylor Swift</button>
                <button type="button" class="btn btn-secondary text-xs py-1.5 px-3 quick-search-tag" data-tag="Lofi Hip Hop Chill">Lofi Hip Hop Chill</button>
              </div>
            </div>
          `}
        </div>
      </div>
    `;

    const searchInput = document.getElementById('search-input');
    const searchForm = document.getElementById('search-form');

    const executeOnlineSearch = async (query) => {
      if (!query) return;
      const onlineBtn = document.getElementById('search-online-btn');
      if (onlineBtn) onlineBtn.textContent = 'Mencari...';
      Toast.info(`Mencari "${query}" di YouTube Music...`, 'YouTube Music');

      try {
        const searchFn = typeof youtubeService.searchYouTube === 'function' 
          ? youtubeService.searchYouTube.bind(youtubeService) 
          : youtubeService.search.bind(youtubeService);
        const results = await searchFn(query);
        this.ytSearchResults = results;
        if (results.length > 0) {
          Toast.success(`Ditemukan ${results.length} lagu di YouTube Music!`, 'YouTube Music');
        } else {
          Toast.warning('Tidak ditemukan lagu di YouTube Music untuk kata kunci ini.');
        }
        this.renderSearch();
      } catch (err) {
        console.error('Search YT error:', err);
        Toast.error('Gagal mencari di YouTube Music. Coba lagi beberapa saat.', 'Kendala Jaringan');
      } finally {
        if (onlineBtn) onlineBtn.textContent = 'Cari Online';
      }
    };

    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      // Do local filter
      const qVal = this.searchQuery.toLowerCase().trim();
      if (!qVal) {
        this.ytSearchResults = [];
      }
    });

    searchForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      executeOnlineSearch(this.searchQuery.trim());
    });

    document.getElementById('btn-search-yt-direct')?.addEventListener('click', () => {
      executeOnlineSearch(this.searchQuery.trim());
    });

    document.getElementById('trigger-yt-search-btn')?.addEventListener('click', () => {
      executeOnlineSearch(this.searchQuery.trim());
    });

    document.querySelectorAll('.quick-search-tag').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tag = e.currentTarget.getAttribute('data-tag');
        this.searchQuery = tag;
        executeOnlineSearch(tag);
      });
    });

    this._bindTrackRowActions();
  }

  // --- Library View ---
  async renderLibrary() {
    this.currentView = 'library';
    const playlists = await dbManager.getPlaylists();
    const favorites = await dbManager.getFavorites();
    const allTracks = await dbManager.getAllTracks();
    const offlineTracks = allTracks.filter(t => t.offline);

    this.mainContainer.innerHTML = `
      <div class="max-w-6xl mx-auto">
        <header class="flex items-center justify-between mb-6">
          <div>
            <h1 class="text-2xl sm:text-3xl font-extrabold text-white">Pustaka Saya</h1>
            <p class="text-xs text-slate-400 mt-1">${playlists.length} playlist · ${allTracks.length} total lagu</p>
          </div>
          <div class="flex items-center gap-2">
            <button id="create-new-pl-btn" class="btn btn-primary text-xs py-2 px-3.5">
              <svg class="w-4 h-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v16m8-8H4"/></svg>
              Playlist Baru
            </button>
            <button id="import-spotify-lib-btn" class="btn btn-gold text-xs py-2 px-3.5">
              Impor Spotify
            </button>
          </div>
        </header>

        <!-- Quick Tabs / Folders -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <!-- Liked Songs Banner Card -->
          <div class="glass-panel p-5 rounded-2xl cursor-pointer hover:border-pink-500/50 transition relative overflow-hidden bg-gradient-to-r from-pink-900/30 via-purple-900/20 to-slate-900/50" id="open-favorites-card">
            <div class="flex items-center gap-4">
              <div class="w-14 h-14 rounded-xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center text-white shadow-lg">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
              </div>
              <div>
                <h3 class="text-lg font-bold text-white">Lagu Disukai</h3>
                <p class="text-xs text-slate-300 mt-0.5">${favorites.length} lagu favorit</p>
              </div>
            </div>
          </div>

          <!-- Offline / Downloaded Tracks Card -->
          <div class="glass-panel p-5 rounded-2xl cursor-pointer hover:border-emerald-500/50 transition relative overflow-hidden bg-gradient-to-r from-emerald-900/30 via-teal-900/20 to-slate-900/50" id="open-offline-card">
            <div class="flex items-center gap-4">
              <div class="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-lg">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              </div>
              <div>
                <h3 class="text-lg font-bold text-white">Tersedia Offline</h3>
                <p class="text-xs text-slate-300 mt-0.5">${offlineTracks.length} lagu diunduh</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Playlists Grid -->
        <h2 class="text-lg font-bold text-white mb-4">Semua Playlist</h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          ${playlists.map(pl => `
            <div class="glass-panel glass-panel-hover p-3 rounded-2xl cursor-pointer playlist-card relative group flex flex-col justify-between" data-playlist-id="${pl.id}">
              <div>
                <div class="aspect-square w-full rounded-xl overflow-hidden mb-3 bg-slate-800 shadow-md relative">
                  <img src="${pl.coverUrl || '/assets/logo.png'}" alt="${sanitize(pl.name)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                  ${pl.isSpotify ? `<span class="badge badge-gold absolute top-2 right-2 text-[10px]">Spotify</span>` : ''}
                </div>
                <h3 class="font-bold text-sm text-white truncate">${sanitize(pl.name)}</h3>
                <p class="text-xs text-slate-400 mt-0.5 truncate">${pl.trackCount || 0} lagu</p>
              </div>
              <div class="mt-3 flex items-center justify-between">
                <span class="text-[11px] text-cyan-400 font-medium">Buka</span>
                <button class="icon-btn text-slate-400 hover:text-white w-7 h-7" data-delete-playlist="${pl.id}" title="Hapus Playlist">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    document.getElementById('create-new-pl-btn')?.addEventListener('click', () => {
      this.promptCreatePlaylist();
    });

    document.getElementById('import-spotify-lib-btn')?.addEventListener('click', () => {
      this.showSpotifyImportModal();
    });

    document.getElementById('open-favorites-card')?.addEventListener('click', () => {
      this.renderSpecialPlaylistView('favorites', 'Lagu Disukai', favorites);
    });

    document.getElementById('open-offline-card')?.addEventListener('click', () => {
      this.renderSpecialPlaylistView('offline', 'Lagu Offline (Diunduh)', offlineTracks);
    });

    this.mainContainer.querySelectorAll('.playlist-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button[data-delete-playlist]')) return;
        const plId = card.getAttribute('data-playlist-id');
        if (plId) router.navigate(`/playlist/${plId}`);
      });
    });

    this.mainContainer.querySelectorAll('button[data-delete-playlist]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const plId = btn.getAttribute('data-delete-playlist');
        const deleted = await libraryManager.deletePlaylist(plId);
        if (deleted) this.renderLibrary();
      });
    });
  }

  // --- Playlist Detail View ---
  async renderPlaylistDetail(playlistId) {
    this.currentView = 'playlist';
    this.activePlaylistId = playlistId;

    const playlist = await dbManager.getPlaylist(playlistId);
    if (!playlist) {
      Toast.error('Playlist tidak ditemukan.');
      router.navigate('/library');
      return;
    }

    const tracks = await dbManager.getTracksByPlaylist(playlistId);
    const totalDurationSecs = tracks.reduce((acc, t) => acc + (t.duration || 0), 0);

    this.mainContainer.innerHTML = `
      <div class="max-w-5xl mx-auto">
        <!-- Back Button -->
        <button class="btn btn-secondary text-xs py-1.5 px-3 mb-6" id="back-to-library-btn">
          <svg class="w-4 h-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
          Kembali ke Pustaka
        </button>

        <!-- Playlist Header Info -->
        <div class="flex flex-col sm:flex-row items-center sm:items-start gap-6 mb-8 glass-panel p-6 rounded-2xl">
          <div class="w-40 h-40 sm:w-48 sm:h-48 rounded-xl overflow-hidden shadow-2xl flex-shrink-0 bg-slate-800">
            <img src="${playlist.coverUrl || '/assets/logo.png'}" alt="${sanitize(playlist.name)}" class="w-full h-full object-cover" />
          </div>
          <div class="flex-1 text-center sm:text-left min-w-0">
            <div class="flex items-center justify-center sm:justify-start gap-2 mb-1">
              <span class="badge badge-tosca text-[11px]">PLAYLIST</span>
              ${playlist.isSpotify ? `<span class="badge badge-gold text-[11px]">SPOTIFY IMPORT</span>` : ''}
            </div>
            <h1 class="text-2xl sm:text-4xl font-extrabold text-white truncate">${sanitize(playlist.name)}</h1>
            <p class="text-xs sm:text-sm text-slate-300 mt-2 line-clamp-2">${sanitize(playlist.description || 'Playlist buatan sendiri')}</p>
            <div class="text-xs text-slate-400 mt-3 flex items-center justify-center sm:justify-start gap-3">
              <span>${tracks.length} lagu</span>
              <span>·</span>
              <span>${formatTime(totalDurationSecs)} total durasi</span>
            </div>

            <!-- Action Buttons -->
            <div class="flex flex-wrap items-center justify-center sm:justify-start gap-3 mt-5">
              <button class="btn btn-primary text-xs py-2 px-5" id="pl-play-all-btn">
                <svg class="w-4 h-4 mr-1" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Putar Semua
              </button>
              <button class="btn btn-secondary text-xs py-2 px-4" id="pl-shuffle-btn">
                <svg class="w-4 h-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>
                Acak
              </button>
              <button class="btn btn-secondary text-xs py-2 px-3.5" id="pl-add-local-btn">
                <svg class="w-4 h-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v16m8-8H4"/></svg>
                Tautkan Audio Lokal
              </button>
              <button class="btn btn-danger text-xs py-2 px-3" id="pl-delete-btn" title="Hapus Playlist">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Tracks List -->
        <section class="space-y-1" id="playlist-tracks-container">
          ${tracks.length > 0 ? tracks.map((t, idx) => this._renderTrackRowHtml(t, idx + 1)).join('') : `
            <div class="text-center py-12 glass-panel rounded-2xl">
              <p class="text-sm text-slate-300 mb-3">Belum ada lagu di dalam playlist ini.</p>
              <button class="btn btn-primary text-xs" id="empty-add-local-btn">Tambah File Musik Lokal</button>
            </div>
          `}
        </section>
      </div>
    `;

    document.getElementById('back-to-library-btn')?.addEventListener('click', () => router.navigate('/library'));
    
    document.getElementById('pl-play-all-btn')?.addEventListener('click', () => {
      if (tracks.length > 0) player.playTrack(tracks[0], tracks);
    });

    document.getElementById('pl-shuffle-btn')?.addEventListener('click', () => {
      if (tracks.length > 0) {
        if (!player.isShuffled) player.toggleShuffle();
        player.playTrack(tracks[0], tracks);
      }
    });

    document.getElementById('pl-add-local-btn')?.addEventListener('click', () => {
      this.promptAddLocalMusic(playlistId);
    });

    document.getElementById('empty-add-local-btn')?.addEventListener('click', () => {
      this.promptAddLocalMusic(playlistId);
    });

    document.getElementById('pl-delete-btn')?.addEventListener('click', async () => {
      const deleted = await libraryManager.deletePlaylist(playlistId);
      if (deleted) router.navigate('/library');
    });

    this._bindTrackRowActions();
  }

  // --- Special Playlist View (Favorites / Offline) ---
  renderSpecialPlaylistView(type, title, tracks) {
    this.mainContainer.innerHTML = `
      <div class="max-w-5xl mx-auto">
        <button class="btn btn-secondary text-xs py-1.5 px-3 mb-6" id="back-to-library-btn">
          <svg class="w-4 h-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
          Kembali ke Pustaka
        </button>

        <header class="glass-panel p-6 rounded-2xl mb-8 flex items-center justify-between">
          <div>
            <h1 class="text-2xl sm:text-3xl font-extrabold text-white">${sanitize(title)}</h1>
            <p class="text-xs text-slate-300 mt-1">${tracks.length} lagu tersedia</p>
          </div>
          <div class="flex items-center gap-2">
            <button class="btn btn-primary text-xs py-2 px-4" id="special-play-all-btn">Putar Semua</button>
          </div>
        </header>

        <div class="space-y-1">
          ${tracks.length > 0 ? tracks.map((t, idx) => this._renderTrackRowHtml(t, idx + 1)).join('') : `
            <div class="glass-panel p-10 text-center rounded-2xl text-slate-400 text-sm">
              Belum ada lagu di daftar ini.
            </div>
          `}
        </div>
      </div>
    `;

    document.getElementById('back-to-library-btn')?.addEventListener('click', () => router.navigate('/library'));
    document.getElementById('special-play-all-btn')?.addEventListener('click', () => {
      if (tracks.length > 0) player.playTrack(tracks[0], tracks);
    });

    this._bindTrackRowActions();
  }

  // --- Profile View ---
  async renderProfile() {
    this.currentView = 'profile';
    const auth = authManager.getState();
    const stats = await dbManager.getStats();

    this.mainContainer.innerHTML = `
      <div class="max-w-3xl mx-auto">
        <h1 class="text-2xl sm:text-3xl font-extrabold text-white mb-6">Profil Pengguna</h1>

        <!-- User Card -->
        <div class="glass-panel p-6 rounded-2xl mb-8 flex flex-col sm:flex-row items-center gap-6">
          <div class="w-20 h-20 rounded-full overflow-hidden bg-cyan-900 border-2 border-cyan-400 flex items-center justify-center text-white shadow-xl flex-shrink-0">
            <img src="${auth.avatarUrl || '/assets/logo.png'}" alt="Avatar" class="w-full h-full object-cover" />
          </div>
          <div class="flex-1 text-center sm:text-left min-w-0">
            <div class="flex items-center justify-center sm:justify-start gap-2 mb-1">
              <span class="badge ${auth.isGoogle ? 'badge-gold' : 'badge-guest'} text-xs">
                ${auth.isGoogle ? 'AKUN GOOGLE' : 'MODE TAMU (GUEST)'}
              </span>
            </div>
            <h2 class="text-xl font-bold text-white truncate">${sanitize(auth.userName)}</h2>
            <p class="text-xs text-slate-300 mt-0.5 truncate">${auth.email || 'Data tersimpan hanya di perangkat ini'}</p>

            <div class="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-4">
              ${auth.isGuest ? `
                <button id="profile-upgrade-btn" class="btn btn-gold text-xs py-2 px-4">
                  Masuk dengan Google (Sinkronisasi Cloud)
                </button>
              ` : `
                <button id="profile-signout-btn" class="btn btn-secondary text-xs py-2 px-4">
                  Keluar Akun
                </button>
              `}
              <button id="profile-edit-name-btn" class="btn btn-secondary text-xs py-2 px-3">
                Ubah Nama
              </button>
            </div>
          </div>
        </div>

        <!-- Listening Statistics (Unlocked for Google, Locked preview for Guest) -->
        <section class="mb-8">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-bold text-white flex items-center gap-2">
              <svg class="w-5 h-5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20V10M18 20V4M6 20v-4"/></svg>
              Statistik Mendengarkan Musik
            </h2>
            ${auth.isGuest ? `<span class="badge badge-guest text-[11px]"><svg class="w-3 h-3 inline mr-1" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>Terkunci untuk Tamu</span>` : ''}
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <div class="glass-panel p-4 rounded-xl text-center">
              <div class="text-2xl font-extrabold text-cyan-400 tabular-nums">${stats.totalPlays}</div>
              <div class="text-xs text-slate-400 mt-1">Total Lagu Diputar</div>
            </div>
            <div class="glass-panel p-4 rounded-xl text-center">
              <div class="text-2xl font-extrabold text-amber-400 tabular-nums">${stats.totalHours}</div>
              <div class="text-xs text-slate-400 mt-1">Estimasi Jam Mendengar</div>
            </div>
            <div class="glass-panel p-4 rounded-xl text-center col-span-2 sm:col-span-1">
              <div class="text-2xl font-extrabold text-emerald-400 tabular-nums">${stats.totalTracks}</div>
              <div class="text-xs text-slate-400 mt-1">Koleksi Lagu Pustaka</div>
            </div>
          </div>

          <!-- Top Artists -->
          ${stats.topArtists.length > 0 ? `
            <div class="glass-panel p-4 rounded-xl">
              <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Artis Paling Sering Diputar</h4>
              <div class="space-y-2">
                ${stats.topArtists.map((a, i) => `
                  <div class="flex items-center justify-between text-xs">
                    <span class="text-white font-medium">${i + 1}. ${sanitize(a.name)}</span>
                    <span class="text-slate-400">${a.count} kali diputar</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </section>

        <!-- Backup & Restore -->
        <section class="glass-panel p-5 rounded-2xl mb-8">
          <h3 class="text-sm font-bold text-white mb-2">Cadangan & Pemulihan Data (JSON Backup)</h3>
          <p class="text-xs text-slate-300 mb-4 leading-relaxed">
            Ekspor seluruh metadata playlist dan lagu Anda ke file JSON aman, atau pulihkan data dari file cadangan sebelumnya.
          </p>
          <div class="flex flex-wrap gap-2">
            <button id="export-backup-btn" class="btn btn-secondary text-xs py-2 px-3.5">
              Ekspor Cadangan (JSON)
            </button>
            <label class="btn btn-secondary text-xs py-2 px-3.5 cursor-pointer">
              Impor Cadangan (JSON)
              <input type="file" id="import-backup-input" accept=".json" class="hidden" />
            </label>
          </div>
        </section>
      </div>
    `;

    document.getElementById('profile-upgrade-btn')?.addEventListener('click', () => {
      authManager.signInWithGoogle();
    });

    document.getElementById('profile-signout-btn')?.addEventListener('click', () => {
      authManager.signOut();
    });

    document.getElementById('profile-edit-name-btn')?.addEventListener('click', async () => {
      const newName = window.prompt ? window.prompt('Masukkan nama panggilan baru:', auth.userName) : null;
      if (newName && newName.trim().length >= 2) {
        authManager.setUserName(newName.trim());
        Toast.success('Nama panggilan diperbarui.');
        this.renderProfile();
      }
    });

    document.getElementById('export-backup-btn')?.addEventListener('click', async () => {
      const backupData = await dbManager.exportBackup();
      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aylusmusic-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      Toast.success('File cadangan berhasil diunduh.', 'Ekspor Selesai');
    });

    document.getElementById('import-backup-input')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await dbManager.importBackup(data);
        Toast.success('Data pustaka berhasil dipulihkan dari file JSON!', 'Pemulihan Berhasil');
        this.renderProfile();
      } catch (err) {
        Toast.error(err.message || 'File cadangan rusak atau format tidak cocok.', 'Gagal Impor');
      }
    });
  }

  // --- Settings View ---
  async renderSettings() {
    this.currentView = 'settings';
    const storageInfo = await storageManager.getStorageUsage();
    const currentTheme = settingsManager.theme;
    const clientId = getSpotifyClientId();

    this.mainContainer.innerHTML = `
      <div class="max-w-3xl mx-auto">
        <h1 class="text-2xl sm:text-3xl font-extrabold text-white mb-6">Pengaturan</h1>

        <!-- Theme Setting -->
        <section class="glass-panel p-5 rounded-2xl mb-6">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-sm font-bold text-white">Tema Tampilan</h3>
              <p class="text-xs text-slate-300 mt-0.5">Pilih tema Gelap (default) atau Terang</p>
            </div>
            <button id="toggle-theme-btn" class="btn btn-secondary text-xs py-2 px-3.5">
              ${currentTheme === 'dark' ? '☀️ Ganti ke Tema Terang' : '🌙 Ganti ke Tema Gelap'}
            </button>
          </div>
        </section>

        <!-- Storage Management -->
        <section class="glass-panel p-5 rounded-2xl mb-6">
          <h3 class="text-sm font-bold text-white mb-2">Kapasitas Penyimpanan & Cache Offline</h3>
          <p class="text-xs text-slate-300 mb-4 leading-relaxed">
            AylusMusic hanya menyimpan file audio untuk lagu yang Anda tandai offline, menjaga ruang HP tetap lega.
          </p>

          <div class="bg-slate-800/80 p-4 rounded-xl border border-slate-700/60 mb-4">
            <div class="flex items-center justify-between text-xs mb-2">
              <span class="text-slate-300">Penggunaan Kuota:</span>
              <span class="font-bold text-cyan-400">${storageInfo.usageFormatted} dari ${storageInfo.limitFormatted}</span>
            </div>
            <div class="w-full h-2.5 bg-slate-700 rounded-full overflow-hidden">
              <div class="h-full bg-gradient-to-r from-cyan-400 to-amber-400 rounded-full" style="width: ${storageInfo.quotaUsedPercent}%"></div>
            </div>
            <div class="flex items-center justify-between text-[11px] text-slate-400 mt-3">
              <span>Lagu Offline: ${storageInfo.offlineTracksCount}</span>
              <span>Total Pustaka: ${storageInfo.totalTracks} lagu</span>
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
            <button id="clear-offline-cache-btn" class="btn btn-danger text-xs py-2 px-3.5">
              Bersihkan Seluruh Cache Audio
            </button>
          </div>
        </section>

        <!-- Spotify Developer Config -->
        <section class="glass-panel p-5 rounded-2xl mb-6">
          <h3 class="text-sm font-bold text-white mb-2">Konfigurasi Spotify Developer (PKCE)</h3>
          <p class="text-xs text-slate-300 mb-4 leading-relaxed">
            Dibutuhkan saat Anda ingin login langsung ke akun Spotify via Spotify Web API.
          </p>
          <div class="space-y-3">
            <div>
              <label class="text-xs font-semibold text-slate-300 block mb-1">Spotify Client ID</label>
              <input type="text" id="spotify-client-id-input" value="${sanitize(clientId)}" class="w-full text-xs font-mono" placeholder="Masukkan 32 digit Client ID Spotify" />
            </div>
            <div>
              <label class="text-xs font-semibold text-slate-300 block mb-1">Redirect URI yang harus didaftarkan di Spotify Dashboard</label>
              <div class="flex gap-2">
                <input type="text" readonly value="${sanitize(getRedirectUri())}" class="w-full text-xs font-mono bg-slate-900 text-slate-400" />
                <button id="copy-redirect-uri-btn" class="btn btn-secondary text-xs px-3">Salin</button>
              </div>
            </div>
          </div>
        </section>

        <!-- Repeat Onboarding & App Info -->
        <section class="glass-panel p-5 rounded-2xl mb-8">
          <h3 class="text-sm font-bold text-white mb-2">Informasi & Bantuan</h3>
          <div class="text-xs text-slate-300 space-y-2 mb-4 leading-relaxed">
            <p><strong>AylusMusic v1.0.0</strong> — Pemutar musik PWA modern & hemat penyimpanan.</p>
            <p>
              <strong>Catatan Batasan Teknis & Hukum:</strong><br/>
              • Spotify Web API hanya memberikan akses metadata dan struktur playlist. Sesuai ToS resmi Spotify, pemutaran audio Spotify hanya diperbolehkan melalui aplikasi Spotify.<br/>
              • Untuk memutar musik di AylusMusic, Anda dapat menautkan file MP3/M4A lokal milik Anda atau mencari sumber lagu berlisensi Creative Commons.<br/>
              • Pemutaran latar belakang di iOS Safari memiliki batasan daya sistem. Untuk performa terbaik, install aplikasi ini ke Layar Utama (Home Screen).
            </p>
          </div>
          <button id="repeat-onboarding-btn" class="btn btn-secondary text-xs py-2 px-3.5">
            Ulangi Pengenalan Awal (Onboarding)
          </button>
        </section>
      </div>
    `;

    document.getElementById('toggle-theme-btn')?.addEventListener('click', () => {
      settingsManager.toggleTheme();
      this.renderSettings();
    });

    document.getElementById('clear-offline-cache-btn')?.addEventListener('click', async () => {
      const confirm = await Dialog.confirm({
        title: 'Bersihkan Cache Audio?',
        message: 'Semua file audio yang diunduh untuk pemutaran offline akan dihapus. Metadata playlist tetap aman.',
        confirmText: 'Bersihkan',
        cancelText: 'Batal',
        isDanger: true
      });
      if (confirm) {
        await storageManager.clearAllOfflineAudio();
        this.renderSettings();
      }
    });

    document.getElementById('copy-redirect-uri-btn')?.addEventListener('click', () => {
      navigator.clipboard?.writeText(getRedirectUri());
      Toast.success('Redirect URI disalin ke clipboard!');
    });

    document.getElementById('spotify-client-id-input')?.addEventListener('change', (e) => {
      setSpotifyClientId(e.target.value);
      Toast.success('Spotify Client ID disimpan.');
    });

    document.getElementById('repeat-onboarding-btn')?.addEventListener('click', async () => {
      const confirm = await Dialog.confirm({
        title: 'Ulangi Pengenalan?',
        message: 'Anda akan dialihkan ke layar sambutan dan pengenalan awal aplikasi.',
        confirmText: 'Mulai Ulang',
        cancelText: 'Batal'
      });
      if (confirm) settingsManager.resetOnboarding();
    });
  }

  // --- Track Row Renderer & Event Bindings ---
  _renderTrackRowHtml(track, index = null) {
    const isPlayingThis = player.currentTrack?.id === track.id;
    let badgeHtml = '';
    if (track.offline) {
      badgeHtml = `<span class="badge badge-offline text-[10px]">Offline</span>`;
    } else if (track.hasAudio) {
      badgeHtml = `<span class="badge badge-cool text-[10px]">${track.audioType === 'local' ? 'Lokal' : 'Stream'}</span>`;
    } else {
      badgeHtml = `<span class="badge badge-gold text-[10px]">Hanya Metadata</span>`;
    }

    return `
      <div class="track-row ${isPlayingThis ? 'active' : ''}" data-track-id="${track.id}">
        ${index !== null ? `<span class="w-6 text-center text-xs font-mono text-slate-400 flex-shrink-0">${index}</span>` : ''}
        <img src="${track.coverUrl || '/assets/logo.png'}" alt="Cover" class="track-cover-sm" loading="lazy" />
        <div class="track-details">
          <div class="track-title">${sanitize(track.title)}</div>
          <div class="track-meta">
            <span>${sanitize(track.artist)}</span>
            ${track.album ? `<span>·</span><span>${sanitize(track.album)}</span>` : ''}
          </div>
        </div>
        <div class="track-actions">
          ${badgeHtml}
          <span class="text-xs font-mono text-slate-400 px-2">${formatTime(track.duration || 180)}</span>
          <button class="icon-btn track-like-btn w-8 h-8 text-slate-400 hover:text-pink-400" data-like-id="${track.id}" aria-label="Suka">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          </button>
          <button class="icon-btn track-menu-btn w-8 h-8 text-slate-400 hover:text-white" data-menu-id="${track.id}" aria-label="Opsi">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
          </button>
        </div>
      </div>
    `;
  }

  _bindTrackRowActions() {
    this.mainContainer.querySelectorAll('.track-row').forEach(row => {
      row.addEventListener('click', async (e) => {
        if (e.target.closest('button')) return;
        const trackId = row.getAttribute('data-track-id');
        let track = await dbManager.getTrack(trackId);
        if (!track && this.ytSearchResults) {
          track = this.ytSearchResults.find(t => t.id === trackId);
          if (track) {
            await dbManager.saveTrack(track);
          }
        }
        if (track) player.playTrack(track);
      });
    });

    this.mainContainer.querySelectorAll('.track-like-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const trId = btn.getAttribute('data-like-id');
        let track = await dbManager.getTrack(trId);
        if (!track && this.ytSearchResults) {
          track = this.ytSearchResults.find(t => t.id === trId);
          if (track) await dbManager.saveTrack(track);
        }
        if (track) {
          const isFav = await dbManager.toggleFavorite(track);
          btn.classList.toggle('text-pink-500', isFav);
          Toast.info(isFav ? `"${track.title}" ditambahkan ke Lagu Disukai.` : `Dihapus dari Lagu Disukai.`);
        }
      });
    });

    this.mainContainer.querySelectorAll('.track-menu-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const trId = btn.getAttribute('data-menu-id');
        let track = await dbManager.getTrack(trId);
        if (!track && this.ytSearchResults) {
          track = this.ytSearchResults.find(t => t.id === trId);
          if (track) await dbManager.saveTrack(track);
        }
        if (track) this.showTrackContextMenu(track);
      });
    });
  }

  // --- Context Menu for Track ---
  showTrackContextMenu(track) {
    const isGoogle = authManager.getState().isGoogle;

    BottomSheet.show({
      title: track.title,
      contentHtml: `
        <div class="text-xs text-slate-400 mb-4">${sanitize(track.artist)} · ${sanitize(track.album || '')}</div>
        <div class="space-y-1">
          <button id="ctx-play-now" class="btn btn-secondary w-full justify-start text-xs py-2.5">
            <svg class="w-4 h-4 mr-2 text-cyan-400" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Putar Sekarang
          </button>
          <button id="ctx-play-next" class="btn btn-secondary w-full justify-start text-xs py-2.5">
            <svg class="w-4 h-4 mr-2 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 4h4v16H5zm10 0h4v16h-4z"/></svg>
            Putar Berikutnya
          </button>
          <button id="ctx-download-offline" class="btn btn-secondary w-full justify-start text-xs py-2.5">
            <svg class="w-4 h-4 mr-2 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            ${track.offline ? 'Hapus dari Unduhan Offline' : 'Unduh untuk Diputar Offline'}
          </button>
          ${!track.hasAudio ? `
            <button id="ctx-resolve-audio" class="btn btn-gold w-full justify-start text-xs py-2.5">
              <svg class="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              Cari & Tautkan Sumber Audio
            </button>
          ` : ''}
          <button id="ctx-delete-track" class="btn btn-danger w-full justify-start text-xs py-2.5">
            <svg class="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>
            Hapus Lagu dari Playlist
          </button>
        </div>
      `,
      onOpen: () => {
        const close = () => document.getElementById('bottom-sheet-overlay')?.classList.remove('active');

        document.getElementById('ctx-play-now')?.addEventListener('click', () => {
          player.playTrack(track);
          close();
        });

        document.getElementById('ctx-play-next')?.addEventListener('click', () => {
          player.queue.splice(player.queueIndex + 1, 0, track);
          Toast.info(`"${track.title}" akan diputar berikutnya.`);
          close();
        });

        document.getElementById('ctx-download-offline')?.addEventListener('click', async () => {
          close();
          if (track.offline) {
            await storageManager.removeTrackOffline(track);
          } else {
            await storageManager.downloadTrackForOffline(track, !isGoogle);
          }
          if (this.currentView === 'playlist' && this.activePlaylistId) {
            this.renderPlaylistDetail(this.activePlaylistId);
          }
        });

        document.getElementById('ctx-resolve-audio')?.addEventListener('click', () => {
          close();
          this.showAudioResolverModal(track);
        });

        document.getElementById('ctx-delete-track')?.addEventListener('click', async () => {
          close();
          await libraryManager.removeTrack(track.id, track.playlistId);
          if (this.currentView === 'playlist' && this.activePlaylistId) {
            this.renderPlaylistDetail(this.activePlaylistId);
          }
        });
      }
    });
  }

  // --- Universal Music Import Modal (YouTube Music & Spotify) ---
  showSpotifyImportModal() {
    BottomSheet.show({
      title: 'Impor Playlist & Musik',
      contentHtml: `
        <div class="space-y-4 text-xs">
          <!-- 4 Methods Selector -->
          <div class="flex items-center gap-1 p-1 bg-slate-800 rounded-xl overflow-x-auto">
            <button class="flex-1 py-2 px-2 font-semibold text-center rounded-lg bg-red-600 text-white whitespace-nowrap" id="tab-import-yt">
              <span class="flex items-center justify-center gap-1">
                <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                YouTube Music
              </span>
            </button>
            <button class="flex-1 py-2 px-2 font-semibold text-center rounded-lg text-slate-300 hover:text-white whitespace-nowrap" id="tab-import-link">Spotify Link</button>
            <button class="flex-1 py-2 px-2 font-semibold text-center rounded-lg text-slate-300 hover:text-white whitespace-nowrap" id="tab-import-csv">Unggah CSV</button>
            <button class="flex-1 py-2 px-2 font-semibold text-center rounded-lg text-slate-300 hover:text-white whitespace-nowrap" id="tab-import-oauth">Login Spotify</button>
          </div>

          <!-- Section 0: YouTube Music (Default) -->
          <div id="section-import-yt" class="space-y-3">
            <p class="text-slate-300 leading-relaxed">
              Tempel link playlist atau video dari <strong>YouTube Music</strong> / <strong>YouTube</strong> untuk memutar <strong>lagu versi penuh (3-5+ menit)</strong> tanpa terpotong:
            </p>
            <input type="url" id="yt-link-input" placeholder="https://music.youtube.com/playlist?list=... atau youtube.com/watch?v=..." class="w-full text-xs" />
            
            <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
              <span class="text-slate-500">Coba contoh:</span>
              <button type="button" class="btn btn-secondary text-[10px] py-1 px-2.5 sample-yt-btn" data-url="https://music.youtube.com/playlist?list=PL4fGSIvJgcbrqX3vW7jJ0kG0y_vI9n71f">
                Pop Indonesia
              </button>
              <button type="button" class="btn btn-secondary text-[10px] py-1 px-2.5 sample-yt-btn" data-url="https://www.youtube.com/playlist?list=PLDcnymzs18LWrKzHmzrAM8JzLBzHi36HG">
                Akustik Santai
              </button>
              <button type="button" class="btn btn-secondary text-[10px] py-1 px-2.5 sample-yt-btn" data-url="https://www.youtube.com/watch?v=5qap5aO4i9A">
                Lofi Girl Chill
              </button>
            </div>

            <button id="submit-import-yt-btn" class="btn btn-primary w-full text-xs py-2.5 flex items-center justify-center gap-2" style="background: linear-gradient(135deg, #e11d48, #0fb5ae);">
              <span id="import-yt-btn-text">Impor Playlist YouTube Music (Versi Penuh)</span>
              <div id="import-yt-btn-spinner" class="hidden w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            </button>
          </div>

          <!-- Section 1: Paste Link Spotify -->
          <div id="section-import-link" class="space-y-3 hidden">
            <p class="text-slate-300 leading-relaxed">
              Salin dan tempel link playlist, album, atau lagu dari Spotify:
            </p>
            <input type="url" id="spotify-link-input" placeholder="https://open.spotify.com/playlist/..." class="w-full text-xs" />
            
            <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
              <span class="text-slate-500">Coba contoh:</span>
              <button type="button" class="btn btn-secondary text-[10px] py-1 px-2.5 sample-spotify-btn" data-url="https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M">
                Top Hits (50 Lagu)
              </button>
              <button type="button" class="btn btn-secondary text-[10px] py-1 px-2.5 sample-spotify-btn" data-url="https://open.spotify.com/playlist/37i9dQZF1DX4t95P994uQf">
                Lofi Chill
              </button>
            </div>

            <button id="submit-import-link-btn" class="btn btn-primary w-full text-xs py-2.5 flex items-center justify-center gap-2">
              <span id="import-btn-text">Impor dari Link Spotify</span>
              <div id="import-btn-spinner" class="hidden w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            </button>
          </div>

          <!-- Section 2: CSV Exportify -->
          <div id="section-import-csv" class="space-y-3 hidden">
            <p class="text-slate-300 leading-relaxed">
              Punya file cadangan CSV dari Exportify (exportify.net)? Unggah di sini untuk mengimpor seluruh judul, artis, dan urutan lagu tanpa batas:
            </p>
            <input type="file" id="spotify-csv-input" accept=".csv" class="w-full text-xs" />
            <button id="submit-import-csv-btn" class="btn btn-primary w-full text-xs py-2.5">
              Proses File CSV
            </button>
          </div>

          <!-- Section 3: Direct Spotify PKCE -->
          <div id="section-import-oauth" class="space-y-3 hidden">
            <p class="text-slate-300 leading-relaxed">
              Login langsung ke akun Spotify menggunakan Spotify Authorization Code dengan PKCE (aman di browser tanpa client secret).
            </p>
            <button id="submit-import-oauth-btn" class="btn btn-gold w-full text-xs py-2.5">
              Hubungkan Akun Spotify
            </button>
          </div>

          <div class="p-3 bg-slate-800/80 rounded-xl text-[11px] text-slate-300 border border-slate-700/60 leading-relaxed">
            <span class="text-emerald-400 font-bold">Fitur Baru:</span> AylusMusic kini otomatis menyambungkan lagu Spotify ke YouTube Music saat diputar sehingga lagu dimainkan <strong>versi penuh asli</strong> (bukan klip 19-30 detik!).
          </div>
        </div>
      `,
      onOpen: () => {
        const tabYt = document.getElementById('tab-import-yt');
        const tabLink = document.getElementById('tab-import-link');
        const tabCsv = document.getElementById('tab-import-csv');
        const tabOauth = document.getElementById('tab-import-oauth');

        const secYt = document.getElementById('section-import-yt');
        const secLink = document.getElementById('section-import-link');
        const secCsv = document.getElementById('section-import-csv');
        const secOauth = document.getElementById('section-import-oauth');

        const activate = (tab, sec, activeClass = 'bg-cyan-500 text-white') => {
          [tabYt, tabLink, tabCsv, tabOauth].forEach(t => t.className = 'flex-1 py-2 px-2 font-semibold text-center rounded-lg text-slate-300 hover:text-white whitespace-nowrap');
          [secYt, secLink, secCsv, secOauth].forEach(s => s.classList.add('hidden'));
          tab.className = `flex-1 py-2 px-2 font-semibold text-center rounded-lg ${activeClass} whitespace-nowrap`;
          sec.classList.remove('hidden');
        };

        tabYt.onclick = () => activate(tabYt, secYt, 'bg-red-600 text-white');
        tabLink.onclick = () => activate(tabLink, secLink, 'bg-cyan-500 text-white');
        tabCsv.onclick = () => activate(tabCsv, secCsv, 'bg-cyan-500 text-white');
        tabOauth.onclick = () => activate(tabOauth, secOauth, 'bg-amber-500 text-slate-900');

        // Click sample YT button
        document.querySelectorAll('.sample-yt-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const url = e.currentTarget.getAttribute('data-url');
            const input = document.getElementById('yt-link-input');
            if (input && url) {
              input.value = url;
              input.focus();
            }
          });
        });

        // Click sample Spotify button
        document.querySelectorAll('.sample-spotify-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const url = e.currentTarget.getAttribute('data-url');
            const input = document.getElementById('spotify-link-input');
            if (input && url) {
              input.value = url;
              input.focus();
            }
          });
        });

        // Submit YouTube Music Import
        document.getElementById('submit-import-yt-btn')?.addEventListener('click', async () => {
          const input = document.getElementById('yt-link-input');
          const submitBtn = document.getElementById('submit-import-yt-btn');
          const btnText = document.getElementById('import-yt-btn-text');
          const spinner = document.getElementById('import-yt-btn-spinner');

          const val = input?.value?.trim();
          if (!val) {
            Toast.warning('Silakan masukkan link YouTube Music atau YouTube.');
            return;
          }

          if (submitBtn) submitBtn.disabled = true;
          if (btnText) btnText.textContent = 'Menghubungkan ke YouTube Music...';
          if (spinner) spinner.classList.remove('hidden');

          try {
            Toast.info('Mengambil daftar lagu penuh dari YouTube Music...', 'Memproses');
            const result = await youtubeService.importPlaylist(val, {
              onProgress: (cur, tot) => {
                if (btnText) btnText.textContent = `Mengimpor ${cur}/${tot} lagu penuh...`;
              }
            });

            document.getElementById('bottom-sheet-overlay')?.classList.remove('active');
            Toast.success(`Playlist "${result.playlist.name}" berhasil diimpor dengan ${result.tracks.length} lagu versi penuh!`, 'YouTube Music');
            router.navigate(`/playlist/${result.playlist.id}`);
          } catch (err) {
            console.error('Import YouTube error:', err);
            Toast.error(err.message || 'Gagal mengimpor dari YouTube Music.', 'Impor Gagal');
          } finally {
            if (submitBtn) submitBtn.disabled = false;
            if (btnText) btnText.textContent = 'Impor Playlist YouTube Music (Versi Penuh)';
            if (spinner) spinner.classList.add('hidden');
          }
        });

        // Submit Spotify Link
        document.getElementById('submit-import-link-btn')?.addEventListener('click', async () => {
          const input = document.getElementById('spotify-link-input');
          const submitBtn = document.getElementById('submit-import-link-btn');
          const btnText = document.getElementById('import-btn-text');
          const spinner = document.getElementById('import-btn-spinner');

          const val = input?.value?.trim();
          if (!val) {
            Toast.warning('Silakan tempel link Spotify terlebih dahulu.');
            return;
          }

          const parsed = spotifyImporter.parseSpotifyLink(val);
          if (!parsed) {
            Toast.error('Link tidak valid. Pastikan link diawali https://open.spotify.com/playlist/...');
            return;
          }

          if (submitBtn) submitBtn.disabled = true;
          if (btnText) btnText.textContent = 'Mengimpor dari Spotify...';
          if (spinner) spinner.classList.remove('hidden');

          try {
            Toast.info('Mengambil metadata dan daftar lagu dari Spotify...', 'Memproses');
            const result = await spotifyImporter.importFromSpotifyLink(val, {
              onProgress: (current, total) => {
                if (btnText) btnText.textContent = `Mengimpor ${current}/${total} lagu...`;
              }
            });

            document.getElementById('bottom-sheet-overlay')?.classList.remove('active');
            Toast.success(`Playlist "${result.playlist.name}" berhasil diimpor dengan ${result.tracks.length} lagu!`, 'Impor Berhasil');
            router.navigate(`/playlist/${result.playlist.id}`);
          } catch (err) {
            console.error('Import Spotify error:', err);
            Toast.error(err.message || 'Gagal mengimpor dari Spotify. Periksa koneksi internet atau gunakan tab Unggah CSV.', 'Impor Gagal');
          } finally {
            if (submitBtn) submitBtn.disabled = false;
            if (btnText) btnText.textContent = 'Impor dari Link Spotify';
            if (spinner) spinner.classList.add('hidden');
          }
        });

        // Submit CSV
        document.getElementById('submit-import-csv-btn')?.addEventListener('click', async () => {
          const input = document.getElementById('spotify-csv-input');
          const file = input?.files?.[0];
          if (!file) {
            Toast.error('Pilih file CSV terlebih dahulu.');
            return;
          }

          document.getElementById('bottom-sheet-overlay')?.classList.remove('active');
          Toast.info('Membaca file CSV Exportify...');
          const text = await file.text();
          const cleanName = file.name.replace(/\.csv$/i, '');
          const result = await spotifyImporter.parseExportifyCsv(text, cleanName);

          Toast.success(`Berhasil mengimpor ${result.tracks.length} lagu dari CSV!`, 'Impor Selesai');
          router.navigate(`/playlist/${result.playlist.id}`);
        });

        // Submit OAuth
        document.getElementById('submit-import-oauth-btn')?.addEventListener('click', () => {
          spotifyImporter.redirectToSpotifyAuth();
        });
      }
    });
  }

  // --- Audio Resolver Modal ---
  showAudioResolverModal(track) {
    BottomSheet.show({
      title: `Sumber Audio: ${track.title}`,
      contentHtml: `
        <div class="space-y-4 text-xs">
          <p class="text-slate-300 leading-relaxed">
            Lagu ini saat ini berstatus <strong>Hanya Metadata</strong>. Pilih cara menautkan audio:
          </p>

          <div class="space-y-2">
            <button id="resolve-via-local-file" class="btn btn-primary w-full justify-start text-xs py-3">
              <svg class="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              Pilih File MP3/M4A dari Perangkat Saya
            </button>
            <input type="file" id="track-single-audio-file" accept="audio/*" class="hidden" />

            <button id="resolve-via-cc-search" class="btn btn-secondary w-full justify-start text-xs py-3">
              <svg class="w-4 h-4 mr-2 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              Cari Versi Bebas Royalti (Creative Commons)
            </button>
          </div>
        </div>
      `,
      onOpen: () => {
        const fileInput = document.getElementById('track-single-audio-file');
        document.getElementById('resolve-via-local-file')?.addEventListener('click', () => {
          fileInput?.click();
        });

        fileInput?.addEventListener('change', async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const url = URL.createObjectURL(file);
          track.hasAudio = true;
          track.audioUrl = url;
          track.audioType = 'local';
          track.localFileName = file.name;
          await dbManager.saveTrack(track);

          document.getElementById('bottom-sheet-overlay')?.classList.remove('active');
          Toast.success(`Audio lokal ditautkan ke "${track.title}"!`);
          if (this.currentView === 'playlist' && this.activePlaylistId) {
            this.renderPlaylistDetail(this.activePlaylistId);
          }
        });

        document.getElementById('resolve-via-cc-search')?.addEventListener('click', async () => {
          document.getElementById('bottom-sheet-overlay')?.classList.remove('active');
          Toast.info(`Mencari versi legal untuk "${track.title}"...`);
          await audioSourcesManager.searchLegalAudioStream(track);
          if (this.currentView === 'playlist' && this.activePlaylistId) {
            this.renderPlaylistDetail(this.activePlaylistId);
          }
        });
      }
    });
  }

  // --- Prompts ---
  promptCreatePlaylist() {
    const name = window.prompt ? window.prompt('Nama playlist baru:', 'Playlist Keren') : 'Playlist Keren';
    if (name && name.trim()) {
      libraryManager.createPlaylist(name).then(() => {
        if (this.currentView === 'library') this.renderLibrary();
        else if (this.currentView === 'home') this.renderHome();
      });
    }
  }

  promptAddLocalMusic(playlistId = null) {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'audio/*';
    input.onchange = async () => {
      if (input.files && input.files.length > 0) {
        if (playlistId) {
          await audioSourcesManager.addLocalFilesAsTracks(input.files, playlistId);
          this.renderPlaylistDetail(playlistId);
        } else {
          // Add to default playlist
          const targetPl = (await dbManager.getPlaylists())[0] || await libraryManager.createPlaylist('Musik Lokal');
          await audioSourcesManager.addLocalFilesAsTracks(input.files, targetPl.id);
          if (this.currentView === 'library') this.renderLibrary();
          else if (this.currentView === 'home') this.renderHome();
        }
      }
    };
    input.click();
  }

  // --- Player Bar & Fullscreen Synchronization ---
  _bindPlayerBarEvents() {
    // Desktop Player Bar
    const dPlayPause = document.getElementById('desktop-play-pause-btn');
    const dPrev = document.getElementById('desktop-prev-btn');
    const dNext = document.getElementById('desktop-next-btn');
    const dShuffle = document.getElementById('desktop-shuffle-btn');
    const dRepeat = document.getElementById('desktop-repeat-btn');
    const dSeek = document.getElementById('desktop-seekbar');
    const dVolume = document.getElementById('desktop-volume-slider');
    const dExpand = document.getElementById('desktop-expand-player-btn');
    const dCover = document.getElementById('desktop-player-cover');
    const dText = document.getElementById('desktop-player-text');

    dPlayPause?.addEventListener('click', () => player.togglePlay());
    dPrev?.addEventListener('click', () => player.prev());
    dNext?.addEventListener('click', () => player.next());
    dShuffle?.addEventListener('click', () => player.toggleShuffle());
    dRepeat?.addEventListener('click', () => player.cycleRepeat());

    dSeek?.addEventListener('input', (e) => {
      const targetSec = (parseFloat(e.target.value) / 100) * (player.getState().duration || 180);
      player.seek(targetSec);
    });

    dVolume?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value) / 100; // 0.0 to 3.0
      const isGuest = !authManager.getState().isGoogle;
      audioEngine.setVolume(val, isGuest);
    });

    const openFull = () => this.openFullscreenPlayer();
    dExpand?.addEventListener('click', openFull);
    dCover?.addEventListener('click', openFull);
    dText?.addEventListener('click', openFull);

    // Mobile Mini Player
    const mBar = document.getElementById('mobile-mini-player');
    const mPlayPause = document.getElementById('mini-play-pause-btn');
    mBar?.addEventListener('click', (e) => {
      if (e.target.closest('#mini-play-pause-btn')) return;
      this.openFullscreenPlayer();
    });
    mPlayPause?.addEventListener('click', (e) => {
      e.stopPropagation();
      player.togglePlay();
    });

    // Reactive player state listener
    player.onStateChange((state, type) => {
      this._updatePlayerUI(state, type);
    });
  }

  _bindFullscreenPlayerEvents() {
    const fsClose = document.getElementById('fullscreen-close-btn');
    const fsPlayPause = document.getElementById('fs-play-pause-btn');
    const fsPrev = document.getElementById('fs-prev-btn');
    const fsNext = document.getElementById('fs-next-btn');
    const fsShuffle = document.getElementById('fs-shuffle-btn');
    const fsRepeat = document.getElementById('fs-repeat-btn');
    const fsSeek = document.getElementById('fs-seekbar');
    const fsVolume = document.getElementById('fs-volume-slider');
    const fsEqBtn = document.getElementById('fs-equalizer-btn');
    const fsSleepBtn = document.getElementById('fs-sleep-timer-btn');

    fsClose?.addEventListener('click', () => this.closeFullscreenPlayer());
    fsPlayPause?.addEventListener('click', () => player.togglePlay());
    fsPrev?.addEventListener('click', () => player.prev());
    fsNext?.addEventListener('click', () => player.next());
    fsShuffle?.addEventListener('click', () => player.toggleShuffle());
    fsRepeat?.addEventListener('click', () => player.cycleRepeat());

    fsSeek?.addEventListener('input', (e) => {
      const targetSec = (parseFloat(e.target.value) / 100) * (player.getState().duration || 180);
      player.seek(targetSec);
    });

    fsVolume?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value) / 100;
      const isGuest = !authManager.getState().isGoogle;
      audioEngine.setVolume(val, isGuest);
    });

    fsEqBtn?.addEventListener('click', () => this.showEqualizerModal());
    fsSleepBtn?.addEventListener('click', () => this.showSleepTimerModal());
  }

  openFullscreenPlayer() {
    const el = document.getElementById('fullscreen-player');
    if (el) {
      el.classList.add('active');
      const canvas = document.getElementById('audio-visualizer-canvas');
      if (canvas) audioEngine.attachVisualizer(canvas);
    }
  }

  closeFullscreenPlayer() {
    const el = document.getElementById('fullscreen-player');
    if (el) {
      el.classList.remove('active');
      audioEngine.attachVisualizer(null);
    }
  }

  // --- 10-Band Equalizer Modal ---
  showEqualizerModal() {
    const isGoogle = authManager.getState().isGoogle;

    BottomSheet.show({
      title: 'Equalizer 10-Band & Audio Enhancer',
      contentHtml: `
        <div class="text-xs">
          <!-- Preset selector -->
          <div class="flex items-center justify-between mb-4">
            <span class="text-slate-300 font-semibold">Preset Audio:</span>
            <select id="eq-preset-select" class="text-xs py-1.5 px-3 rounded-lg bg-slate-800 text-white border border-slate-700">
              ${Object.entries(EQ_PRESETS).map(([k, p]) => `
                <option value="${k}" ${audioEngine.currentPreset === k ? 'selected' : ''}>${p.name}</option>
              `).join('')}
              <option value="custom" ${audioEngine.currentPreset === 'custom' ? 'selected' : ''}>Kustom</option>
            </select>
          </div>

          <!-- Clarity Enhancer switch -->
          <div class="flex items-center justify-between p-3 rounded-xl bg-slate-800/80 border border-slate-700 mb-4">
            <div>
              <div class="font-bold text-white flex items-center gap-1.5">
                <span>Clarity Enhancer</span>
                <span class="badge badge-cool text-[10px]">HD</span>
              </div>
              <div class="text-[11px] text-slate-400 mt-0.5">Kompresi dinamis halus + penajaman frekuensi tinggi</div>
            </div>
            <input type="checkbox" id="toggle-clarity-enhancer" ${audioEngine.clarityEnabled ? 'checked' : ''} class="w-5 h-5 accent-cyan-400 cursor-pointer" />
          </div>

          <!-- 10-Band sliders strip -->
          <div class="p-3 rounded-xl bg-slate-900 border border-slate-800 mb-4">
            <div class="flex items-end justify-between gap-1 h-36">
              ${EQ_FREQUENCIES.map((freq, idx) => `
                <div class="flex flex-col items-center flex-1 h-full justify-between">
                  <span class="text-[9px] font-mono text-cyan-400" id="eq-val-${idx}">${audioEngine.customGains[idx] || 0}dB</span>
                  <input 
                    type="range" 
                    min="-12" 
                    max="12" 
                    step="0.5" 
                    value="${audioEngine.customGains[idx] || 0}" 
                    class="eq-vertical-slider" 
                    data-band-idx="${idx}"
                    ${!isGoogle ? 'disabled' : ''}
                  />
                  <span class="text-[9px] text-slate-400 font-medium">${freq >= 1000 ? `${freq/1000}k` : freq}</span>
                </div>
              `).join('')}
            </div>
            ${!isGoogle ? `
              <div class="text-center mt-3 pt-2 border-t border-slate-800 text-[11px] text-amber-400">
                <svg class="w-3.5 h-3.5 inline mr-1" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                Slider kustom terbuka untuk pengguna Google. Mode Tamu dapat menggunakan preset bawaan.
              </div>
            ` : ''}
          </div>
        </div>
      `,
      onOpen: () => {
        document.getElementById('eq-preset-select')?.addEventListener('change', (e) => {
          const val = e.target.value;
          if (val !== 'custom') {
            audioEngine.setPreset(val);
            // Update sliders
            EQ_FREQUENCIES.forEach((_, idx) => {
              const slider = document.querySelector(`input[data-band-idx="${idx}"]`);
              const label = document.getElementById(`eq-val-${idx}`);
              if (slider && label) {
                slider.value = audioEngine.customGains[idx] || 0;
                label.innerText = `${audioEngine.customGains[idx]}dB`;
              }
            });
            Toast.info(`Preset "${EQ_PRESETS[val]?.name}" aktif`);
          }
        });

        document.getElementById('toggle-clarity-enhancer')?.addEventListener('change', (e) => {
          audioEngine.setClarityEnhancer(e.target.checked);
          Toast.info(e.target.checked ? 'Clarity Enhancer aktif.' : 'Clarity Enhancer nonaktif.');
        });

        document.querySelectorAll('.eq-vertical-slider').forEach(slider => {
          slider.addEventListener('input', (e) => {
            const idx = parseInt(e.target.getAttribute('data-band-idx'), 10);
            const val = parseFloat(e.target.value);
            audioEngine.setBandGain(idx, val);
            const label = document.getElementById(`eq-val-${idx}`);
            if (label) label.innerText = `${val}dB`;
            const sel = document.getElementById('eq-preset-select');
            if (sel) sel.value = 'custom';
          });
        });
      }
    });
  }

  // --- Sleep Timer Modal ---
  showSleepTimerModal() {
    BottomSheet.show({
      title: 'Sleep Timer (Pengatur Waktu Tidur)',
      contentHtml: `
        <div class="text-xs space-y-2 text-center py-2">
          <p class="text-slate-300 mb-4 leading-relaxed">
            Hentikan pemutaran musik secara otomatis setelah durasi berikut:
          </p>
          <div class="grid grid-cols-2 gap-2 mb-3">
            <button class="btn btn-secondary text-xs py-3 sleep-time-btn" data-minutes="15">15 Menit</button>
            <button class="btn btn-secondary text-xs py-3 sleep-time-btn" data-minutes="30">30 Menit</button>
            <button class="btn btn-secondary text-xs py-3 sleep-time-btn" data-minutes="45">45 Menit</button>
            <button class="btn btn-secondary text-xs py-3 sleep-time-btn" data-minutes="60">60 Menit</button>
          </div>
          <button class="btn btn-danger w-full text-xs py-2.5" id="cancel-sleep-timer-btn">
            Batalkan Sleep Timer
          </button>
        </div>
      `,
      onOpen: () => {
        const close = () => document.getElementById('bottom-sheet-overlay')?.classList.remove('active');

        document.querySelectorAll('.sleep-time-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const mins = parseInt(btn.getAttribute('data-minutes'), 10);
            player.setSleepTimer(mins);
            close();
          });
        });

        document.getElementById('cancel-sleep-timer-btn')?.addEventListener('click', () => {
          player.setSleepTimer(0);
          close();
        });
      }
    });
  }

  // --- Player State Syncer ---
  _updatePlayerUI(state, type) {
    const track = state.currentTrack;
    const isPlaying = state.isPlaying;
    const dur = state.duration || 180;
    const cur = state.currentTime || 0;
    const progressPercent = dur > 0 ? (cur / dur) * 100 : 0;
    const volumePercent = Math.round(state.volume * 100);

    // Desktop elements
    const dCover = document.getElementById('desktop-player-cover');
    const dTitle = document.getElementById('desktop-player-title');
    const dArtist = document.getElementById('desktop-player-artist');
    const dPlayPause = document.getElementById('desktop-play-pause-btn');
    const dSeek = document.getElementById('desktop-seekbar');
    const dCurTime = document.getElementById('desktop-current-time');
    const dDurTime = document.getElementById('desktop-duration-time');
    const dVolume = document.getElementById('desktop-volume-slider');
    const dVolVal = document.getElementById('desktop-volume-value');
    const dShuffle = document.getElementById('desktop-shuffle-btn');
    const dRepeat = document.getElementById('desktop-repeat-btn');

    // Mobile elements
    const mBar = document.getElementById('mobile-mini-player');
    const mCover = document.getElementById('mini-player-cover');
    const mTitle = document.getElementById('mini-player-title');
    const mArtist = document.getElementById('mini-player-artist');
    const mPlayPause = document.getElementById('mini-play-pause-btn');
    const mFill = document.getElementById('mini-player-fill');

    // Fullscreen elements
    const fsCover = document.getElementById('fs-player-cover');
    const fsTitle = document.getElementById('fs-player-title');
    const fsArtist = document.getElementById('fs-player-artist');
    const fsPlayPause = document.getElementById('fs-play-pause-btn');
    const fsSeek = document.getElementById('fs-seekbar');
    const fsCurTime = document.getElementById('fs-current-time');
    const fsDurTime = document.getElementById('fs-duration-time');
    const fsVolume = document.getElementById('fs-volume-slider');
    const fsVolVal = document.getElementById('fs-volume-value');
    const fsShuffle = document.getElementById('fs-shuffle-btn');
    const fsRepeat = document.getElementById('fs-repeat-btn');

    if (track) {
      mBar?.classList.add('active');

      const coverSrc = track.coverUrl || '/assets/logo.png';
      if (dCover) dCover.src = coverSrc;
      if (mCover) mCover.src = coverSrc;
      if (fsCover) fsCover.src = coverSrc;

      if (dTitle) dTitle.innerText = track.title;
      if (mTitle) mTitle.innerText = track.title;
      if (fsTitle) fsTitle.innerText = track.title;

      if (dArtist) dArtist.innerText = track.artist;
      if (mArtist) mArtist.innerText = track.artist;
      if (fsArtist) fsArtist.innerText = track.artist;
    }

    // Play/Pause Icons
    const playIcon = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    const pauseIcon = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;

    if (dPlayPause) dPlayPause.innerHTML = isPlaying ? pauseIcon : playIcon;
    if (mPlayPause) mPlayPause.innerHTML = isPlaying ? pauseIcon : playIcon;
    if (fsPlayPause) fsPlayPause.innerHTML = isPlaying ? pauseIcon : playIcon;

    // Time & Progress
    if (dCurTime) dCurTime.innerText = formatTime(cur);
    if (dDurTime) dDurTime.innerText = formatTime(dur);
    if (fsCurTime) fsCurTime.innerText = formatTime(cur);
    if (fsDurTime) fsDurTime.innerText = formatTime(dur);

    if (dSeek && document.activeElement !== dSeek) dSeek.value = progressPercent;
    if (fsSeek && document.activeElement !== fsSeek) fsSeek.value = progressPercent;
    if (mFill) mFill.style.width = `${progressPercent}%`;

    // Volume & Boost zone
    if (dVolume && document.activeElement !== dVolume) dVolume.value = volumePercent;
    if (fsVolume && document.activeElement !== fsVolume) fsVolume.value = volumePercent;

    const isBoost = volumePercent > 100;
    const volText = isBoost ? `BOOST ${volumePercent}%` : `${volumePercent}%`;

    if (dVolVal) {
      dVolVal.innerText = volText;
      dVolVal.className = isBoost ? 'badge badge-gold text-[10px]' : 'text-xs font-mono text-slate-400';
    }
    if (fsVolVal) {
      fsVolVal.innerText = volText;
      fsVolVal.className = isBoost ? 'badge badge-gold text-[10px]' : 'text-xs font-mono text-slate-400';
    }

    if (dVolume) dVolume.classList.toggle('volume-boost-active', isBoost);
    if (fsVolume) fsVolume.classList.toggle('volume-boost-active', isBoost);

    // Shuffle & Repeat states
    if (dShuffle) dShuffle.classList.toggle('active', state.isShuffled);
    if (fsShuffle) fsShuffle.classList.toggle('active', state.isShuffled);

    const isRepeatAll = state.repeatMode === 'all';
    const isRepeatOne = state.repeatMode === 'one';

    if (dRepeat) {
      dRepeat.classList.toggle('active', isRepeatAll || isRepeatOne);
      dRepeat.classList.toggle('gold-active', isRepeatOne);
    }
    if (fsRepeat) {
      fsRepeat.classList.toggle('active', isRepeatAll || isRepeatOne);
      fsRepeat.classList.toggle('gold-active', isRepeatOne);
    }
  }
}

export const uiManager = new UIManager();
