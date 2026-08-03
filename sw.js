'use strict';

// Bump this on every deploy that touches script.js/HTML/CSS. It's the only
// thing that forces old caches (and the stale code inside them) to be
// thrown out on activate — see the note below for why that matters.
const CACHE_NAME = 'fraudshield-v2';

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

// Truly static, content-hashed-by-convention assets — safe to serve from
// cache first since they never change without changing their filename/path.
const CACHE_FIRST_PATTERN = /\/icons\//;

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

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (isSameOrigin && CACHE_FIRST_PATTERN.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(cached => cached || fetch(req))
    );
    return;
  }

  // Network-first for everything else (HTML, script.js, style.css, and
  // cross-origin CDN assets): always serve the live version when online —
  // this is an actively developed site, and a visitor should never be stuck
  // looking at yesterday's bug just because a service worker cached it.
  // Cache is only a fallback for when the network genuinely isn't there.
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
