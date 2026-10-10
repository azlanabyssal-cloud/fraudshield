'use strict';
// The post-deploy check is itself tested: it must pass on the site as assembled, and it must fail, naming the file, when something a page needs is gone,
// when the service worker is stale, and when the host cannot seek the video.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const A = require('../scripts/assemble_site.js');
const { check } = require('../scripts/smoke_live.js');

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.vtt': 'text/vtt', '.jpg': 'image/jpeg' };
function serve(dir, { ranges = true } = {}) {
  const s = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname), file = path.join(dir, p === '/' ? 'index.html' : p);
    if (!file.startsWith(dir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('no'); return; }
    const buf = fs.readFileSync(file), type = TYPES[path.extname(file)] || 'application/octet-stream', m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (m && ranges) { const a = +m[1], b = m[2] ? +m[2] : buf.length - 1; res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${buf.length}`, 'Content-Length': b - a + 1, 'Accept-Ranges': 'bytes' }); res.end(buf.subarray(a, b + 1)); return; }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': buf.length }); res.end(buf);
  });
  return new Promise(r => s.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${s.address().port}/`, close: () => s.close() })));
}

const site = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-smoke-'));
A.assemble(site);
const cacheName = /CACHE_NAME = '([^']+)'/.exec(fs.readFileSync(path.join(site, 'sw.js'), 'utf8'))[1];

test('the assembled site passes, with the service worker at the version it was built as', async () => {
  const s = await serve(site);
  try { assert.deepEqual(await check(s.url, { expectCache: cacheName }), []); } finally { s.close(); }
});

test('it fails and names the problem: a missing asset, a stale service worker, a host that cannot seek the video', async () => {
  const s = await serve(site);
  try {
    const stale = await check(s.url, { expectCache: 'fraudshield-v0' });
    assert.ok(stale.some(p => /sw\.js: cache name is not fraudshield-v0/.test(p)), stale.join('\n'));
  } finally { s.close(); }
  const s2 = await serve(site, { ranges: false });
  try { assert.ok((await check(s2.url)).some(p => /range request answered 200, not 206/.test(p))); } finally { s2.close(); }
  const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-smoke-b-')); fs.cpSync(site, broken, { recursive: true });
  fs.rmSync(path.join(broken, 'style.css'));
  const s3 = await serve(broken);
  try { assert.ok((await check(s3.url)).some(p => /style\.css: HTTP 404/.test(p))); } finally { s3.close(); fs.rmSync(broken, { recursive: true, force: true }); }
});

test('after the run the temp copy is removed', () => { fs.rmSync(site, { recursive: true, force: true }); assert.ok(!fs.existsSync(site)); });
