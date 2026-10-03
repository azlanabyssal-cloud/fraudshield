'use strict';
// The motion engine is physics, so it is tested like physics: closed forms against an independent numerical integration,
// invariants (frame-rate independence, no overshoot at critical damping) as properties, and the clock driven by hand.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const M = require('../lib/motion.js');
const { css, TOKENS } = require('../scripts/build_motion.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a} (tolerance ${tol})`);
const rng = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

// Fourth-order Runge-Kutta on m x'' + c x' + k x = 0: a different method from the closed forms, so agreement means something.
function rk4(p, x0, v0, t, steps = 20000) {
  const h = t / steps, f = (x, v) => [v, -(p.damping / p.mass) * v - (p.stiffness / p.mass) * x];
  let x = x0, v = v0;
  for (let i = 0; i < steps; i++) {
    const [k1x, k1v] = f(x, v), [k2x, k2v] = f(x + h / 2 * k1x, v + h / 2 * k1v), [k3x, k3v] = f(x + h / 2 * k2x, v + h / 2 * k2v), [k4x, k4v] = f(x + h * k3x, v + h * k3v);
    x += h / 6 * (k1x + 2 * k2x + 2 * k3x + k4x); v += h / 6 * (k1v + 2 * k2v + 2 * k3v + k4v);
  }
  return { x, v };
}

test('spring() maps response and damping ratio onto physical constants, and refuses nonsense', () => {
  const p = M.spring({ response: 0.5, dampingRatio: 0.7 });
  near(p.w0, 2 * Math.PI / 0.5, 1e-12); near(p.zeta, 0.7, 1e-12); near(p.stiffness, p.w0 ** 2, 1e-9); near(p.damping, 2 * 0.7 * p.w0, 1e-9);
  const raw = M.spring({ stiffness: 170, damping: 26, mass: 1 }); near(raw.zeta, 26 / (2 * Math.sqrt(170)), 1e-12);
  for (const bad of [{ stiffness: 0, damping: 1 }, { stiffness: -5, damping: 1 }, { stiffness: 10, damping: -1 }, { stiffness: 10, damping: 1, mass: 0 }, { stiffness: NaN, damping: 1 }, { response: 0, dampingRatio: 1 }, { stiffness: Infinity, damping: 1 }]) assert.throws(() => M.spring(bad), RangeError);
  assert.ok(Object.isFrozen(p));
});

test('the closed forms agree with a numerical integration in all three regimes, from any start and any initial velocity', () => {
  const cases = [{ r: 0.4, z: 0.25 }, { r: 0.55, z: 0.84 }, { r: 0.3, z: 1 }, { r: 0.5, z: 1.7 }, { r: 0.7, z: 4 }];
  for (const { r, z } of cases) {
    const p = M.spring({ response: r, dampingRatio: z });
    for (const [x0, v0, t] of [[-1, 0, 0.3], [1, 0, 0.9], [0.4, 5, 0.5], [-2, -7, 1.2], [0, 9, 0.25]]) {
      const got = M.advance(p, x0, v0, t), ref = rk4(p, x0, v0, t);
      near(got.x, ref.x, 1e-7, `x, zeta ${z}`); near(got.v, ref.v, 1e-5, `v, zeta ${z}`);
    }
  }
});

test('frame rate does not matter: stepping twice equals stepping once by the sum, for random springs', () => {
  const rnd = rng(11);
  for (let i = 0; i < 300; i++) {
    const p = M.spring({ response: 0.15 + rnd() * 1.2, dampingRatio: 0.1 + rnd() * 3 }), x0 = rnd() * 4 - 2, v0 = rnd() * 20 - 10, a = rnd() * 0.2, b = rnd() * 0.2;
    const s1 = M.advance(p, x0, v0, a), s2 = M.advance(p, s1.x, s1.v, b), once = M.advance(p, x0, v0, a + b);
    near(s2.x, once.x, 1e-9); near(s2.v, once.v, 1e-8);
  }
});

test('the three regimes join smoothly at critical damping', () => {
  const at = z => M.advance(M.spring({ response: 0.5, dampingRatio: z }), -1, 3, 0.37);
  const mid = at(1);
  for (const z of [1 - 1e-4, 1 + 1e-4]) { const s = at(z); near(s.x, mid.x, 1e-3, 'x'); near(s.v, mid.v, 1e-2, 'v'); }
});

test('a spring at rest on its target stays there, and zero or negative time changes nothing', () => {
  const p = M.SPRINGS.soft;
  const rest = M.advance(p, 0, 0, 5); assert.equal(rest.x + 0, 0); assert.equal(rest.v + 0, 0);   // "+ 0" turns a harmless -0 into 0
  assert.deepEqual(M.advance(p, 0.3, 2, 0), { x: 0.3, v: 2 }); assert.deepEqual(M.advance(p, 0.3, 2, -1), { x: 0.3, v: 2 }); assert.deepEqual(M.advance(p, 0.3, 2, NaN), { x: 0.3, v: 2 });
});

test('critical and overdamped springs never pass their target and never move backwards; underdamped overshoot matches theory', () => {
  for (const z of [1, 1.2, 2, 6]) {
    const p = M.spring({ response: 0.5, dampingRatio: z }); let prev = 0;
    for (let t = 0; t <= 3; t += 0.002) { const y = M.unitStep(p, t); assert.ok(y <= 1 + 1e-12 && y >= prev - 1e-12, `zeta ${z} at ${t}s`); prev = y; }
    assert.equal(M.overshoot(p), 0);
  }
  for (const z of [0.2, 0.5, 0.78, 0.9]) {
    const p = M.spring({ response: 0.5, dampingRatio: z }); let peak = 0;
    for (let t = 0; t <= 3; t += 0.0005) peak = Math.max(peak, M.unitStep(p, t));
    near(peak - 1, M.overshoot(p), 2e-4, `zeta ${z}`);
  }
});

test('every named spring is calm enough for this site: at most 2% overshoot, and each comes to rest', () => {
  for (const [name, p] of Object.entries(M.SPRINGS)) {
    assert.ok(M.overshoot(p) <= 0.021, `${name} overshoots ${(100 * M.overshoot(p)).toFixed(2)}%`);
    const T = M.settlingTime(p, 0.002); assert.ok(T > 0.1 && T < 2.5, `${name} settles in ${T}s`);
  }
  assert.ok(M.overshoot(M.SPRINGS.snappy) > M.overshoot(M.SPRINGS.soft), 'a press answers with more life than a card lift');
});

test('settlingTime is the last moment the spring is outside the tolerance', () => {
  for (const p of [M.SPRINGS.settle, M.SPRINGS.snappy, M.spring({ response: 0.4, dampingRatio: 0.3 })]) {
    const eps = 0.002, T = M.settlingTime(p, eps);
    for (let t = T; t < T + 3; t += 0.01) assert.ok(Math.abs(1 - M.unitStep(p, t)) <= eps + 1e-9, `inside after ${T}s`);
    assert.ok(Math.abs(1 - M.unitStep(p, T - 0.01)) > eps - 1e-4 || T < 0.02, 'outside just before');
  }
});

test('bezier(): endpoints, a known browser value, monotone intro curves, and no failure on awkward control points', () => {
  const lin = M.bezier(0, 0, 1, 1); for (let x = 0; x <= 1; x += 0.05) near(lin(x), x, 1e-6);
  near(M.bezier(0.25, 0.1, 0.25, 1)(0.5), 0.8024, 2e-3, 'CSS "ease" at the midpoint');
  for (const c of Object.values(M.CURVES)) { const f = M.bezier(...c); assert.equal(f(0), 0); assert.equal(f(1), 1); assert.equal(f(-3), 0); assert.equal(f(7), 1); let prev = 0; for (let x = 0; x <= 1; x += 0.002) { const y = f(x); assert.ok(y >= prev - 1e-9); prev = y; } }
  assert.ok(M.bezier(...M.CURVES.out)(0.1) > 0.35, 'the intro rise is front-loaded');
  for (const odd of [[0, 0, 0, 0], [1, 0, 0, 1], [0, 1, 1, 0], [0.5, -2, 0.5, 3]]) { const f = M.bezier(...odd); for (let x = 0; x <= 1; x += 0.1) assert.ok(Number.isFinite(f(x))); }
});

test('springEasing(): starts at 0, ends exactly at 1, and its samples trace the spring', () => {
  for (const name of ['settle', 'soft', 'snappy']) {
    const p = M.SPRINGS[name], e = M.springEasing(p), nums = e.css.slice(7, -1).split(', ').map(Number);
    assert.equal(nums.length, 49); assert.equal(nums[0], 0); assert.equal(nums[nums.length - 1], 1); assert.ok(nums.every(Number.isFinite));
    assert.match(e.css, /^linear\(0, [0-9., -]+, 1\)$/);
    near(e.duration / 1000, M.settlingTime(p, 0.002), 0.001);
    nums.forEach((y, i) => near(y, i === 0 ? 0 : i === 48 ? 1 : M.unitStep(p, (e.duration / 1000) * i / 48), 6e-5, 'sample ' + i));
    const peak = Math.max(...nums); near(peak - 1, M.overshoot(p), 0.004, name + ' peak');
  }
  assert.equal(M.springEasing(M.SPRINGS.settle).css.split(', ').every((v, i, a) => i === 0 || Number(v.replace('linear(', '').replace(')', '')) >= Number(a[i - 1].replace('linear(', '')) - 1e-9), true, 'the critical spring is monotone');
});

test('a body keeps its velocity when its spring is swapped, so switching from drifting to steering never jolts', () => {
  const b = M.body([0, 0], M.SPRINGS.drift);
  for (let i = 0; i < 40; i++) b.step(1 / 60, [300, -120]);
  const before = { x: b.x.slice(), v: b.v.slice() }; b.params = M.SPRINGS.steer;
  assert.deepEqual(b.x, before.x); assert.deepEqual(b.v, before.v);
  b.step(1e-6, [300, -120]); near(b.v[0], before.v[0], 0.05); near(b.v[1], before.v[1], 0.05);
  const gaps = []; let last = b.x[0]; for (let i = 0; i < 6; i++) { b.step(1 / 60, [300, -120]); gaps.push(b.x[0] - last); last = b.x[0]; }
  assert.ok(gaps.every(g => g > -1e-9), 'still moving the same way: no kick backwards');
});

/* ---------- the engine, on a clock we control ---------- */
function clock(reduced = false) {
  let queue = [], id = 0, t = 0; const calls = { raf: 0, caf: 0 };
  const env = { raf: cb => { calls.raf++; queue.push({ id: ++id, cb }); return id; }, caf: h => { calls.caf++; queue = queue.filter(q => q.id !== h); }, now: () => t, reduced: () => reduced };
  const frames = (hz, seconds) => { const n = Math.round(hz * seconds); for (let i = 0; i < n; i++) { t += 1000 / hz; const q = queue; queue = []; q.forEach(j => j.cb(t)); } };
  return { env, frames, calls, pending: () => queue.length, setReduced: v => { reduced = v; }, jump: ms => { t += ms; } };
}

test('the same spring reaches the same place at the same moment on a 30, 60, 120 and 240 Hz display', () => {
  const at = {};
  for (const hz of [30, 60, 120, 240]) {
    const c = clock(), e = M.createEngine(c.env); let seen;
    const f = e.follow([0, 0], M.SPRINGS.soft, v => { seen = v.slice(); }); f.set([200, -80]); c.frames(hz, 0.3);
    at[hz] = seen;
  }
  for (const hz of [30, 60, 240]) { near(at[hz][0], at[120][0], 1e-6); near(at[hz][1], at[120][1], 1e-6); }
});

test('a settled follower sleeps: no frames are requested once nothing moves, and it lands exactly on the target', () => {
  const c = clock(), e = M.createEngine(c.env); const log = [];
  const f = e.follow([0], M.SPRINGS.settle, v => log.push(v[0])); f.set([100]);
  assert.equal(e.running, true); c.frames(60, 2);
  assert.equal(e.running, false); assert.equal(f.active, false); assert.equal(c.pending(), 0); assert.equal(log[log.length - 1], 100); assert.deepEqual(f.value, [100]);
  const raf = c.calls.raf; c.frames(60, 1); assert.equal(c.calls.raf, raf, 'no wake-ups after settling');
  f.set([100]); assert.equal(e.running, false, 'setting the target it already has does nothing');
});

test('with "reduce motion" on, nothing slides: a new target is reached at once and no frame is requested', () => {
  const c = clock(true), e = M.createEngine(c.env); let seen;
  const f = e.follow([0], M.SPRINGS.soft, v => { seen = v[0]; }); f.set([55]);
  assert.equal(seen, 55); assert.equal(c.calls.raf, 0); assert.equal(e.running, false);
  f.nudge([100]); assert.equal(c.calls.raf, 0, 'a nudge is motion too');
  let value = -1, done = 0; e.tween(500, x => x, v => { value = v; }, () => { done++; }); assert.equal(value, 1); assert.equal(done, 1); assert.equal(c.calls.raf, 0);
});

test('a hidden tab cannot fling anything: a long gap between frames counts as at most MAX_DT', () => {
  const c = clock(), e = M.createEngine(c.env); let seen;
  const f = e.follow([0], M.SPRINGS.soft, v => { seen = v[0]; }); f.set([100]);
  const ref = M.body([0], M.SPRINGS.soft); for (let i = 0; i < 3; i++) ref.step(1 / 60, [100]);   // the same three frames at 60 Hz...
  c.frames(60, 0.05); near(seen, ref.x[0], 1e-9);
  ref.step(M.MAX_DT, [100]);                                                                       // ...then one step, however long the gap was
  c.jump(30000); c.frames(60, 1 / 60); near(seen, ref.x[0], 1e-9, 'a 30 second gap is clamped to ' + M.MAX_DT + ' s of physics');
});

test('nudge gives a resting follower velocity and it comes back; stop() freezes it; setParams swaps the spring in flight', () => {
  const c = clock(), e = M.createEngine(c.env); let seen = 0;
  const f = e.follow([0], M.SPRINGS.snappy, v => { seen = v[0]; }); f.nudge([300]); c.frames(60, 0.05); assert.ok(seen > 1, 'it moved off');
  c.frames(60, 2); assert.equal(seen, 0, 'and came back to rest'); assert.equal(e.running, false);
  f.set([50]); c.frames(60, 0.1); const mid = seen; f.stop();
  assert.equal(c.pending(), 0, 'stopping the last animation cancels the frame already requested'); assert.ok(c.calls.caf >= 1);
  c.frames(60, 0.5); assert.equal(seen, mid); assert.equal(e.running, false);
  const g = e.follow([0], M.SPRINGS.drift, v => { seen = v[0]; }); g.set([100]); c.frames(60, 0.2); g.setParams(M.SPRINGS.steer); c.frames(60, 1.5); near(seen, 100, 0.011);
});

test('tween() follows its curve for exactly its duration, finishes on 1, and reports done once', () => {
  const c = clock(), e = M.createEngine(c.env); const seen = []; let done = 0;
  const ease = M.bezier(...M.CURVES.out); e.tween(1000, ease, v => seen.push(v), () => { done++; });
  assert.equal(seen[0], 0); c.frames(60, 0.5); near(seen[seen.length - 1], ease(0.5), 0.02); assert.equal(done, 0);
  c.frames(60, 0.6); assert.equal(seen[seen.length - 1], 1); assert.equal(done, 1); assert.equal(e.running, false);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1] - 1e-12, 'never moves backwards');
  const t2 = e.tween(1000, ease, () => {}); t2.stop(); assert.equal(e.running, false);
});

test('many followers share one loop and each is independent', () => {
  const c = clock(), e = M.createEngine(c.env); const a = e.follow([0], M.SPRINGS.settle, () => {}), b = e.follow([0], M.SPRINGS.snappy, () => {});
  a.set([10]); b.set([-10]); assert.equal(c.pending(), 1, 'one frame request serves both');
  c.frames(60, 0.2); a.stop(); assert.equal(e.running, true); c.frames(60, 2); assert.equal(e.running, false); near(b.value[0], -10, 1e-9); assert.ok(a.value[0] < 10, 'a was stopped mid-flight');
});

test('motion.css is exactly what the generator writes now, and its tokens are well formed', () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'motion.css'), 'utf8');
  assert.equal(file, css(), 'run `npm run motion:build`');
  for (const name of TOKENS) {
    assert.match(file, new RegExp(`--mo-${name}-d: \\d+ms;`)); assert.match(file, new RegExp(`--mo-${name}: var\\(--mo-out\\);`), 'fallback for browsers without linear()');
    const list = new RegExp(`--mo-${name}: (linear\\([^)]*\\));`).exec(file); assert.ok(list, name + ' linear() present');
    const nums = list[1].slice(7, -1).split(', ').map(Number); assert.equal(nums[0], 0); assert.equal(nums.at(-1), 1);
  }
  assert.match(file, /@supports \(transition-timing-function: linear\(0, 1\)\)/);
});

test('each() runs every frame with a clamped dt until stopped, and stopping it releases the loop', () => {
  const c = clock(), e = M.createEngine(c.env), dts = []; const job = e.each(dt => dts.push(dt));
  assert.equal(e.running, true); c.frames(60, 0.5); assert.equal(dts.length, 30); assert.ok(dts.every(d => Math.abs(d - 1 / 60) < 1e-9));
  c.jump(60000); c.frames(60, 1 / 60); assert.equal(dts.at(-1), M.MAX_DT, 'a hidden tab counts as at most MAX_DT');
  job.stop(); assert.equal(job.active, false); assert.equal(e.running, false); assert.equal(c.pending(), 0); const n = dts.length; c.frames(60, 1); assert.equal(dts.length, n);
});
