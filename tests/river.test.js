'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const R = require('../lib/river.js');
const F = require('../lib/flow.js');
const Motion = require('../lib/motion.js');

const near = (a, b, tol = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} expected ${b}, got ${a}`);

test('the water edge slides between item centres, clamps at both ends, and is never NaN', () => {
  const ys = [30, 130, 330];
  assert.equal(R.headAt(ys, 0), 30); assert.equal(R.headAt(ys, 1), 130); assert.equal(R.headAt(ys, 2), 330);
  near(R.headAt(ys, 0.5), 80); near(R.headAt(ys, 1.25), 180);
  assert.equal(R.headAt(ys, -3), 30); assert.equal(R.headAt(ys, 9), 330); assert.equal(R.headAt(ys, NaN), 30); assert.equal(R.headAt([], 1), 0); assert.equal(R.headAt([7], 4), 7);
});

test('the edge never runs backwards as progress grows, and reaches each item centre exactly when that item is half awake', () => {
  const ys = [30, 130, 330, 400], n = ys.length; let prev = -1;
  for (let p = 0; p <= 1.0001; p += 0.004) { const h = R.headAt(ys, F.front(p, n)); assert.ok(h >= prev - 1e-9); prev = h; }
  ys.forEach((y, i) => { const p = (i + F.LEAD) / (n - 1 + 2 * F.LEAD); near(R.headAt(ys, F.front(p, n)), y, 1e-6); near(F.activation(p, n)[i], 0.5, 1e-9); });
});

function page(n = 8) {
  const html = '<ol class="rail">' + Array.from({ length: n }, () => '<li class="it"><span class="node"></span></li>').join('') + '</ol>';
  const dom = new JSDOM(html), win = dom.window, el = win.document.querySelector('.rail'), items = [...el.children];
  items.forEach((it, i) => Object.defineProperty(it, 'offsetTop', { value: i * 100 })); items.forEach(it => Object.defineProperty(it.firstChild, 'offsetHeight', { value: 60 }));
  Object.defineProperty(win, 'innerHeight', { value: 768 });
  return { win, el, items };
}
function clock(reduced = false) {
  let queue = [], id = 0, t = 0;
  const env = { raf: cb => { queue.push({ id: ++id, cb }); return id; }, caf: h => { queue = queue.filter(q => q.id !== h); }, now: () => t, reduced: () => reduced };
  return { env, run: s => { for (let i = 0; i < Math.round(60 * s); i++) { t += 1000 / 60; const q = queue; queue = []; q.forEach(j => j.cb(t)); } } };
}

test('mount writes the edge in pixels from the real item centres, lights items as the water reaches them, and reports the count', () => {
  const { win, el, items } = page(), c = clock(), seen = []; let top = 400;
  el.getBoundingClientRect = () => ({ top, height: 800 });
  const m = R.mount(el, { items, Motion: { ...Motion, engine: Motion.createEngine(c.env) }, win, litClass: 'is-on', drop: true, centre: it => it.firstChild.offsetHeight / 2, onLit: (k, n, last) => seen.push([k, n, last && last.className]) });
  assert.ok(m && el.classList.contains('river-armed')); assert.ok(el.querySelector('.river-drop'), 'the droplet exists');
  const head0 = parseFloat(el.style.getPropertyValue('--head')); assert.ok(head0 >= 30 && head0 < 700);
  top = -3000; win.dispatchEvent(new win.Event('scroll')); c.run(4);
  near(parseFloat(el.style.getPropertyValue('--head')), 730, 0.5, 'the full run ends on the last node centre (700 + 30)');
  assert.ok(items.every(it => it.classList.contains('is-on')) && el.style.getPropertyValue('--drop') === '0');
  assert.deepEqual(seen[seen.length - 1].slice(0, 2), [8, 8]); assert.ok(seen.every((s, i) => i === 0 || s[0] !== seen[i - 1][0]), 'reports only when the count changes');
  top = 900; win.dispatchEvent(new win.Event('scroll')); c.run(4);
  assert.ok(!items.some(it => it.classList.contains('is-on')), 'scrolling back up drains it'); assert.equal(seen[seen.length - 1][0], 0);
  m.destroy(); assert.ok(!el.classList.contains('river-armed') && !el.querySelector('.river-drop'));
});

test('it does nothing under Reduce Motion, without an engine, or with fewer than two items', () => {
  const a = page(); a.el.getBoundingClientRect = () => ({ top: 0, height: 400 });
  assert.equal(R.mount(a.el, { items: a.items, Motion: { ...Motion, engine: Motion.createEngine(clock(true).env) }, win: a.win }), null); assert.ok(!a.el.classList.contains('river-armed'));
  assert.equal(R.mount(a.el, { items: a.items, Motion: null, win: a.win }), null);
  const b = page(1); assert.equal(R.mount(b.el, { items: b.items, Motion: { ...Motion, engine: Motion.createEngine(clock().env) }, win: b.win }), null);
});
