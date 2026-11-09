import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'music-api-middleware',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (!req.url) return next();

            if (req.url.startsWith('/api/spotify')) {
              try {
                const urlObj = new URL(req.url, 'http://localhost:3000');
                const id = urlObj.searchParams.get('id') || '';
                const type = urlObj.searchParams.get('type') || 'playlist';

                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');

                if (!id) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: 'Parameter "id" Spotify diperlukan' }));
                  return;
                }

                const embedUrl = `https://open.spotify.com/embed/${type}/${id}`;
                const response = await fetch(embedUrl, {
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
                  }
                });

                if (!response.ok) {
                  const oembedRes = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/${type}/${id}`);
                  if (oembedRes.ok) {
                    const odata = await oembedRes.json();
                    res.statusCode = 200;
                    res.end(JSON.stringify({
                      success: true,
                      id,
                      type,
                      name: odata.title || 'Spotify Playlist',
                      coverUrl: odata.thumbnail_url || '/assets/logo.png',
                      trackCount: 0,
                      tracks: []
                    }));
                    return;
                  }
                  res.statusCode = response.status;
                  res.end(JSON.stringify({ error: `Gagal memuat embed Spotify (HTTP ${response.status})` }));
                  return;
                }

                const html = await response.text();
                const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);

                if (!match) {
                  res.statusCode = 404;
                  res.end(JSON.stringify({ error: 'Metadata Spotify tidak ditemukan pada halaman embed' }));
                  return;
                }

                const data = JSON.parse(match[1]);
                const entity = data?.props?.pageProps?.state?.data?.entity;

                if (!entity) {
                  res.statusCode = 404;
                  res.end(JSON.stringify({ error: 'Entitas lagu/playlist tidak ditemukan' }));
                  return;
                }

                const name = entity.name || entity.title || 'Spotify Playlist';
                const coverUrl = entity.coverArt?.sources?.[0]?.url || '/assets/logo.png';
                const rawTracks = entity.trackList || [];

                const tracks = rawTracks.map((t: any, idx: number) => ({
                  id: `sp_${t.uid || t.id || idx}_${Date.now()}`,
                  title: t.title || 'Lagu Tanpa Judul',
                  artist: t.subtitle || (entity.subtitle || 'Artis Spotify'),
                  album: entity.title || name,
                  duration: Math.round((t.duration || 180000) / 1000),
                  coverUrl,
                  audioPreviewUrl: t.audioPreview?.url || '',
                  spotifyUri: t.uri || `spotify:track:${t.id || ''}`
                }));

                res.statusCode = 200;
                res.end(JSON.stringify({
                  success: true,
                  id,
                  type,
                  name,
                  coverUrl,
                  trackCount: tracks.length,
                  tracks
                }));
              } catch (err: any) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message || 'Server error' }));
              }
              return;
            }

            if (req.url.startsWith('/api/youtube')) {
              try {
                const urlObj = new URL(req.url, 'http://localhost:3000');
                const query = urlObj.searchParams.get('q') || urlObj.searchParams.get('search');
                const playlistId = urlObj.searchParams.get('playlistId') || urlObj.searchParams.get('list');
                const videoId = urlObj.searchParams.get('videoId') || urlObj.searchParams.get('v');

                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Access-Control-Allow-Origin', '*');

              const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
              };

              function parseDurationText(str?: string): number {
                if (!str) return 210;
                const parts = str.split(':').map(p => parseInt(p, 10));
                if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                  return parts[0] * 60 + parts[1];
                }
                if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
                  return parts[0] * 3600 + parts[1] * 60 + parts[2];
                }
                return 210;
              }

              // 1. YouTube Playlist Import
              if (playlistId) {
                const plUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
                const response = await fetch(plUrl, { headers });
                if (!response.ok) {
                  res.statusCode = response.status;
                  res.end(JSON.stringify({ error: `Gagal memuat playlist YouTube (${response.status})` }));
                  return;
                }

                const html = await response.text();
                const match = html.match(/var ytInitialData = ({[\s\S]*?});<\/script>/);
                if (!match) {
                  res.statusCode = 404;
                  res.end(JSON.stringify({ error: 'Data playlist YouTube tidak ditemukan' }));
                  return;
                }

                const data = JSON.parse(match[1]);
                const title = data?.metadata?.playlistMetadataRenderer?.title || 'YouTube Music Playlist';

                const videos: any[] = [];
                const seenIds = new Set<string>();

                function extractVideos(obj: any) {
                  if (!obj || typeof obj !== 'object') return;
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

                res.statusCode = 200;
                res.end(JSON.stringify({
                  success: true,
                  type: 'youtube_playlist',
                  playlistId,
                  name: title,
                  coverUrl: videos[0]?.coverUrl || 'https://www.gstatic.com/youtube/media/ytm/images/favicon/favicon-144.png',
                  trackCount: videos.length,
                  tracks: videos
                }));
                return;
              }

              // 2. YouTube Search or Resolution
              if (query) {
                const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query + ' audio')}`;
                const response = await fetch(searchUrl, { headers });
                if (!response.ok) {
                  res.statusCode = response.status;
                  res.end(JSON.stringify({ error: 'Gagal mencari musik di YouTube' }));
                  return;
                }

                const html = await response.text();
                const match = html.match(/var ytInitialData = ({[\s\S]*?});<\/script>/);
                if (!match) {
                  res.statusCode = 404;
                  res.end(JSON.stringify({ error: 'Data pencarian YouTube tidak ditemukan' }));
                  return;
                }

                const data = JSON.parse(match[1]);
                const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

                const results: any[] = [];
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

                res.statusCode = 200;
                res.end(JSON.stringify({
                  success: true,
                  query,
                  count: results.length,
                  tracks: results
                }));
                return;
              }

              // 3. Single Video ID
              if (videoId) {
                res.statusCode = 200;
                res.end(JSON.stringify({
                  success: true,
                  youtubeId: videoId,
                  title: 'YouTube Track',
                  artist: 'YouTube Music',
                  duration: 210,
                  coverUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                  hasAudio: true,
                  audioUrl: `https://www.youtube.com/watch?v=${videoId}`,
                  audioType: 'youtube'
                }));
                return;
              }

              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Parameter "q" atau "list" diperlukan' }));
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message || 'Server error' }));
            }
            return;
          }

          next();
        });
      }
    }
  ],
    resolve: {
      alias: {
        '@': import.meta.dirname || path.resolve('.'),
      },
    },
    build: {
      rollupOptions: {
        external: [/^https?:\/\//],
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
