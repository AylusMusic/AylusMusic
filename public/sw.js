/**
 * AylusMusic Service Worker
 * Resilient App Shell caching, audio cache storage, and offline capabilities.
 */

const CACHE_VERSION = 'aylus-music-v1.3.0';
const SHELL_CACHE = `aylus-shell-${CACHE_VERSION}`;
const AUDIO_CACHE = 'aylus-audio-cache';
const COVERS_CACHE = 'aylus-covers-cache';

// Essential root files that always exist across both bundled and unbundled deployments
const CORE_PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  '/assets/logo.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      // Safely fetch and cache only existing assets without throwing 404 console errors
      const cachePromises = CORE_PRECACHE_URLS.map(async (url) => {
        try {
          const response = await fetch(url);
          if (response && response.status === 200) {
            await cache.put(url, response);
          }
        } catch (err) {
          // Gracefully skip optional assets if offline during installation
        }
      });
      await Promise.allSettled(cachePromises);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== SHELL_CACHE && key !== AUDIO_CACHE && key !== COVERS_CACHE) {
            console.log('[SW] Deleting obsolete cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignore non-HTTP/HTTPS requests (chrome-extension, etc.)
  if (!url.protocol.startsWith('http')) return;

  // Ignore Firebase Auth, Google APIs, CDN ESM, and /api/* serverless endpoints
  if (url.pathname.startsWith('/api/') ||
      url.hostname.includes('firestore.googleapis.com') || 
      url.hostname.includes('identitytoolkit.googleapis.com') || 
      url.hostname.includes('securetoken.googleapis.com') ||
      url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('firebaseapp.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('google.com') ||
      url.hostname.includes('gstatic.com')) {
    return;
  }

  // 1. Audio stream/file caching
  if (url.pathname.endsWith('.mp3') || 
      url.pathname.endsWith('.opus') || 
      url.pathname.endsWith('.m4a') || 
      url.pathname.endsWith('.wav') || 
      url.pathname.endsWith('.ogg') || 
      url.searchParams.has('audio')) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const response = await fetch(event.request);
          if (response && response.status === 200) {
            cache.put(event.request, response.clone());
          }
          return response;
        } catch (err) {
          return new Response('Audio offline tidak tersedia', { status: 503, statusText: 'Offline' });
        }
      })
    );
    return;
  }

  // 2. Cover images & remote thumbnails
  if (url.pathname.includes('/covers/') || 
      url.hostname.includes('scdn.co') || 
      url.hostname.includes('spotifycdn.com') || 
      url.hostname.includes('jamendo.com') ||
      url.hostname.includes('pixabay.com')) {
    event.respondWith(
      caches.open(COVERS_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // 3. App Shell (HTML, Bundled JS/CSS, Fonts, Icons)
  event.respondWith(
    caches.match(event.request).then(async (cachedResponse) => {
      if (cachedResponse) {
        // Stale-while-revalidate in background
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
            caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }

      try {
        const networkResponse = await fetch(event.request);
        if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
          const clone = networkResponse.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      } catch (err) {
        // Offline fallback for navigation requests
        if (event.request.mode === 'navigate') {
          const fallback = await caches.match('/index.html') || await caches.match('/');
          if (fallback) return fallback;
        }
        throw err;
      }
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
