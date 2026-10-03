// Bump the version when this file changes, so phones drop the old cache.
const CACHE_NAME = 'akshay-traders-portal-v3';
// The app's code files. Their names change with every update, so a saved copy
// is never out of date and can be used without asking the server.
const ASSET_CACHE = 'akshay-traders-assets-v1';
// Room for the files of a few updates; the oldest saved files go first.
const MAX_ASSETS = 150;
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/pwa-icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const keep = [CACHE_NAME, ASSET_CACHE];
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !keep.includes(key)).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

async function trimAssets(cache) {
  const keys = await cache.keys();
  const extra = keys.length - MAX_ASSETS;
  if (extra > 0) await Promise.all(keys.slice(0, extra).map((key) => cache.delete(key)));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  // Database and other sites: never touch, the browser handles them directly.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages: always the newest from the server; the saved copy only when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // App code: from the phone when saved, else downloaded once and saved, so
  // the app opens fast and every page still opens without the internet.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const saved = await cache.match(request);
        if (saved) return saved;
        const response = await fetch(request);
        if (response.ok) {
          event.waitUntil(cache.put(request, response.clone()).then(() => trimAssets(cache)));
        }
        return response;
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
