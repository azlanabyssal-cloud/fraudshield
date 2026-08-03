'use strict';

const CACHE_NAME = 'fraudshield-v1';
const PRECACHE_URLS = [
  './',
  './index.html',
  './tips.html',
  './data.html',
  './report.html',
  './assistant.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const isSameOrigin = new URL(req.url).origin === self.location.origin;

  // Stale-while-revalidate: serve from cache instantly if we have it, but
  // always refetch in the background so the cache — and the next offline
  // visit — stays current. Falls back to whichever succeeds if the other
  // is unavailable (offline → cache; first visit → network).
  event.respondWith(
    caches.match(req).then(cached => {
      const networkFetch = fetch(req)
        .then(res => {
          if (res && res.status === 200 && (isSameOrigin || res.type === 'cors' || res.type === 'basic')) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
