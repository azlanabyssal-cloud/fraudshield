'use strict';

// Bump this on every deploy that touches script.js/HTML/CSS. It's the only
// thing that forces old caches (and the stale code inside them) to be
// thrown out on activate — see the note below for why that matters.
const CACHE_NAME = 'fraudshield-v20';

const PRECACHE_URLS = [
  './',
  './index.html',
  './tips.html',
  './data.html',
  './report.html',
  './assistant.html',
  './about.html',
  './style.css',
  './hero-scene.css',
  './about.css',
  './fonts/fonts.css',
  './fonts/dm-sans-normal-latin.woff2',
  './fonts/dm-sans-normal-latin-ext.woff2',
  './fonts/playfair-display-normal-latin.woff2',
  './fonts/playfair-display-normal-latin-ext.woff2',
  './fonts/playfair-display-italic-latin.woff2',
  './fonts/playfair-display-italic-latin-ext.woff2',
  './fonts/jetbrains-mono-normal-latin.woff2',
  './fonts/jetbrains-mono-normal-latin-ext.woff2',
  './home.js',
  './motion.css',
  './lib/motion.js',
  './lib/motes.js',
  './lib/emotion.js',
  './lib/creatures.js',
  './lib/flow.js',
  './lib/river.js',
  './lib/linkcheck.js',
  './lib/urlmodel.js',
  './data/urlmodel.json',
  './lib/qr.js',
  './lib/imageprep.js',
  './lib/speech.js',
  './lib/ocrworker.js',
  './vendor/jsqr/jsQR.js',
  './lib/core.js',
  './lib/msgcheck.js',
  './lib/format.js',
  './lib/hero-scene.js',
  './vendor/chart/chart.umd.min.js',
  './script.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Truly static, content-hashed-by-convention assets — safe to serve from
// cache first since they never change without changing their filename/path.
const CACHE_FIRST_PATTERN = /\/icons\//;

// Photos are the heaviest thing on the site and almost never change, so they get their own cache: shown from it at once, refreshed
// in the background (stale-while-revalidate), and capped so it can never grow without limit. It is separate from the code cache so a
// code deploy does not throw away megabytes of pictures the visitor already has.
const IMG_CACHE = 'fraudshield-img-v1';
const IMG_LIMIT = 60;
const IMAGE_PATTERN = /\.(?:webp|png|jpe?g|avif|gif)$/i;

function trimImages(cache) {
  return cache.keys().then(keys => Promise.all(keys.slice(0, Math.max(0, keys.length - IMG_LIMIT)).map(k => cache.delete(k))));
}

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
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME && k !== IMG_CACHE).map(k => caches.delete(k))))
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

  if (isSameOrigin && IMAGE_PATTERN.test(url.pathname)) {
    event.respondWith(
      caches.open(IMG_CACHE).then(cache => cache.match(req).then(hit => {
        const refresh = fetch(req, { cache: 'no-cache' }).then(res => {
          if (res && res.status === 200) cache.put(req, res.clone()).then(() => trimImages(cache));
          return res;
        });
        if (hit) { refresh.catch(() => {}); if (event.waitUntil) event.waitUntil(refresh.catch(() => {})); return hit; }
        return refresh;
      }))
    );
    return;
  }

  // Network-first for everything else (HTML, scripts, styles, and cross-origin assets such as fonts): always serve the
  // live version when online, so a visitor is never stuck on yesterday's bug. For our own files the request goes out with
  // cache: 'no-cache', which revalidates with the server (a cheap conditional request) instead of trusting the browser's
  // 10-minute HTTP cache; without it a deploy stays invisible to returning visitors for up to ten minutes.
  // The cache is only the fallback for when the network genuinely is not there.
  const network = isSameOrigin ? fetch(req, { cache: 'no-cache' }) : fetch(req);
  event.respondWith(
    network
      .then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
