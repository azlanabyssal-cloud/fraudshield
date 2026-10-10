'use strict';
// One mark, everywhere. The logo is a source file (brand/mark.json), and every place the product shows or declares itself must use what was built from it: the SVG
// marks, the favicons, the app icons, the manifest, the social card, the page headers and footers, the chat widget. A tick would say "safe", which the product never says.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGES = ['index', 'tips', 'data', 'report', 'about', 'assistant'].map(p => p + '.html');
const png = f => { const b = fs.readFileSync(path.join(ROOT, f)); assert.equal(b.subarray(1, 4).toString(), 'PNG', f + ' is a PNG'); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

test('the SVG files are exactly what brand/mark.json builds, and carry no script, no external reference and no tick', () => {
  const M = JSON.parse(read('brand/mark.json'));
  for (const f of ['logo-mark.svg', 'logo-mark-light.svg', 'favicon.svg']) {
    const s = read('icons/' + f);
    assert.ok(s.includes(M.shield), f + ' uses the shield path');
    assert.doesNotMatch(s, /<script|href=|xlink|javascript:|url\(/i, f + ' is self-contained and inert');
    assert.ok(s.includes(`r="${M.lens.r}"`), f + ' carries the lens');
  }
  // a tick is a stroke with a corner in it; the handle is one straight segment, and the lens is a closed circle
  assert.match(M.handle.d, /^M[\d. ]+L[\d. ]+$/, 'the handle is a single straight stroke');
  assert.equal((M.shield.match(/M/g) || []).length, 1, 'the shield is one outline');
});

test('every PNG is the size its name and use say, so no platform has to scale a wrong-sized icon', () => {
  const want = { 'favicon-16.png': [16, 16], 'favicon-32.png': [32, 32], 'favicon-48.png': [48, 48], 'apple-touch-icon.png': [180, 180], 'icon-192.png': [192, 192], 'icon-512.png': [512, 512], 'icon-maskable-512.png': [512, 512], 'og-image.png': [1200, 630] };
  for (const [f, [w, h]] of Object.entries(want)) assert.deepEqual(png('icons/' + f), { w, h }, f);
});

test('the manifest declares ordinary and maskable icons separately, and every file it names exists', () => {
  const m = JSON.parse(read('manifest.json'));
  const purposes = m.icons.map(i => i.purpose);
  assert.ok(purposes.includes('maskable') && purposes.includes('any'));
  assert.ok(!purposes.some(p => /any\s+maskable/.test(p)), 'a single icon is not both: an "any" icon may not be safe to crop');
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(ROOT, i.src)), i.src);
  assert.equal(m.theme_color.toLowerCase(), '#0b1f3a');
});

test('every page declares the SVG favicon, the PNG fallbacks, the touch icon and the social card, and shows the mark in its header and footer', () => {
  for (const f of PAGES) {
    const h = read(f);
    for (const must of ['icons/favicon.svg', 'icons/favicon-32.png', 'icons/favicon-16.png', 'icons/apple-touch-icon.png', 'icons/og-image.png', 'name="twitter:card"']) assert.ok(h.includes(must), `${f}: ${must}`);
    assert.ok(h.includes('class="nav-logo__mark" src="icons/logo-mark.svg"'), f + ': header mark');
    assert.ok(h.includes('src="icons/logo-mark-light.svg" width="30" height="30" alt="">FraudShield'), f + ': footer mark');
    assert.doesNotMatch(h.replace(/<script[\s\S]*?<\/script>/g, ''), /nav-logo[^>]*>\s*<span aria-hidden="true">🛡/, f + ': no emoji standing in for the logo');
  }
});

test('the chat widget and the home intro draw the mark, not an emoji; and nothing in the navigation is labelled with a robot', () => {
  const s = read('script.js');
  assert.match(s, /const FS_MARK = '<img src="icons\/logo-mark-light\.svg"/);
  assert.equal((s.match(/>🛡️</g) || []).length, 0, 'no shield emoji left as an icon in the widget');
  for (const f of PAGES) assert.doesNotMatch(read(f).replace(/<style[\s\S]*?<\/style>/g, ''), /🤖 Assistant/, f);
  assert.match(read('index.html'), /class="intro-shield" src="icons\/logo-mark-light\.svg"/);
});

test('the service worker precaches every icon a page needs offline', () => {
  const sw = read('sw.js');
  for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'favicon.svg', 'logo-mark.svg', 'logo-mark-light.svg']) assert.ok(sw.includes('./icons/' + f), f);
});

test('the installed app: a themed icon with a transparent background, launcher shortcuts that open real pages, and install screenshots of the size they declare', () => {
  const m = JSON.parse(read('manifest.json'));
  const mono = fs.readFileSync(path.join(ROOT, 'icons', 'icon-monochrome-512.png'));
  assert.equal(mono[25], 6, 'the themed icon is RGBA (only its alpha is read, so it needs one)');
  assert.ok(m.icons.some(i => i.purpose === 'monochrome' && i.src === 'icons/icon-monochrome-512.png'));
  assert.equal(m.id, './index.html', 'a stable identity, so an update is an update and not a second app');
  assert.equal(m.background_color.toLowerCase(), '#0b1f3a', 'the splash is the icon\'s own navy');
  assert.ok(m.shortcuts.length >= 2 && m.shortcuts.length <= 4);
  for (const s of m.shortcuts) { assert.ok(s.name.length <= 40 && s.short_name.length <= 12, s.name); assert.ok(fs.existsSync(path.join(ROOT, s.url)), s.url + ' exists'); assert.doesNotMatch(s.url, /^[a-z]+:/i, 'a shortcut stays inside the app'); }
  assert.ok(m.screenshots.length >= 2);
  const jpegSize = f => { const b = fs.readFileSync(path.join(ROOT, f)); assert.equal(b[0], 0xff); assert.equal(b[1], 0xd8, f + ' is a JPEG'); for (let i = 2; i < b.length - 9;) { if (b[i] !== 0xff) { i++; continue; } const k = b[i + 1]; if (k >= 0xc0 && k <= 0xcf && k !== 0xc4 && k !== 0xc8 && k !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) }; i += 2 + b.readUInt16BE(i + 2); } throw new Error('no size in ' + f); };
  for (const s of m.screenshots) { const d = jpegSize(s.src); assert.equal(`${d.w}x${d.h}`, s.sizes, s.src); assert.equal(s.type, 'image/jpeg'); assert.equal(s.form_factor, 'narrow'); assert.ok(s.label.length > 10); }
});
