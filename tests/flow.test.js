'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const F = require('../lib/flow.js');
const Motion = require('../lib/motion.js');

const near = (a, b, tol = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} expected ${b}, got ${a}`);

test('the water starts empty, ends full, and reaches each circle exactly when that step is half awake', () => {
  for (const n of [2, 3, 4, 7]) {
    assert.deepEqual(F.activation(0, n).map(v => +v.toFixed(9)), new Array(n).fill(0)); assert.deepEqual(F.activation(1, n).map(v => +v.toFixed(9)), new Array(n).fill(1));
    assert.equal(F.fill(0, n), 0); assert.equal(F.fill(1, n), 1);
    for (let i = 0; i < n; i++) { const p = (i + F.LEAD) / (n - 1 + 2 * F.LEAD); near(F.front(p, n), i, 1e-9); near(F.activation(p, n)[i], 0.5, 1e-9, `step ${i} of ${n}`); near(F.fill(p, n), i / (n - 1), 1e-9); }
  }
});

test('steps wake in order: earlier steps are never less awake than later ones, and nothing ever runs backwards as you scroll down', () => {
  for (const n of [3, 4, 6]) {
    let prev = new Array(n).fill(0), prevFill = 0;
    for (let p = 0; p <= 1.0001; p += 0.005) {
      const s = F.activation(p, n), f = F.fill(p, n);
      s.forEach((v, i) => { assert.ok(v >= prev[i] - 1e-12 && v >= 0 && v <= 1, `step ${i} at ${p}`); if (i) assert.ok(s[i - 1] >= v - 1e-12, `order at ${p}`); });
      assert.ok(f >= prevFill - 1e-12 && f <= 1); prev = s; prevFill = f;
    }
  }
});

test('out-of-range progress is clamped, and a one-step sequence still behaves', () => {
  assert.deepEqual(F.activation(-5, 4), F.activation(0, 4)); assert.deepEqual(F.activation(9, 4), F.activation(1, 4)); assert.equal(F.fill(NaN, 3) >= 0, true);
  assert.equal(F.fill(0.4, 1), 0.4); assert.equal(F.activation(0.5, 1).length, 1);
});

test('scroll progress: empty as the block enters, full when its bottom is near 60% of the viewport, and the same rule on any screen', () => {
  for (const [vh, h] of [[800, 400], [800, 1600], [400, 700], [1200, 500]]) {
    assert.equal(F.progress(vh * 0.85, h, vh), 0); assert.equal(F.progress(vh * 2, h, vh), 0);
    const topAtFull = vh * 0.85 - (h + vh * 0.25); near(F.progress(topAtFull, h, vh), 1, 1e-9); assert.equal(F.progress(topAtFull - 500, h, vh), 1);
    near((topAtFull + h) / vh, 0.6, 1e-9, 'bottom of the block sits at 60% of the viewport when it completes');
  }
  assert.equal(F.progress(0, 0, 0), 0 + F.progress(0, 0, 0)); assert.ok(Number.isFinite(F.progress(0, 0, 0)));
});

/* ---------- mount ---------- */
function page(steps = 4) {
  const html = '<div class="funnel-grid">' + Array.from({ length: steps }, (_, i) => `<div class="funnel-step funnel-step--${i + 1}"></div>`).join('') + '</div>';
  const dom = new JSDOM(html); return { dom, win: dom.window, grid: dom.window.document.querySelector('.funnel-grid') };
}
function clock(reduced = false) {
  let queue = [], id = 0, t = 0;
  const env = { raf: cb => { queue.push({ id: ++id, cb }); return id; }, caf: h => { queue = queue.filter(q => q.id !== h); }, now: () => t, reduced: () => reduced };
  return { env, run: s => { for (let i = 0; i < Math.round(60 * s); i++) { t += 1000 / 60; const q = queue; queue = []; q.forEach(j => j.cb(t)); } } };
}
const values = grid => [...grid.querySelectorAll('.funnel-step')].map(el => parseFloat(el.style.getPropertyValue('--s')));

test('mount arms the sequence, starts where the page already is, and the water follows scrolling with a lag', () => {
  const { win, grid } = page(), c = clock(); let top = 475.2;   // progress 0.3 in a 768px window with a 400px block
  Object.defineProperty(win, 'innerHeight', { value: 768 }); grid.getBoundingClientRect = () => ({ top, height: 400 });
  const m = F.mount(grid, { Motion: { ...Motion, engine: Motion.createEngine(c.env) }, win });
  assert.ok(m && grid.classList.contains('flow-armed'));
  let s = values(grid); near(s[0], 1, 1e-3); assert.ok(s[1] > 0 && s[1] < 0.2); near(s[2], 0, 1e-3); near(s[3], 0, 1e-3);
  near(parseFloat(grid.style.getPropertyValue('--flow')), F.fill(0.3, 4), 1e-3, 'a reload halfway down starts there, not at zero');
  top = 356.8; win.dispatchEvent(new win.Event('scroll'));   // scroll to progress 0.5
  c.run(0.1); s = values(grid); assert.ok(s[2] < 0.2, 'right after the scroll the water has barely moved: it trails');
  c.run(2); s = values(grid); near(s[1], 1, 1e-2); near(s[2], 0, 1e-2); near(parseFloat(grid.style.getPropertyValue('--flow')), F.fill(0.5, 4), 2e-3, 'and then it settles on the target');
  assert.equal(grid.style.getPropertyValue('--drop'), '1', 'the droplet shows while the water is running');
  top = -2000; win.dispatchEvent(new win.Event('scroll')); c.run(3); assert.equal(grid.style.getPropertyValue('--drop'), '0', 'and goes when it has run the whole way');
  assert.ok([...grid.querySelectorAll('.funnel-step')].every(el => el.classList.contains('is-lit')), 'every circle has rippled');
  top = 700; win.dispatchEvent(new win.Event('scroll')); c.run(4); assert.ok(![...grid.querySelectorAll('.funnel-step')].some(el => el.classList.contains('is-lit')), 'scrolling back up drains it and re-arms the ripples');
});

test('it does nothing under Reduce Motion, without an engine, or with fewer than two steps, so the page stays fully visible', () => {
  const a = page(), c = clock(true); a.grid.getBoundingClientRect = () => ({ top: 0, height: 400 });
  assert.equal(F.mount(a.grid, { Motion: { ...Motion, engine: Motion.createEngine(c.env) }, win: a.win }), null); assert.ok(!a.grid.classList.contains('flow-armed'));
  assert.equal(F.mount(a.grid, { Motion: null, win: a.win }), null); assert.equal(F.mount(a.grid, { Motion: { ...Motion, engine: null }, win: a.win }), null);
  const b = page(1); assert.equal(F.mount(b.grid, { Motion: { ...Motion, engine: Motion.createEngine(clock().env) }, win: b.win }), null);
});

test('destroy stops listening, stops animating, and puts the section back as it was', () => {
  const { win, grid } = page(), c = clock(); grid.getBoundingClientRect = () => ({ top: 300, height: 400 });
  const eng = Motion.createEngine(c.env), m = F.mount(grid, { Motion: { ...Motion, engine: eng }, win });
  m.destroy(); assert.ok(!grid.classList.contains('flow-armed')); assert.equal(eng.running, false);
  win.dispatchEvent(new win.Event('scroll')); c.run(1); assert.equal(eng.running, false, 'a destroyed flow no longer reacts to scrolling');
});
