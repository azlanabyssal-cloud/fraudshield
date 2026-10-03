'use strict';
// Runs the real sw.js in a sandbox with fake browser APIs and checks how it behaves online and offline.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

function boot() {
  const handlers = {}, cache = new Map(), calls = [];
  const imgs = new Map();
  const mk = map => ({
    put: async (req, res) => { map.set(typeof req === 'string' ? req : req.url, res); },
    match: async req => map.get(typeof req === 'string' ? new URL(req, 'https://site.test/').href : req.url),
    keys: async () => [...map.keys()].map(url => ({ url })), delete: async r => map.delete(typeof r === 'string' ? r : r.url), addAll: async () => {}
  });
  const store = {
    open: async name => (/img/.test(name) ? mk(imgs) : { ...mk(cache), match: async () => undefined }),
    match: async (req, opts) => {
      const url = typeof req === 'string' ? new URL(req, 'https://site.test/').href : req.url;
      for (const [k, v] of cache) if (k === url || (opts && opts.ignoreSearch && k.split('?')[0] === url.split('?')[0])) return v;
      return undefined;
    },
    keys: async () => [], delete: async () => true
  };
  const ctx = { self: { addEventListener: (t, fn) => { handlers[t] = fn; }, location: { origin: 'https://site.test' }, skipWaiting() {}, clients: { claim() {} } }, caches: store, URL, Promise, console,
    fetch: async (req, init) => { calls.push({ url: typeof req === 'string' ? req : req.url, init }); if (ctx.offline) throw new Error('offline'); return { status: 200, clone() { return this; }, tag: 'network:' + (typeof req === 'string' ? req : req.url) }; } };
  vm.runInNewContext(SRC, ctx);
  const request = (url, extra = {}) => ({ method: 'GET', url, mode: 'no-cors', ...extra });
  const ask = async req => { let p; handlers.fetch({ request: req, respondWith: x => { p = x; }, waitUntil() {} }); return p === undefined ? undefined : p; };
  return { ctx, calls, cache, imgs, ask, request, handlers };
}

test('same-origin code revalidates with the server instead of trusting the browser cache', async () => {
  const sw = boot();
  const res = await sw.ask(sw.request('https://site.test/style.css'));
  assert.equal(res.tag, 'network:https://site.test/style.css');
  assert.equal(sw.calls[0].init.cache, 'no-cache');   // fields are compared one by one: the object was made inside the sandbox
});

test('cross-origin requests (fonts) are not forced to bypass the cache', async () => {
  const sw = boot(); await sw.ask(sw.request('https://fonts.gstatic.com/x.woff2'));
  assert.equal(sw.calls[0].init, undefined);
});

test('icons are served cache-first', async () => {
  const sw = boot(); sw.cache.set('https://site.test/icons/icon-192.png', { tag: 'cached-icon' });
  const res = await sw.ask(sw.request('https://site.test/icons/icon-192.png'));
  assert.equal(res.tag, 'cached-icon'); assert.equal(sw.calls.length, 0, 'no network call when cached');
});

test('a successful response is stored, and used when the network is gone', async () => {
  const sw = boot(); await sw.ask(sw.request('https://site.test/script.js'));
  await new Promise(r => setImmediate(r));
  sw.ctx.offline = true;
  const res = await sw.ask(sw.request('https://site.test/script.js'));
  assert.equal(res.tag, 'network:https://site.test/script.js');
});

test('offline, a page with a cache-busting query still comes from the cache', async () => {
  const sw = boot(); sw.cache.set('https://site.test/data.html', { tag: 'cached-data' }); sw.ctx.offline = true;
  assert.equal((await sw.ask(sw.request('https://site.test/data.html?v=abc'))).tag, 'cached-data');
});

test('offline, a page that was never cached falls back to the home page instead of a browser error', async () => {
  const sw = boot(); sw.cache.set('https://site.test/index.html', { tag: 'cached-home' }); sw.ctx.offline = true;
  const res = await sw.ask(sw.request('https://site.test/never-visited.html', { mode: 'navigate' }));
  assert.equal(res.tag, 'cached-home');
});

test('non-GET requests are left alone', async () => {
  const sw = boot(); const res = await sw.ask(sw.request('https://site.test/report', { method: 'POST' }));
  assert.equal(res, undefined); assert.equal(sw.calls.length, 0);
});

test('every file the service worker precaches exists, and the cache name changes when the list does', () => {
  const list = [...SRC.matchAll(/'\.\/([^']*)'/g)].map(m => m[1]).filter(f => f && !f.endsWith('/'));
  const missing = list.filter(f => !fs.existsSync(path.join(__dirname, '..', f)));
  assert.deepEqual(missing, []);
  assert.match(SRC, /const CACHE_NAME = 'fraudshield-v\d+'/);
});

test('photos come from their own cache at once, and are refreshed from the network behind the scenes', async () => {
  const sw = boot(); sw.imgs.set('https://site.test/images/field/csp-home.webp', { tag: 'cached-photo' });
  const res = await sw.ask(sw.request('https://site.test/images/field/csp-home.webp'));
  assert.equal(res.tag, 'cached-photo'); await new Promise(r => setImmediate(r));
  assert.equal(sw.calls.length, 1, 'one background refresh'); assert.equal(sw.calls[0].init.cache, 'no-cache');
  await new Promise(r => setImmediate(r)); assert.equal(sw.imgs.get('https://site.test/images/field/csp-home.webp').tag, 'network:https://site.test/images/field/csp-home.webp', 'the cache now holds the fresh copy');
});

test('a photo seen for the first time is fetched, stored, and then served offline', async () => {
  const sw = boot(); const url = 'https://site.test/images/hero-tips.webp';
  assert.equal((await sw.ask(sw.request(url))).tag, 'network:' + url); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.ok(sw.imgs.has(url)); sw.ctx.offline = true;
  assert.equal((await sw.ask(sw.request(url))).tag, 'network:' + url, 'offline, the stored photo is shown');
});

test('the photo cache is capped, so it can never grow without limit', async () => {
  const sw = boot(); for (let i = 0; i < 70; i++) sw.imgs.set(`https://site.test/images/old-${i}.webp`, { tag: 'x' });
  await sw.ask(sw.request('https://site.test/images/new.webp')); for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));
  assert.ok(sw.imgs.size <= 60, `kept ${sw.imgs.size}`); assert.ok(sw.imgs.has('https://site.test/images/new.webp'), 'the newest stays'); assert.ok(!sw.imgs.has('https://site.test/images/old-0.webp'), 'the oldest goes');
});

test('on activation both current caches survive and every other one is deleted', async () => {
  const deleted = []; const sw = boot();
  sw.ctx.caches.keys = async () => ['fraudshield-v1', 'fraudshield-img-v1', 'x-other'];
  sw.ctx.caches.delete = async k => { deleted.push(k); return true; };
  const names = SRC.match(/const CACHE_NAME = '([^']+)'/)[1];
  sw.ctx.caches.keys = async () => ['fraudshield-v1', names, 'fraudshield-img-v1', 'x-other'];
  let done; sw.handlers.activate({ waitUntil: p => { done = p; } }); await done;
  assert.deepEqual(deleted.sort(), ['fraudshield-v1', 'x-other']);
});
