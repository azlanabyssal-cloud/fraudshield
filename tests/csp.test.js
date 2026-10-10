'use strict';
// The promise is "nothing leaves your device". These tests hold the page to it: one policy on every page, no way around it, and every
// resource the pages ask for is something the policy allows. (tests/hardening.test.js covers the failure modes; the real-browser proof is in docs/SECURITY.md.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const PAGES = ['index', 'tips', 'data', 'assistant', 'report', 'about'].map(p => p + '.html');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const policy = read('partials/csp.txt').trim();
const directives = Object.fromEntries(policy.split(';').map(d => d.trim()).filter(Boolean).map(d => { const [n, ...v] = d.split(/\s+/); return [n, v]; }));
const doc = f => new JSDOM(read(f)).window.document;

// May a URL load under directive `dir`? (the subset of CSP matching this site needs: 'self', schemes, exact hosts)
function allowed(dir, url, base = 'https://site.test/') {
  const src = directives[dir] || directives['default-src'] || [], u = new URL(url, base);
  return src.some(s => s === "'self'" ? u.origin === new URL(base).origin : /^[a-z]+:$/.test(s) ? u.protocol === s : /^https?:\/\//.test(s) ? u.origin === new URL(s).origin : false);
}

test('every page carries the one shared policy, as the first thing after the charset, and a no-referrer policy', () => {
  for (const f of PAGES) {
    const d = doc(f), metas = [...d.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')];
    assert.equal(metas.length, 1, f); assert.equal(metas[0].getAttribute('content'), policy, f + ' uses partials/csp.txt exactly');
    const head = [...d.head.children].filter(e => e.tagName !== 'SCRIPT' || true); assert.equal(head[0].getAttribute('charset'), 'UTF-8'); assert.equal(head[1], metas[0], f + ': the policy comes before anything that could load');
    assert.equal(d.querySelector('meta[name="referrer"]').getAttribute('content'), 'no-referrer', f);
  }
});

test('the policy has no way round it: no eval, no inline scripts, no wildcards, no plain http, connections only to this site', () => {
  assert.deepEqual(directives['default-src'], ["'self'"]);
  assert.deepEqual(directives['connect-src'], ["'self'", 'data:'], 'the page can only talk to itself; data: is local (the reader\'s WebAssembly core loads itself from one) and cannot carry anything off the device');
  assert.deepEqual(directives['script-src'], ["'self'", "'wasm-unsafe-eval'"], 'wasm-unsafe-eval is for the text reader only; there is no eval and no inline script');
  assert.deepEqual(directives['font-src'], ["'self'"]); assert.deepEqual(directives['object-src'], ["'none'"]); assert.deepEqual(directives['frame-src'], ["'none'"]);
  assert.deepEqual(directives['base-uri'], ["'self'"]); assert.deepEqual(directives['form-action'], ["'self'"]); assert.deepEqual(directives['manifest-src'], ["'self'"]);
  assert.ok('upgrade-insecure-requests' in directives);
  assert.ok(!/\*/.test(policy) && !/\bhttp:/.test(policy), 'no wildcard and no plain http');
  assert.ok(!/'unsafe-eval'/.test(policy)); assert.ok(!directives['script-src'].includes("'unsafe-inline'"));
  assert.deepEqual(directives['img-src'].filter(s => /^https?:/.test(s)), ['https://images.unsplash.com'], 'the only outside host is the photo provider; remove it when the last Unsplash image is replaced');
  assert.deepEqual(directives['style-src'], ["'self'", "'unsafe-inline'"], 'inline styles are allowed (style attributes drive the animations); styles cannot run code');
});

test('no page has an inline script, an inline event handler or a javascript: link, so the strict script policy breaks nothing', () => {
  for (const f of PAGES) {
    const d = doc(f);
    for (const s of d.querySelectorAll('script')) { const t = s.getAttribute('type'); assert.ok(s.getAttribute('src') || /json/.test(t || ''), `${f}: inline executable script`); }
    for (const el of d.querySelectorAll('*')) for (const a of el.attributes) assert.ok(!/^on/i.test(a.name), `${f}: <${el.tagName.toLowerCase()} ${a.name}>`);
    for (const a of d.querySelectorAll('[href],[src],[action]')) assert.ok(!/^\s*javascript:/i.test(a.getAttribute('href') || a.getAttribute('src') || a.getAttribute('action')), f + ' javascript: URL');
  }
});

test('every resource a page loads on its own is permitted by the directive that governs it (stylesheets, scripts, images, fonts, icons, manifest)', () => {
  const problems = [];
  for (const f of PAGES) {
    const d = doc(f), check = (dir, url, what) => { if (url && !url.startsWith('#') && !allowed(dir, url)) problems.push(`${f}: ${what} ${url} is not allowed by ${dir}`); };
    d.querySelectorAll('script[src]').forEach(e => check('script-src', e.getAttribute('src'), 'script'));
    d.querySelectorAll('img[src]').forEach(e => check('img-src', e.getAttribute('src'), 'img'));
    d.querySelectorAll('link[href]').forEach(e => { const rel = (e.getAttribute('rel') || '').toLowerCase(), h = e.getAttribute('href'); if (/^(canonical|alternate|author|license|next|prev)$/.test(rel)) return;   // metadata, never fetched
    check(rel === 'stylesheet' ? 'style-src' : rel === 'manifest' ? 'manifest-src' : rel === 'preload' && e.getAttribute('as') === 'font' ? 'font-src' : /icon/.test(rel) ? 'img-src' : 'default-src', h, 'link ' + rel); });
    // a video is loaded by media-src, its poster by img-src; it must be click-to-play (no autoplay, nothing fetched before the person asks) and carry captions
    d.querySelectorAll('video').forEach(v => {
      check('img-src', v.getAttribute('poster'), 'video poster');
      v.querySelectorAll('source[src],track[src]').forEach(e => check('media-src', e.getAttribute('src'), e.tagName.toLowerCase()));
      if (v.hasAttribute('autoplay') || v.getAttribute('preload') !== 'none') problems.push(`${f}: a video must not autoplay or preload`);
      if (!v.querySelector('track[kind="captions"]')) problems.push(`${f}: a video needs a captions track`);
    });
    d.querySelectorAll('iframe,embed,object,audio').forEach(e => problems.push(`${f}: unexpected <${e.tagName.toLowerCase()}>`));
    d.querySelectorAll('source').forEach(e => { if (!e.closest('video')) problems.push(`${f}: unexpected <source> outside a video`); });
  }
  for (const f of ['style.css', 'about.css', 'hero-scene.css', 'motion.css', 'fonts/fonts.css', 'index.html']) for (const m of read(f).matchAll(/url\(\s*['"]?(?!data:)([^'")\s]+)/g)) { if (/^https?:/.test(m[1]) && !allowed(f.endsWith('fonts.css') ? 'font-src' : 'img-src', m[1])) problems.push(`${f}: url(${m[1]}) is not allowed`); }
  assert.deepEqual(problems, []);
});

test('the code itself never asks for another origin: no fetch, beacon, XHR, WebSocket, EventSource, import or worker URL points off-site', () => {
  const files = ['script.js', 'home.js', 'sw.js', ...fs.readdirSync(path.join(ROOT, 'lib')).filter(f => f.endsWith('.js')).map(f => 'lib/' + f)], problems = [];
  for (const f of files) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (const m of src.matchAll(/\b(fetch|sendBeacon|XMLHttpRequest|WebSocket|EventSource|importScripts|Worker)\b\s*\(?[^;\n]{0,160}/g)) if (/https?:\/\//.test(m[0])) problems.push(`${f}: ${m[0].slice(0, 90)}`);
    if (/\.open\(\s*['"][A-Z]+['"]\s*,\s*['"]https?:/.test(src)) problems.push(f + ': XHR to an absolute URL');
  }
  assert.deepEqual(problems, []);
});

test('fonts are served from this site: no Google Fonts anywhere, every face file exists, and the pages load fonts.css', () => {
  for (const f of [...PAGES, 'style.css', 'about.css', 'hero-scene.css', 'script.js', 'home.js']) assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(read(f)), f + ' still points at Google Fonts');
  const css = read('fonts/fonts.css'), files = [...css.matchAll(/url\('([^']+)'\)/g)].map(m => m[1]);
  assert.ok(files.length >= 8); for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, 'fonts', f)), f);
  for (const f of PAGES) assert.ok(doc(f).querySelector('link[rel="stylesheet"][href="fonts/fonts.css"]'), f);
  for (const fam of ['DM Sans', 'Playfair Display', 'JetBrains Mono']) assert.ok(css.includes(`font-family: '${fam}'`), fam);
  assert.ok(/U\+20A0-20AB, U\+20AD-20C0/.test(css), 'the Latin-extended faces are kept: the rupee sign U+20B9 lives there');
  const sw = read('sw.js'); for (const f of files) assert.ok(sw.includes(`'./fonts/${f}'`), f + ' is precached for offline use');
});

test('the policy renderer refuses a policy that would reopen the holes', () => {
  const sync = require('../scripts/sync_site.js'), data = sync.loadData();
  const bad = p => { const d = { ...data, partials: { ...data.partials, csp: p } }; return () => sync.syncRegions('<!-- @gen:csp -->\n<!-- @/gen:csp -->', d, 'home'); };
  assert.throws(bad("default-src *; script-src 'self'"), /default-src/);
  assert.throws(bad("default-src 'self'; script-src 'self' 'unsafe-eval'"), /eval/);
  assert.throws(bad("default-src 'self'; script-src 'self' 'unsafe-inline'"), /inline/);
  assert.doesNotThrow(bad("default-src 'self'; script-src 'self' 'wasm-unsafe-eval'"));
});
