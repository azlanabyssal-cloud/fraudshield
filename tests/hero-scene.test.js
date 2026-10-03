'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const S = require('../lib/hero-scene.js');

const ROOT = path.join(__dirname, '..');
const BRANDS = /\b(sbi|hdfc|icici|axis|kotak|paytm|phonepe|google ?pay|gpay|amazon|flipkart|jio|airtel|bescom|tata|cbi|rbi|npci)\b/i;

test('every message is well-formed: flags occur in the text, never overlap, and labels fit a chip', () => {
  assert.ok(S.MESSAGES.length >= 6);
  for (const m of S.MESSAGES) {
    const segs = S.splitByFlags(m.text, m.flags);
    assert.equal(segs.map(x => x.text).join(''), m.text, 'splitting must not lose or add a character');
    assert.equal(segs.filter(x => x.label).length, m.flags.length);
    for (const [, label] of m.flags) assert.ok(label.length > 0 && label.length <= 32, label);
    assert.ok(m.x >= 0 && m.x <= 100 && m.y >= 0 && m.y <= 100 && m.d > 0 && m.d < 2);
  }
});

test('the illustrative messages name no real bank, brand or agency, and invent every domain', () => {
  for (const m of S.MESSAGES) assert.ok(!BRANDS.test(m.text + ' ' + m.who), `${m.who}: names a real brand or agency`);
  const domains = S.MESSAGES.flatMap(m => m.text.match(/\b[a-z0-9-]+\.(?:xyz|top)(?:\/\S*)?/g) || []);
  assert.ok(domains.length >= 2);
});

test('splitByFlags rejects a missing phrase and overlapping flags', () => {
  assert.throws(() => S.splitByFlags('hello world', [['absent', 'x']]), /not found/);
  assert.throws(() => S.splitByFlags('pay now please', [['pay now', 'a'], ['now please', 'b']]), /overlap/);
  assert.deepEqual(S.splitByFlags('a b c', [['b', 'L']]), [{ text: 'a ' }, { text: 'b', label: 'L' }, { text: ' c' }]);
});

test('the idle lens path always stays inside the hero, at any size and any time', () => {
  for (const [w, h] of [[1074, 940], [390, 700], [2000, 1100], [320, 480]]) {
    const m = Math.min(w, h) * 0.12;
    for (let t = 0; t < 600000; t += 1370) {
      const p = S.lensPosition(t, w, h);
      assert.ok(p.x >= m - 1e-6 && p.x <= w - m + 1e-6 && p.y >= m - 1e-6 && p.y <= h - m + 1e-6, `${w}x${h} t=${t} -> ${p.x},${p.y}`);
    }
  }
});

test('weak and narrow devices get fewer bubbles, never fewer than three', () => {
  assert.equal(S.bubbleCount(1280, {}), S.MESSAGES.length);
  assert.equal(S.bubbleCount(390, {}), 5);
  assert.ok(S.bubbleCount(1280, { cores: 2 }) <= 4); assert.ok(S.bubbleCount(1280, { memory: 1 }) <= 4);
  assert.ok(S.bubbleCount(200, { cores: 1, memory: 1 }) >= 3);
});

test('the page wires the scene in, caches it offline, leaves no photo in the hero, and keeps the intro untouched', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.match(html, /id="heroScene"/); assert.match(html, /hero-scene\.css/); assert.match(html, /lib\/hero-scene\.js/);
  assert.ok(!/class="hero-bg"/.test(html));
  assert.ok(sw.includes("'./hero-scene.css'") && sw.includes("'./lib/hero-scene.js'"));
  assert.ok(html.includes('id="introOverlay"') && html.includes('dismissIntro'), 'the intro must stay');
});

test('the stylesheet honours reduced motion and uses no backdrop-filter', () => {
  const css = fs.readFileSync(path.join(ROOT, 'hero-scene.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /prefers-reduced-motion: reduce/); assert.match(css, /\.hs--still/);
  assert.ok(!/backdrop-filter/.test(css));
});
