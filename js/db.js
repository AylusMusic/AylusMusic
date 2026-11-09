/**
 * AylusMusic - IndexedDB Local Database Wrapper & Cloud Sync
 */

import { generateId } from './utils.js';
import { initFirebase } from './firebase.js';

const DB_NAME = 'aylusmusic_idb';
const DB_VERSION = 2;

class LocalDatabase {
  constructor() {
    this.db = null;
    this.isReady = false;
  }

  async init() {
    if (this.isReady) return this;

    // Request persistent storage so browser does not evict data
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      try {
        const isPersisted = await navigator.storage.persist();
        console.log(`[Storage] Persistent storage granted: ${isPersisted}`);
      } catch (e) {
        console.warn('[Storage] persist error:', e);
      }
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Playlists store
        if (!db.objectStoreNames.contains('playlists')) {
          const playlistStore = db.createObjectStore('playlists', { keyPath: 'id' });
          playlistStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          playlistStore.createIndex('isSpotify', 'isSpotify', { unique: false });
        }

        // Tracks store
        if (!db.objectStoreNames.contains('tracks')) {
          const trackStore = db.createObjectStore('tracks', { keyPath: 'id' });
          trackStore.createIndex('playlistId', 'playlistId', { unique: false });
          trackStore.createIndex('title', 'title', { unique: false });
          trackStore.createIndex('artist', 'artist', { unique: false });
          trackStore.createIndex('offline', 'offline', { unique: false });
          trackStore.createIndex('hasAudio', 'hasAudio', { unique: false });
        }

        // Folders store
        if (!db.objectStoreNames.contains('folders')) {
          db.createObjectStore('folders', { keyPath: 'id' });
        }

        // Favorites store
        if (!db.objectStoreNames.contains('favorites')) {
          const favStore = db.createObjectStore('favorites', { keyPath: 'id' });
          favStore.createIndex('addedAt', 'addedAt', { unique: false });
        }

        // History store
        if (!db.objectStoreNames.contains('history')) {
          const histStore = db.createObjectStore('history', { keyPath: 'id' });
          histStore.createIndex('playedAt', 'playedAt', { unique: false });
        }

        // App settings
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        this.isReady = true;
        console.log('[IndexedDB] Ready');
        resolve(this);
      };

      request.onerror = (event) => {
        console.error('[IndexedDB] Open error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  // --- Generic Helpers ---
  _tx(storeName, mode = 'readonly') {
    return this.db.transaction(storeName, mode).objectStore(storeName);
  }

  async getAll(storeName) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._tx(storeName, 'readonly');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async get(storeName, key) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._tx(storeName, 'readonly');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async put(storeName, value) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._tx(storeName, 'readwrite');
      const req = store.put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async delete(storeName, key) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._tx(storeName, 'readwrite');
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async clear(storeName) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._tx(storeName, 'readwrite');
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Playlists API ---
  async getPlaylists() {
    const list = await this.getAll('playlists');
    return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async getPlaylist(id) {
    return this.get('playlists', id);
  }

  async savePlaylist(playlist) {
    const item = {
      id: playlist.id || generateId('pl'),
      name: playlist.name || 'Playlist Baru',
      description: playlist.description || '',
      coverUrl: playlist.coverUrl || '/assets/logo.png',
      trackCount: playlist.trackCount || 0,
      isSpotify: !!playlist.isSpotify,
      spotifyId: playlist.spotifyId || null,
      createdAt: playlist.createdAt || Date.now(),
      updatedAt: Date.now()
    };
    await this.put('playlists', item);
    return item;
  }

  async deletePlaylist(id) {
    await this.delete('playlists', id);
    // Also remove tracks belonging to this playlist
    const tracks = await this.getTracksByPlaylist(id);
    for (const track of tracks) {
      await this.delete('tracks', track.id);
    }
    return true;
  }

  // --- Tracks API ---
  async getTracksByPlaylist(playlistId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._tx('tracks', 'readonly');
      const index = store.index('playlistId');
      const req = index.getAll(playlistId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllTracks() {
    return this.getAll('tracks');
  }

  async getTrack(id) {
    return this.get('tracks', id);
  }

  async addTrack(track) {
    return this.saveTrack(track);
  }

  async saveTrack(track) {
    const item = {
      id: track.id || generateId('tr'),
      playlistId: track.playlistId || 'default',
      title: track.title || 'Judul Tak Dikenal',
      artist: track.artist || 'Artis Tak Dikenal',
      album: track.album || '',
      duration: track.duration || 0,
      coverUrl: track.coverUrl || '/assets/logo.png',
      isrc: track.isrc || null,
      hasAudio: !!track.hasAudio,
      audioUrl: track.audioUrl || '',
      offline: !!track.offline,
      audioType: track.audioType || 'metadata', // 'local' | 'stream' | 'metadata'
      localFile: track.localFile || null,
      addedAt: track.addedAt || Date.now(),
      playCount: track.playCount || 0
    };
    await this.put('tracks', item);
    return item;
  }

  async saveTracksBatch(tracks) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('tracks', 'readwrite');
      const store = tx.objectStore('tracks');
      tracks.forEach(track => {
        store.put(track);
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async deleteTrack(id) {
    return this.delete('tracks', id);
  }

  // --- Favorites (Lagu Disukai) ---
  async toggleFavorite(track) {
    const existing = await this.get('favorites', track.id);
    if (existing) {
      await this.delete('favorites', track.id);
      return false; // un-favorited
    } else {
      await this.put('favorites', {
        id: track.id,
        track: { ...track },
        addedAt: Date.now()
      });
      return true; // favorited
    }
  }

  async isFavorite(trackId) {
    const item = await this.get('favorites', trackId);
    return !!item;
  }

  async getFavorites() {
    const favs = await this.getAll('favorites');
    return favs.sort((a, b) => b.addedAt - a.addedAt).map(f => f.track);
  }

  // --- History & Stats ---
  async addHistory(track) {
    const historyItem = {
      id: generateId('hist'),
      trackId: track.id,
      track: { ...track },
      playedAt: Date.now()
    };
    await this.put('history', historyItem);

    // Increment play count
    const existingTrack = await this.get('tracks', track.id);
    if (existingTrack) {
      existingTrack.playCount = (existingTrack.playCount || 0) + 1;
      await this.put('tracks', existingTrack);
    }
  }

  async getHistory(limit = 50) {
    const hist = await this.getAll('history');
    return hist.sort((a, b) => b.playedAt - a.playedAt).slice(0, limit);
  }

  async getStats() {
    const history = await this.getAll('history');
    const tracks = await this.getAll('tracks');

    const totalPlays = history.length;
    let totalListeningSeconds = 0;
    const artistPlayCounts = {};
    const trackPlayCounts = {};

    history.forEach(item => {
      const t = item.track;
      if (t) {
        totalListeningSeconds += (t.duration || 180);
        const artist = t.artist || 'Artis Tak Dikenal';
        artistPlayCounts[artist] = (artistPlayCounts[artist] || 0) + 1;
        trackPlayCounts[t.title] = (trackPlayCounts[t.title] || 0) + 1;
      }
    });

    const topArtists = Object.entries(artistPlayCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    const topTracks = Object.entries(trackPlayCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([title, count]) => ({ title, count }));

    return {
      totalPlays,
      totalHours: (totalListeningSeconds / 3600).toFixed(1),
      totalTracks: tracks.length,
      topArtists,
      topTracks
    };
  }

  // --- Settings Store ---
  async getSetting(key, defaultValue = null) {
    const row = await this.get('settings', key);
    return row ? row.value : defaultValue;
  }

  async setSetting(key, value) {
    return this.put('settings', { key, value });
  }

  // --- Backup & Restore ---
  async exportBackup() {
    const playlists = await this.getAll('playlists');
    const tracks = await this.getAll('tracks');
    const favorites = await this.getAll('favorites');
    const folders = await this.getAll('folders');

    return {
      version: 1,
      appName: 'AylusMusic',
      exportedAt: new Date().toISOString(),
      playlists,
      tracks: tracks.map(t => ({ ...t, localFile: null })), // remove file references for export
      favorites,
      folders
    };
  }

  async importBackup(data) {
    if (!data || data.appName !== 'AylusMusic') {
      throw new Error('Format backup tidak valid.');
    }
    if (Array.isArray(data.playlists)) {
      for (const pl of data.playlists) await this.put('playlists', pl);
    }
    if (Array.isArray(data.tracks)) {
      for (const tr of data.tracks) await this.put('tracks', tr);
    }
    if (Array.isArray(data.favorites)) {
      for (const fav of data.favorites) await this.put('favorites', fav);
    }
    return true;
  }

  // --- Cloud Sync (Google Account) ---
  async syncToCloud(user) {
    if (!user || !user.uid) return;
    try {
      const { db } = await initFirebase();
      if (!db) return;

      const { doc, setDoc, collection } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

      // Sync profile & summary
      const userRef = doc(db, 'aylusmusic_users', user.uid);
      await setDoc(userRef, {
        displayName: user.displayName || 'Pengguna Aylus',
        email: user.email,
        photoURL: user.photoURL,
        lastSyncedAt: Date.now()
      }, { merge: true });

      // Sync playlists
      const playlists = await this.getAll('playlists');
      for (const pl of playlists) {
        const plRef = doc(db, `aylusmusic_users/${user.uid}/playlists`, pl.id);
        await setDoc(plRef, pl, { merge: true });
      }

      // Sync favorites
      const favs = await this.getAll('favorites');
      for (const fav of favs) {
        const favRef = doc(db, `aylusmusic_users/${user.uid}/favorites`, fav.id);
        await setDoc(favRef, fav, { merge: true });
      }

      console.log('[Firestore] Synced to cloud successfully');
    } catch (err) {
      console.warn('[Firestore] Sync error:', err.message);
    }
  }

  async syncFromCloud(user) {
    if (!user || !user.uid) return;
    try {
      const { db } = await initFirebase();
      if (!db) return;

      const { collection, getDocs } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

      // Fetch cloud playlists
      const plSnap = await getDocs(collection(db, `aylusmusic_users/${user.uid}/playlists`));
      for (const docSnap of plSnap.docs) {
        const cloudPl = docSnap.data();
        const localPl = await this.get('playlists', cloudPl.id);
        if (!localPl || (cloudPl.updatedAt || 0) > (localPl.updatedAt || 0)) {
          await this.put('playlists', cloudPl);
        }
      }

      // Fetch cloud favorites
      const favSnap = await getDocs(collection(db, `aylusmusic_users/${user.uid}/favorites`));
      for (const docSnap of favSnap.docs) {
        await this.put('favorites', docSnap.data());
      }

      console.log('[Firestore] Synced from cloud successfully');
    } catch (err) {
      console.warn('[Firestore] SyncFromCloud error:', err.message);
    }
  }
}

export const dbManager = new LocalDatabase();
