/**
 * AylusMusic - Library & Playlist Management Module
 */

import { generateId } from './utils.js';
import { dbManager } from './db.js';
import { Toast, Dialog } from './toast.js';

class LibraryManager {
  constructor() {
    this.playlists = [];
    this.folders = [];
    this.favorites = [];
  }

  async loadAll() {
    this.playlists = await dbManager.getPlaylists();
    this.favorites = await dbManager.getFavorites();
    this.folders = await dbManager.getAll('folders');
    return {
      playlists: this.playlists,
      favorites: this.favorites,
      folders: this.folders
    };
  }

  async createPlaylist(name, description = '') {
    const pl = await dbManager.savePlaylist({
      name: name.trim() || 'Playlist Baru',
      description,
      coverUrl: '/assets/logo.png',
      isSpotify: false,
      trackCount: 0
    });
    this.playlists.unshift(pl);
    Toast.success(`Playlist "${pl.name}" berhasil dibuat.`);
    return pl;
  }

  async renamePlaylist(id, newName) {
    const pl = await dbManager.getPlaylist(id);
    if (!pl) return;
    pl.name = newName.trim();
    pl.updatedAt = Date.now();
    await dbManager.savePlaylist(pl);
    Toast.success('Nama playlist diperbarui.');
    return pl;
  }

  async deletePlaylist(id) {
    const pl = await dbManager.getPlaylist(id);
    if (!pl) return;

    const confirmed = await Dialog.confirm({
      title: 'Hapus Playlist?',
      message: `Apakah Anda yakin ingin menghapus playlist "${pl.name}" beserta lagunya?`,
      confirmText: 'Hapus',
      cancelText: 'Batal',
      isDanger: true
    });

    if (!confirmed) return false;

    await dbManager.deletePlaylist(id);
    this.playlists = this.playlists.filter(p => p.id !== id);
    Toast.success(`Playlist "${pl.name}" telah dihapus.`);
    return true;
  }

  async createFolder(name) {
    const folder = {
      id: generateId('fld'),
      name: name.trim() || 'Folder Baru',
      playlistIds: [],
      createdAt: Date.now()
    };
    await dbManager.put('folders', folder);
    this.folders.push(folder);
    Toast.success(`Folder "${folder.name}" dibuat.`);
    return folder;
  }

  async addPlaylistToFolder(folderId, playlistId) {
    const folder = await dbManager.get('folders', folderId);
    if (!folder) return;
    if (!folder.playlistIds.includes(playlistId)) {
      folder.playlistIds.push(playlistId);
      await dbManager.put('folders', folder);
      Toast.success('Playlist dipindahkan ke folder.');
    }
  }

  async updateTrackMetadata(trackId, updates) {
    const track = await dbManager.getTrack(trackId);
    if (!track) return null;

    if (updates.title) track.title = updates.title.trim();
    if (updates.artist) track.artist = updates.artist.trim();
    if (updates.album) track.album = updates.album.trim();
    if (updates.coverUrl) track.coverUrl = updates.coverUrl;

    await dbManager.saveTrack(track);
    Toast.success('Tag lagu berhasil diperbarui.');
    return track;
  }

  async removeTrack(trackId, playlistId) {
    await dbManager.deleteTrack(trackId);
    if (playlistId) {
      const pl = await dbManager.getPlaylist(playlistId);
      if (pl && pl.trackCount > 0) {
        pl.trackCount--;
        await dbManager.savePlaylist(pl);
      }
    }
    Toast.info('Lagu dihapus dari playlist.');
    return true;
  }

  async reorderTracks(playlistId, orderedTrackIds) {
    const tracks = await dbManager.getTracksByPlaylist(playlistId);
    const trackMap = new Map(tracks.map(t => [t.id, t]));
    
    // Update order timestamp
    let now = Date.now();
    for (const id of orderedTrackIds) {
      const tr = trackMap.get(id);
      if (tr) {
        tr.order = now++;
        await dbManager.saveTrack(tr);
      }
    }
    return true;
  }
}

export const libraryManager = new LibraryManager();
