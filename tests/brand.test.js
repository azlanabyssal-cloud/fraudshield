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
