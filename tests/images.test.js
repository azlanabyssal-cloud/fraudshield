'use strict';
// Every image the site ships: the file exists, its declared size is its real size (so the layout never jumps), it has alt text, and it is not bloated.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const { PAGES } = require('../scripts/scan_numbers.js');

const ROOT = path.join(__dirname, '..');
const pages = PAGES.filter(p => fs.existsSync(path.join(ROOT, p)));

function dimensions(file) {                     // WebP (all three variants) and PNG: enough for what the site uses
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (kind === 'VP8L') { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
    if (kind === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  }
  if (b.toString('ascii', 1, 4) === 'PNG') return [b.readUInt32BE(16), b.readUInt32BE(20)];
  return null;
}
const local = src => src && !/^(https?:)?\/\//.test(src) && !src.startsWith('data:');
const imgs = [];
for (const page of pages) for (const img of new JSDOM(fs.readFileSync(path.join(ROOT, page), 'utf8')).window.document.querySelectorAll('img')) imgs.push({ page, src: img.getAttribute('src'), alt: img.getAttribute('alt'), w: img.getAttribute('width'), h: img.getAttribute('height'), loading: img.getAttribute('loading') });

test('every local image exists, and its declared width and height are its real ones', () => {
  const problems = [];
  for (const i of imgs.filter(i => local(i.src))) {
    const file = path.join(ROOT, i.src);
    if (!fs.existsSync(file)) { problems.push(`${i.page}: ${i.src} does not exist`); continue; }
    const real = dimensions(file);
    if (!real) { problems.push(`${i.page}: ${i.src} is not a WebP or PNG the test can read`); continue; }
    if (!i.w || !i.h) problems.push(`${i.page}: ${i.src} has no width and height (the page would jump as it loads)`);
    else if (+i.w !== real[0] || +i.h !== real[1]) problems.push(`${i.page}: ${i.src} declares ${i.w}x${i.h} but is ${real[0]}x${real[1]}`);
  }
  assert.deepEqual(problems, []);
});

test('every image has real alt text, written for the picture, not a keyword list or a stale claim', () => {
  const bad = imgs.filter(i => i.alt === null || (i.alt !== '' && i.alt.trim().length < 18) || /\b(dcn news|unsplash|stock|image of|picture of)\b/i.test(i.alt)).map(i => `${i.page}: ${i.src} alt="${i.alt}"`);
  assert.deepEqual(bad, []);
});

test('no local image is bloated: web files stay small (the full-frame field photos get 400 KB, everything else 260 KB)', () => {
  const big = []; const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const p = path.join(d, e.name); if (e.isDirectory() && !/node_modules|\.git|vendor|mlops|icons/.test(e.name)) walk(p); else if (/\.(webp|png|jpe?g)$/i.test(e.name) && fs.statSync(p).size > (/[\\/]field[\\/]/.test(p) ? 400 : 260) * 1024) big.push(`${path.relative(ROOT, p)} ${(fs.statSync(p).size / 1024) | 0} KB`); });
  walk(path.join(ROOT, 'images')); assert.deepEqual(big, []);
});

test('the images folder holds only images the site uses (nothing orphaned adds weight and risk)', () => {
  const used = new Set(imgs.filter(i => local(i.src)).map(i => i.src)), html = pages.map(p => fs.readFileSync(path.join(ROOT, p), 'utf8')).join('\n') + fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const orphans = []; const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { const rel = path.relative(ROOT, p).split(path.sep).join('/'); if (!used.has(rel) && !html.includes(rel) && !fs.readFileSync(path.join(ROOT, 'data', 'fieldwork.json'), 'utf8').includes(rel)) orphans.push(rel); } });
  walk(path.join(ROOT, 'images')); assert.deepEqual(orphans, []);
});

test('what still comes from a third-party image host is counted, so removing it is a tracked job rather than a surprise', () => {
  const external = imgs.filter(i => /^https?:/.test(i.src || '')).length;
  assert.ok(external <= 2, `${external} images still load from another site; the target is 0 (sextortion and investment cards)`);
});
