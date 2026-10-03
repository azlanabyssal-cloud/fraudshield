'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Mo = require('../lib/motes.js');

test('the number of motes scales with the screen, drops on small and weak devices, and never exceeds its cap', () => {
  assert.equal(Mo.moteCount(0, 0), 0); assert.ok(Mo.moteCount(1440, 800) <= 90 && Mo.moteCount(1440, 800) >= 60);
  assert.ok(Mo.moteCount(390, 800) <= 40, 'a phone gets few'); assert.ok(Mo.moteCount(1440, 800, { cores: 2, memory: 8 }) <= 36); assert.ok(Mo.moteCount(1440, 800, { cores: 8, memory: 1 }) <= 36);
  assert.ok(Mo.moteCount(8000, 8000) <= 90);
});

test('creation is deterministic by seed, and different seeds differ', () => {
  const a = Mo.create(50, 800, 600, 3), b = Mo.create(50, 800, 600, 3), c = Mo.create(50, 800, 600, 4);
  assert.deepEqual(a, b); assert.notDeepEqual(a.motes[0], c.motes[0]); assert.equal(Mo.create(0, 10, 10).motes.length, 0);
  assert.ok(a.motes.every(p => p.x >= 0 && p.x <= 800 && p.y >= 0 && p.y <= 600 && p.r >= 0.8 && p.r <= 2.4));
});

test('the simulation is deterministic and never leaves the canvas, at any frame rate, with or without a lens', () => {
  for (const [hz, lens] of [[30, null], [60, { x: 400, y: 300, r: 120 }], [144, { x: 10, y: 590, r: 200 }], [20, { x: -50, y: -50, r: 90 }]]) {
    const run = () => { const s = Mo.create(80, 800, 600, 9); for (let i = 0; i < hz * 120; i++) Mo.step(s, 1 / hz, i / hz, lens); return s; };
    const s = run(); assert.deepEqual(s, run(), `${hz} Hz is reproducible`);
    for (const p of s.motes) { assert.ok(Number.isFinite(p.x + p.y + p.vx + p.vy)); assert.ok(p.x >= -12 && p.x <= 812 && p.y >= -12 && p.y <= 612, `${hz} Hz: (${p.x}, ${p.y})`); }
  }
});

test('hostile time steps cannot break it: zero, tiny, and a huge gap from a hidden tab', () => {
  const s = Mo.create(40, 800, 600, 2); for (const dt of [0, 1e-9, 0.016, 5, 60]) { Mo.step(s, dt, 10, { x: 400, y: 300, r: 100 }); assert.ok(s.motes.every(p => Number.isFinite(p.x + p.y + p.vx + p.vy) && p.x >= -12 && p.x <= 812), 'dt ' + dt); }
});

test('near the lens the motes swirl round it, and farther away they just drift', () => {
  const lens = { x: 400, y: 300, r: 100 }, swirl = (radiusFrom, radiusTo) => {
    const s = Mo.create(0, 800, 600, 1);
    for (let a = 0; a < 360; a += 10) { const r = (radiusFrom + radiusTo) / 2, x = lens.x + r * Math.cos(a * Math.PI / 180), y = lens.y + r * Math.sin(a * Math.PI / 180); s.motes.push({ x, y, vx: 0, vy: 0, r: 1, a: 0, k: 1 }); }
    for (let i = 0; i < 90; i++) Mo.step(s, 1 / 60, 3 + i / 60, lens);
    return s.motes.reduce((sum, p) => { const dx = p.x - lens.x, dy = p.y - lens.y, d = Math.hypot(dx, dy) || 1; return sum + (-dy / d) * p.vx + (dx / d) * p.vy; }, 0) / s.motes.length;
  };
  assert.ok(swirl(80, 120) > 8, 'a mote close to the lens circulates (counter-clockwise)'); assert.ok(swirl(80, 120) > 3 * Math.abs(swirl(300, 340)) || swirl(300, 340) < 2, 'far away it does not');
});

test('glow is full inside the lens, zero outside, soft at the edge, and never rises with distance', () => {
  assert.equal(Mo.glow(0, 100), 1); assert.equal(Mo.glow(50, 100), 1); assert.equal(Mo.glow(200, 100), 0);
  let prev = 1; for (let d = 0; d <= 160; d += 1) { const g = Mo.glow(d, 100); assert.ok(g <= prev + 1e-12 && g >= 0 && g <= 1); prev = g; }
  const edge = Mo.glow(100, 100); assert.ok(edge > 0.1 && edge < 1, 'soft edge');
});

test('mount draws motes onto a canvas it owns, lights those inside the lens, and cleans up; with no 2D context it withdraws', () => {
  const { JSDOM } = require('jsdom'), dom = new JSDOM('<div id="h"><i id="b"></i></div>'), w = dom.window, host = w.document.getElementById('h'), before = w.document.getElementById('b');
  Object.defineProperty(host, 'clientWidth', { value: 800 }); Object.defineProperty(host, 'clientHeight', { value: 600 });
  const calls = []; const ctx = new Proxy({}, { get: (_, k) => (...a) => { calls.push([k, a]); }, set: () => true });
  w.HTMLCanvasElement.prototype.getContext = () => ctx;
  const m = Mo.mount(host, before, () => ({ x: 400, y: 300, r: 150 }), { win: w });
  assert.ok(m && host.firstChild === m.canvas && m.canvas.getAttribute('aria-hidden') === 'true'); assert.equal(m.canvas.width, 800);
  for (let i = 0; i < 30; i++) m.frame(1 / 60, i * 16);
  assert.ok(calls.some(c => c[0] === 'arc') && calls.some(c => c[0] === 'clearRect') && calls.some(c => c[0] === 'stroke'), 'drawn, cleared each frame, with comet tails inside the lens');
  m.destroy(); assert.equal(host.querySelector('canvas'), null);
  w.HTMLCanvasElement.prototype.getContext = () => null; assert.equal(Mo.mount(host, before, () => null, { win: w }), null); assert.equal(host.querySelector('canvas'), null);
});
