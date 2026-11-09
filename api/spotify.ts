import type { IncomingMessage, ServerResponse } from 'http';

interface SpotifyTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverUrl: string;
  audioPreviewUrl: string;
  spotifyUri: string;
}

export default async function handler(req: any, res: any) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const urlObj = new URL(req.url || '', 'http://localhost:3000');
    const id = urlObj.searchParams.get('id') || '';
    const type = urlObj.searchParams.get('type') || 'playlist';

    if (!id) {
      return res.status(400).json({ error: 'Parameter "id" Spotify diperlukan' });
    }

    const embedUrl = `https://open.spotify.com/embed/${type}/${id}`;
    const response = await fetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });

    if (!response.ok) {
      // Fallback to oEmbed for metadata
      const oembedRes = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/${type}/${id}`);
      if (oembedRes.ok) {
        const odata = await oembedRes.json();
        return res.status(200).json({
          success: true,
          id,
          type,
          name: odata.title || 'Spotify Playlist',
          coverUrl: odata.thumbnail_url || '/assets/logo.png',
          trackCount: 0,
          tracks: []
        });
      }
      return res.status(response.status).json({ error: `Gagal memuat embed Spotify (HTTP ${response.status})` });
    }

    const html = await response.text();
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);

    if (!match) {
      return res.status(404).json({ error: 'Metadata Spotify tidak ditemukan pada halaman embed' });
    }

    const data = JSON.parse(match[1]);
    const entity = data?.props?.pageProps?.state?.data?.entity;

    if (!entity) {
      return res.status(404).json({ error: 'Entitas lagu/playlist tidak ditemukan' });
    }

    const name = entity.name || entity.title || 'Spotify Playlist';
    const coverUrl = entity.coverArt?.sources?.[0]?.url || '/assets/logo.png';
    const rawTracks = entity.trackList || [];

    const tracks: SpotifyTrack[] = rawTracks.map((t: any, idx: number) => ({
      id: `sp_${t.uid || t.id || idx}_${Date.now()}`,
      title: t.title || 'Lagu Tanpa Judul',
      artist: t.subtitle || (entity.subtitle || 'Artis Spotify'),
      album: entity.title || name,
      duration: Math.round((t.duration || 180000) / 1000),
      coverUrl,
      audioPreviewUrl: t.audioPreview?.url || '',
      spotifyUri: t.uri || `spotify:track:${t.id || ''}`
    }));

    return res.status(200).json({
      success: true,
      id,
      type,
      name,
      coverUrl,
      trackCount: tracks.length,
      tracks
    });
  } catch (error: any) {
    console.error('Error fetching Spotify data:', error);
    return res.status(500).json({ error: error.message || 'Terjadi kesalahan server saat memproses Spotify' });
  }
}
