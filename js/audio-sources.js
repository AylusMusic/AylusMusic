/**
 * AylusMusic - Legal Audio Sources & Resolver Module
 * Resolves audio without violating copyrights or third-party ToS.
 */

import { scoreTrackMatch, generateId, sleep } from './utils.js';
import { dbManager } from './db.js';
import { Toast, Dialog } from './toast.js';

// Free / Creative Commons sample tracks bundled for instant out-of-the-box listening
export const SAMPLE_ROYALTY_FREE_TRACKS = [
  {
    id: 'sample_01',
    playlistId: 'sample_playlist',
    title: 'Neon Horizon (Synthwave Dream)',
    artist: 'Aylus Collective',
    album: 'Aylus Studio Originals',
    duration: 172,
    coverUrl: '/assets/logo.png',
    hasAudio: true,
    audioUrl: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=synthwave-80s-110045.mp3',
    audioType: 'stream',
    offline: false
  },
  {
    id: 'sample_02',
    playlistId: 'sample_playlist',
    title: 'Emerald Chillout Beats',
    artist: 'Lofi Soundscapes',
    album: 'Deep Focus Vol. 1',
    duration: 145,
    coverUrl: '/assets/logo.png',
    hasAudio: true,
    audioUrl: 'https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0a13f69d2.mp3?filename=lofi-study-112191.mp3',
    audioType: 'stream',
    offline: false
  },
  {
    id: 'sample_03',
    playlistId: 'sample_playlist',
    title: 'Golden Acoustic Sunrise',
    artist: 'Acoustic Breeze',
    album: 'Morning Serenade',
    duration: 188,
    coverUrl: '/assets/logo.png',
    hasAudio: true,
    audioUrl: 'https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8c8a73467.mp3?filename=acoustic-guitars-ambient-10853.mp3',
    audioType: 'stream',
    offline: false
  },
  {
    id: 'sample_04',
    playlistId: 'sample_playlist',
    title: 'Tosca Waves & Ambient Echoes',
    artist: 'Oceanic Sound Lab',
    album: 'Elemental Waves',
    duration: 210,
    coverUrl: '/assets/logo.png',
    hasAudio: true,
    audioUrl: 'https://cdn.pixabay.com/download/audio/2021/08/04/audio_12b0c7443c.mp3?filename=chill-ambient-11668.mp3',
    audioType: 'stream',
    offline: false
  }
];

class AudioSourcesManager {
  constructor() {
    this.quality = localStorage.getItem('aylus_audio_quality') || 'balanced'; // 'saver' | 'balanced' | 'high'
  }

  setQuality(quality) {
    this.quality = quality;
    localStorage.setItem('aylus_audio_quality', quality);
  }

  getQuality() {
    return this.quality;
  }

  /**
   * Seed sample playlist if library is empty
   */
  async ensureInitialSampleTracks() {
    const existing = await dbManager.getAllTracks();
    if (existing.length === 0) {
      const samplePlaylist = await dbManager.savePlaylist({
        id: 'sample_playlist',
        name: 'AylusMusic Pilihan Pertama',
        description: 'Lagu sampel berlisensi bebas royalti untuk menguji Web Audio & 300% Boost',
        coverUrl: '/assets/logo.png',
        isSpotify: false,
        trackCount: SAMPLE_ROYALTY_FREE_TRACKS.length
      });

      await dbManager.saveTracksBatch(SAMPLE_ROYALTY_FREE_TRACKS);
      console.log('[AudioSources] Seeded sample royalty-free playlist');
    }
  }

  /**
   * Match local music files to playlist tracks using fuzzy title/artist matching
   * @param {FileList|File[]} files 
   * @param {string} playlistId 
   * @returns {Promise<{ matched: number, unmatched: number, results: Array }>}
   */
  async matchLocalFilesToPlaylist(files, playlistId = null) {
    const targetTracks = playlistId 
      ? await dbManager.getTracksByPlaylist(playlistId)
      : await dbManager.getAllTracks();

    const fileList = Array.from(files).filter(f => f.type.startsWith('audio/') || /\.(mp3|m4a|wav|ogg|flac|opus|aac)$/i.test(f.name));
    
    if (fileList.length === 0) {
      Toast.error('Tidak ada file audio yang ditemukan.', 'File Audio Kosong');
      return { matched: 0, unmatched: 0, results: [] };
    }

    const results = [];
    let matchedCount = 0;

    for (const file of fileList) {
      let bestTrack = null;
      let highestScore = 0;

      for (const track of targetTracks) {
        const score = scoreTrackMatch(track, file);
        if (score > highestScore) {
          highestScore = score;
          bestTrack = track;
        }
      }

      // Threshold: 0.70 confidence
      if (bestTrack && highestScore >= 0.70) {
        const audioUrl = URL.createObjectURL(file);
        bestTrack.hasAudio = true;
        bestTrack.audioUrl = audioUrl;
        bestTrack.audioType = 'local';
        bestTrack.localFileName = file.name;
        await dbManager.saveTrack(bestTrack);

        results.push({
          file: file.name,
          trackTitle: bestTrack.title,
          artist: bestTrack.artist,
          score: Math.round(highestScore * 100),
          status: 'matched'
        });
        matchedCount++;
      } else {
        // If not matched to existing metadata, offer adding as a brand new local track!
        results.push({
          file: file.name,
          status: 'new_track'
        });
      }
    }

    Toast.success(`Berhasil mencocokkan ${matchedCount} file audio lokal ke metadata lagu!`, 'Pencocokan Selesai');
    return {
      matched: matchedCount,
      unmatched: fileList.length - matchedCount,
      results
    };
  }

  /**
   * Add local audio files directly as new tracks into a playlist
   */
  async addLocalFilesAsTracks(files, playlistId) {
    const audioFiles = Array.from(files).filter(f => f.type.startsWith('audio/') || /\.(mp3|m4a|wav|ogg|flac|opus|aac)$/i.test(f.name));
    const newTracks = [];

    for (const file of audioFiles) {
      const cleanName = file.name.replace(/\.[^/.]+$/, '');
      const parts = cleanName.split(' - ');
      const artist = parts.length > 1 ? parts[0].trim() : 'Artis Lokal';
      const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : cleanName;

      const audioUrl = URL.createObjectURL(file);

      newTracks.push({
        id: generateId('local_tr'),
        playlistId: playlistId || 'local_playlist',
        title,
        artist,
        album: 'File Musik Lokal',
        duration: 180, // will update on metadata load
        coverUrl: '/assets/logo.png',
        hasAudio: true,
        audioUrl,
        audioType: 'local',
        offline: true,
        localFileName: file.name
      });
    }

    await dbManager.saveTracksBatch(newTracks);

    // Update playlist count
    const pl = await dbManager.getPlaylist(playlistId);
    if (pl) {
      pl.trackCount = (pl.trackCount || 0) + newTracks.length;
      await dbManager.savePlaylist(pl);
    }

    Toast.success(`${newTracks.length} file lokal ditambahkan ke playlist.`, 'Lagu Ditambahkan');
    return newTracks;
  }

  /**
   * Search Legal / Creative Commons Catalog for free audio match
   * Uses Jamendo CC Music API (free legal streaming)
   */
  async searchLegalAudioStream(track) {
    const query = `${track.title} ${track.artist}`.trim();
    try {
      const clientId = 'c5cbb7d0'; // Public Jamendo client id for free open CC catalog
      const url = `https://api.jamendo.com/v3.0/tracks/?client_id=${clientId}&format=jsonpretty&limit=5&namesearch=${encodeURIComponent(track.title)}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error('Pencarian Jamendo tidak merespons');

      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const topResult = data.results[0];
        const audioStream = topResult.audio;

        if (audioStream) {
          track.hasAudio = true;
          track.audioUrl = audioStream;
          track.audioType = 'stream';
          track.licenseNote = 'Creative Commons via Jamendo';
          await dbManager.saveTrack(track);

          Toast.success(`Sumber audio legal ditemukan untuk "${track.title}"!`, 'Audio Ditemukan');
          return track;
        }
      }
    } catch (e) {
      console.warn('[AudioSources] Legal API lookup error:', e);
    }

    Toast.info(`Tidak ditemukan audio berlisensi bebas untuk "${track.title}". Tautkan file MP3 dari perangkat Anda.`, 'Sumber Belum Tersedia');
    return null;
  }
}

export const audioSourcesManager = new AudioSourcesManager();
