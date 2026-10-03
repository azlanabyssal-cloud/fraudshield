/* FraudShield motion. One small physics core behind every moving thing on the site, so a card lifting, a number counting
   and the hero lens following a finger all obey the same rules.

   Springs are solved in closed form, not stepped with an integrator. That makes them exact and independent of frame
   rate: a 30 Hz phone and a 144 Hz monitor land on the same position at the same moment, and a frame that arrives late
   (a busy main thread, a tab coming back) cannot make a spring explode. Stepping twice by dt equals stepping once by 2*dt.

   The same physics also generates the CSS `linear()` easing tokens in motion.css (scripts/build_motion.js), so motion that
   CSS runs on its own thread feels identical to motion that JavaScript steers.

   Everything here except mount-time helpers is pure and is tested in Node with a fake clock. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FraudShieldMotion = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const TAU = Math.PI * 2;
const CRITICAL_BAND = 1e-6;   // damping ratios this close to 1 use the critical-damping formula (the others lose precision there)
const MAX_DT = 0.1;           // seconds. A longer gap is a hidden tab, not an animation frame.

/* ---------- springs ---------- */

// Two ways to say the same spring:
//   spring({ response, dampingRatio })      response = the natural period in seconds (smaller is faster);
//                                           dampingRatio 1 = critical (no overshoot), below 1 overshoots a little
//   spring({ stiffness, damping, mass })    the raw physical constants
function spring(o) {
  const mass = o.mass === undefined ? 1 : o.mass;
  let stiffness, damping;
  if (o.response !== undefined) {
    const w = TAU / o.response, ratio = o.dampingRatio === undefined ? 1 : o.dampingRatio;
    stiffness = mass * w * w; damping = 2 * ratio * mass * w;
  } else { stiffness = o.stiffness; damping = o.damping; }
  if (!(stiffness > 0) || !(damping >= 0) || !(mass > 0) || !isFinite(stiffness + damping + mass)) throw new RangeError('spring needs positive stiffness and mass, and damping of at least 0');
  return Object.freeze({ stiffness, damping, mass, w0: Math.sqrt(stiffness / mass), zeta: damping / (2 * Math.sqrt(stiffness * mass)) });
}

// Position and velocity of a spring after t seconds, as displacement from its resting point (x) starting from x0 and v0.
// Writes into `out` so the animation loop allocates nothing.
function advanceInto(p, x0, v0, t, out) {
  if (!(t > 0)) { out.x = x0; out.v = v0; return out; }
  const w0 = p.w0, z = p.zeta;
  if (z < 1 - CRITICAL_BAND) {                          // underdamped: it overshoots and rings
    const a = z * w0, wd = w0 * Math.sqrt(1 - z * z), e = Math.exp(-a * t), c = Math.cos(wd * t), s = Math.sin(wd * t);
    out.x = e * (x0 * c + ((v0 + a * x0) / wd) * s);
    out.v = e * (v0 * c - ((w0 * w0 * x0 + a * v0) / wd) * s);
  } else if (z > 1 + CRITICAL_BAND) {                   // overdamped: it creeps in without crossing
    const q = w0 * Math.sqrt(z * z - 1), r1 = -w0 * z + q, r2 = -w0 * z - q;
    const c2 = (v0 - r1 * x0) / (r2 - r1), c1 = x0 - c2, e1 = Math.exp(r1 * t), e2 = Math.exp(r2 * t);
    out.x = c1 * e1 + c2 * e2; out.v = c1 * r1 * e1 + c2 * r2 * e2;
  } else {                                              // critically damped: the fastest way home without overshoot
    const e = Math.exp(-w0 * t), k = v0 + w0 * x0;
    out.x = e * (x0 + k * t); out.v = e * (v0 - w0 * k * t);
  }
  return out;
}
function advance(p, x0, v0, t) { return advanceInto(p, x0, v0, t, { x: 0, v: 0 }); }

// Response of a spring released from 0 towards 1 at rest, at time t.
function unitStep(p, t) { return 1 + advance(p, -1, 0, t).x; }

// Largest excursion past the target for a release from rest, as a fraction of the distance travelled (exact).
function overshoot(p) { return p.zeta < 1 ? Math.exp(-Math.PI * p.zeta / Math.sqrt(1 - p.zeta * p.zeta)) : 0; }

// Seconds until the spring stays within `eps` of its target for good.
function settlingTime(p, eps) {
  const tol = eps === undefined ? 0.001 : eps, step = 0.001, limit = 60;
  let last = 0;
  for (let t = 0, out = { x: 0, v: 0 }; t <= limit; t += step) {
    advanceInto(p, -1, 0, t, out);
    if (Math.abs(out.x) > tol) last = t;
  }
  return last + step;
}

/* ---------- curves ---------- */

// CSS cubic-bezier(x1, y1, x2, y2) as a function of time (0..1), solved the way browsers do it.
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = t => ((ax * t + bx) * t + cx) * t, Y = t => ((ay * t + by) * t + cy) * t, dX = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {                       // Newton's method: fast when the slope is healthy
      const err = X(t) - x;
      if (Math.abs(err) < 1e-7) return Y(t);
      const d = dX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0, hi = 1; t = x;                          // bisection: slow but cannot fail
    for (let i = 0; i < 40 && hi - lo > 1e-9; i++) { const v = X(t); if (Math.abs(v - x) < 1e-7) break; if (x > v) lo = t; else hi = t; t = (hi + lo) / 2; }
    return Y(t);
  };
}

// The site's two intro curves: the quick rise of the headline and the wipe of the title. Everything else borrows them.
const CURVES = Object.freeze({ out: [0.22, 1, 0.36, 1], inOut: [0.7, 0, 0.2, 1] });

// Named springs. Every one is critical or barely underdamped (overshoot of 2% at most): the intro has no bounce.
const SPRINGS = Object.freeze({
  settle: spring({ response: 0.55, dampingRatio: 1 }),       // content arriving
  soft:   spring({ response: 0.6, dampingRatio: 0.84 }),     // a card lifting under the pointer (about 0.8% overshoot)
  snappy: spring({ response: 0.32, dampingRatio: 0.78 }),    // a button answering a press (about 2% overshoot)
  steer:  spring({ response: 0.32, dampingRatio: 1 }),       // the hero lens following a pointer
  drift:  spring({ response: 1.3, dampingRatio: 1 })         // the hero lens on its own
});

// A spring as a CSS `linear()` easing: { duration (ms), css } for a unit step, sampled evenly and ending exactly on 1.
function springEasing(p, o) {
  const n = (o && o.points) || 48, T = settlingTime(p, 0.002), pts = [];
  for (let i = 0; i <= n; i++) pts.push(i === 0 ? 0 : i === n ? 1 : Math.round(unitStep(p, T * i / n) * 10000) / 10000);
  return { duration: Math.round(T * 1000), css: 'linear(' + pts.join(', ') + ')' };
}

/* ---------- bodies and the shared clock ---------- */

// A point (or a vector) on springs, with no scheduling of its own. `step(dt, target)` moves it exactly dt seconds.
// Changing the spring keeps position and velocity, so a body that switches from drifting to steering never jolts.
function body(initial, params) {
  const x = Array.from(initial), v = new Array(x.length).fill(0), tmp = { x: 0, v: 0 };
  const b = {
    params, x, v,
    step(dt, target) {
      for (let i = 0; i < x.length; i++) {
        const t = typeof target === 'number' ? target : target[i];
        advanceInto(b.params, x[i] - t, v[i], dt, tmp); x[i] = t + tmp.x; v[i] = tmp.v;
      }
      return b;
    },
    settled(target, rest) {
      const r = rest || { delta: 0.01, speed: 0.01 };
      for (let i = 0; i < x.length; i++) {
        const t = typeof target === 'number' ? target : target[i];
        if (Math.abs(x[i] - t) > r.delta || Math.abs(v[i]) > r.speed) return false;
      }
      return true;
    }
  };
  return b;
}

// The animation loop shared by everything on a page. env: { raf, caf, now, reduced }, injectable so tests drive a fake clock.
function createEngine(env) {
  const live = new Set();
  let handle = 0, last = 0;

  function frame(t) {
    handle = 0;
    const dt = Math.min(Math.max((t - last) / 1000, 0), MAX_DT); last = t;
    for (const job of Array.from(live)) job.tick(dt, t);
    if (live.size) handle = env.raf(frame);
  }
  function wake(job) { live.add(job); if (!handle) { last = env.now(); handle = env.raf(frame); } }
  function sleep(job) { live.delete(job); if (!live.size && handle) { env.caf(handle); handle = 0; } }

  // A vector chasing a target. set() moves the target and the spring does the rest; snap() jumps with no motion at all.
  // With "reduce motion" on, set() snaps: nothing slides, but every value still arrives.
  function follow(initial, params, onUpdate, opts) {
    const o = opts || {}, rest = { delta: o.restDelta || 0.01, speed: o.restSpeed || 0.01 };
    const b = body(initial, params), target = Array.from(initial);
    const job = { tick(dt) { b.step(dt, target); if (b.settled(target, rest)) { snap(target); return; } onUpdate(b.x); } };
    function snap(next) {
      for (let i = 0; i < target.length; i++) { target[i] = next[i]; b.x[i] = next[i]; b.v[i] = 0; }
      sleep(job); onUpdate(b.x);
    }
    return {
      set(next) { if (env.reduced()) { snap(next); return; } for (let i = 0; i < target.length; i++) target[i] = next[i]; if (!b.settled(target, rest)) wake(job); },
      nudge(vel) { if (env.reduced()) return; for (let i = 0; i < vel.length; i++) b.v[i] += vel[i]; wake(job); },
      snap, stop() { sleep(job); },
      setParams(next) { b.params = next; },
      get value() { return Array.from(b.x); },
      get active() { return live.has(job); }
    };
  }

  // A fixed-duration animation along a curve (for things that must never overshoot, such as a counting number).
  function tween(duration, ease, onUpdate, onDone) {
    if (env.reduced() || !(duration > 0)) { onUpdate(1); if (onDone) onDone(); return { stop() {} }; }
    let elapsed = 0;
    const job = { tick(dt) { elapsed += dt * 1000; const p = Math.min(1, elapsed / duration); onUpdate(ease(p)); if (p >= 1) { sleep(job); if (onDone) onDone(); } } };
    onUpdate(0); wake(job);
    return { stop() { sleep(job); } };
  }

  return { follow, tween, reduced: () => env.reduced(), get running() { return live.size > 0; } };
}

/* ---------- the page's own engine, and helpers that need a browser ---------- */

function browserEnv(win) {
  const mq = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
  return { raf: cb => win.requestAnimationFrame(cb), caf: id => win.cancelAnimationFrame(id), now: () => win.performance.now(), reduced: () => !!(mq && mq.matches) };
}
const hasWindow = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function';
const engine = hasWindow ? createEngine(browserEnv(window)) : null;

// A control that leans towards a nearby pointer and settles back. It writes the CSS `translate` property, which composes with
// the `transform` the stylesheet uses for hover and press, so the two never fight. Fine pointers only: a finger has no "near".
function magnetic(el, opts) {
  if (!engine || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return null;
  const o = Object.assign({ reach: 80, pull: 0.3, max: 9 }, opts);
  const f = engine.follow([0, 0], SPRINGS.snappy, v => { el.style.translate = v[0].toFixed(2) + 'px ' + v[1].toFixed(2) + 'px'; });
  const clamp = n => Math.max(-o.max, Math.min(o.max, n));
  function move(e) {
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, dx = e.clientX - cx, dy = e.clientY - cy;
    const near = Math.abs(dx) < r.width / 2 + o.reach && Math.abs(dy) < r.height / 2 + o.reach;
    f.set(near ? [clamp(dx * o.pull), clamp(dy * o.pull)] : [0, 0]);
  }
  const leave = () => f.set([0, 0]);
  document.addEventListener('pointermove', move, { passive: true });
  document.documentElement.addEventListener('pointerleave', leave);
  return { destroy() { document.removeEventListener('pointermove', move); document.documentElement.removeEventListener('pointerleave', leave); f.snap([0, 0]); el.style.translate = ''; } };
}

return { spring, advance, advanceInto, unitStep, overshoot, settlingTime, bezier, CURVES, SPRINGS, springEasing, body, createEngine, engine, magnetic, MAX_DT };
}));
