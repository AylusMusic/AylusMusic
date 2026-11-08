/**
 * AylusMusic Service Worker
 * Versioned app shell caching, audio cache storage, and offline capabilities.
 */

const CACHE_VERSION = 'aylus-music-v1.0.0';
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const AUDIO_CACHE = 'aylus-audio-cache';
const COVERS_CACHE = 'aylus-covers-cache';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  '/assets/logo.png',
  '/assets/icon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/css/variables.css',
  '/css/base.css',
  '/css/components.css',
  '/css/screens.css',
  '/js/app.js',
  '/js/router.js',
  '/js/ui.js',
  '/js/toast.js',
  '/js/auth.js',
  '/js/firebase.js',
  '/js/db.js',
  '/js/player.js',
  '/js/audio-engine.js',
  '/js/library.js',
  '/js/spotify.js',
  '/js/audio-sources.js',
  '/js/storage-manager.js',
  '/js/settings.js',
  '/js/utils.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      // Precache what is available without failing if an individual asset is missing
      for (const asset of SHELL_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn(`[SW] Precache skipped for ${asset}:`, err.message);
        }
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== SHELL_CACHE && key !== AUDIO_CACHE && key !== COVERS_CACHE) {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignore chrome-extension or non-http requests
  if (!url.protocol.startsWith('http')) return;

  // Audio files: Check audio cache first
  if (url.pathname.endsWith('.mp3') || url.pathname.endsWith('.opus') || url.pathname.endsWith('.m4a') || url.pathname.endsWith('.ogg') || url.searchParams.has('audio')) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const networkResponse = await fetch(event.request);
          // Only cache successful standard audio responses
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch (err) {
          return new Response('Audio offline not available', { status: 503, statusText: 'Offline' });
        }
      })
    );
    return;
  }

  // Cover images / external artwork
  if (url.pathname.includes('/covers/') || url.hostname.includes('scdn.co') || url.hostname.includes('spotifycdn.com') || url.hostname.includes('jamendo.com')) {
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

  // Firebase auth & firestore APIs: network only (Firestore handles its own IndexedDB offline caching)
  if (url.hostname.includes('firestore.googleapis.com') || url.hostname.includes('identitytoolkit.googleapis.com') || url.hostname.includes('firebaseio.com')) {
    return;
  }

  // Standard app shell navigation & assets: Cache first, fall back to network, fall back to cached /
  event.respondWith(
    caches.match(event.request).then(async (cachedResponse) => {
      if (cachedResponse) {
        // Stale-while-revalidate for background updates
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
            caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {/* offline */});
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
        // If navigation request fails, return cached index.html
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
