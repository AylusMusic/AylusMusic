interface YouTubeTrack {
  id: string;
  youtubeId: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverUrl: string;
  hasAudio: boolean;
  audioUrl: string;
  audioType: string;
}

function parseDurationText(str?: string): number {
  if (!str) return 210; // default 3:30
  const parts = str.split(':').map(p => parseInt(p, 10));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 210;
}

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const urlObj = new URL(req.url || '', 'http://localhost:3000');
    const query = urlObj.searchParams.get('q') || urlObj.searchParams.get('search');
    const playlistId = urlObj.searchParams.get('playlistId') || urlObj.searchParams.get('list');
    const videoId = urlObj.searchParams.get('videoId') || urlObj.searchParams.get('v');

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
    };

    // 1. YouTube Playlist Import
    if (playlistId) {
      const plUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
      const response = await fetch(plUrl, { headers });
      if (!response.ok) {
        return res.status(response.status).json({ error: `Gagal memuat playlist YouTube (${response.status})` });
      }

      const html = await response.text();
      const match = html.match(/var ytInitialData = ({[\s\S]*?});<\/script>/);
      if (!match) {
        return res.status(404).json({ error: 'Data playlist YouTube tidak ditemukan' });
      }

      const data = JSON.parse(match[1]);
      const title = data?.metadata?.playlistMetadataRenderer?.title || 'YouTube Music Playlist';

      const videos: YouTubeTrack[] = [];
      const seenIds = new Set<string>();

      function extractVideos(obj: any) {
        if (!obj || typeof obj !== 'object') return;
        
        // Match lockupViewModel (newest YouTube format)
        if (obj.lockupViewModel && obj.lockupViewModel.contentId) {
          const l = obj.lockupViewModel;
          const vid = l.contentId;
          if (!seenIds.has(vid)) {
            seenIds.add(vid);
            const vTitle = l.metadata?.lockupMetadataViewModel?.title?.content || 'Lagu YouTube';
            const vArtist = l.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content || 'Artis YouTube';
            const vThumb = l.contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
            videos.push({
              id: `yt_${vid}_${Date.now()}`,
              youtubeId: vid,
              title: vTitle,
              artist: vArtist,
              album: title,
              duration: 210,
              coverUrl: vThumb,
              hasAudio: true,
              audioUrl: `https://www.youtube.com/watch?v=${vid}`,
              audioType: 'youtube'
            });
          }
          return;
        }

        // Match playlistVideoRenderer (legacy YouTube format)
        if (obj.playlistVideoRenderer && obj.playlistVideoRenderer.videoId) {
          const v = obj.playlistVideoRenderer;
          const vid = v.videoId;
          if (!seenIds.has(vid)) {
            seenIds.add(vid);
            const vTitle = v.title?.runs?.[0]?.text || v.title?.simpleText || 'Lagu YouTube';
            const vArtist = v.shortBylineText?.runs?.[0]?.text || 'Artis YouTube';
            const dur = parseDurationText(v.lengthText?.simpleText);
            const vThumb = v.thumbnail?.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
            videos.push({
              id: `yt_${vid}_${Date.now()}`,
              youtubeId: vid,
              title: vTitle,
              artist: vArtist,
              album: title,
              duration: dur,
              coverUrl: vThumb,
              hasAudio: true,
              audioUrl: `https://www.youtube.com/watch?v=${vid}`,
              audioType: 'youtube'
            });
          }
          return;
        }

        for (const k of Object.keys(obj)) {
          extractVideos(obj[k]);
        }
      }

      extractVideos(data);

      return res.status(200).json({
        success: true,
        type: 'youtube_playlist',
        playlistId,
        name: title,
        coverUrl: videos[0]?.coverUrl || 'https://www.gstatic.com/youtube/media/ytm/images/favicon/favicon-144.png',
        trackCount: videos.length,
        tracks: videos
      });
    }

    // 2. YouTube Search or Resolution
    if (query) {
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query + ' audio')}`;
      const response = await fetch(searchUrl, { headers });
      if (!response.ok) {
        return res.status(response.status).json({ error: 'Gagal mencari musik di YouTube' });
      }

      const html = await response.text();
      const match = html.match(/var ytInitialData = ({[\s\S]*?});<\/script>/);
      if (!match) {
        return res.status(404).json({ error: 'Data pencarian YouTube tidak ditemukan' });
      }

      const data = JSON.parse(match[1]);
      const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

      const results: YouTubeTrack[] = [];
      for (const item of contents) {
        const v = item.videoRenderer;
        if (v && v.videoId) {
          const vid = v.videoId;
          const title = v.title?.runs?.[0]?.text || v.title?.simpleText || 'Lagu YouTube';
          const artist = v.ownerText?.runs?.[0]?.text || 'Artis YouTube';
          const dur = parseDurationText(v.lengthText?.simpleText);
          const thumb = v.thumbnail?.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;

          results.push({
            id: `yt_${vid}_${Date.now()}`,
            youtubeId: vid,
            title,
            artist,
            album: 'YouTube Music',
            duration: dur,
            coverUrl: thumb,
            hasAudio: true,
            audioUrl: `https://www.youtube.com/watch?v=${vid}`,
            audioType: 'youtube'
          });

          if (results.length >= 25) break;
        }
      }

      return res.status(200).json({
        success: true,
        query,
        count: results.length,
        tracks: results
      });
    }

    // 3. Single Video Info
    if (videoId) {
      return res.status(200).json({
        success: true,
        youtubeId: videoId,
        title: 'YouTube Track',
        artist: 'YouTube Music',
        duration: 210,
        coverUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        hasAudio: true,
        audioUrl: `https://www.youtube.com/watch?v=${videoId}`,
        audioType: 'youtube'
      });
    }

    return res.status(400).json({ error: 'Harap sertakan parameter "q" (cari) atau "list" (playlist) YouTube.' });
  } catch (error: any) {
    console.error('Error handling YouTube API:', error);
    return res.status(500).json({ error: error.message || 'Terjadi kesalahan pada layanan YouTube Music' });
  }
}
