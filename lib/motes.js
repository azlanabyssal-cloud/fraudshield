/* Hero motes: a field of drifting specks carried on a slow flow field, like dust in water. Near the scanning lens they swirl around it and
   ignite orange, so the lens visibly "energises" what it looks at. The simulation is pure and frame-rate independent (velocity relaxes with
   an exponential, not a per-frame factor) and is tested; mount() owns one canvas and is driven by the hero's existing animation loop. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FraudShieldMotes = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const TAU = Math.PI * 2, RELAX = 0.6, SWIRL_REACH = 2.4;
const rng = seed => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const smooth = t => { const c = t > 0 ? (t < 1 ? t : 1) : 0; return c * c * (3 - 2 * c); };
const MAX_DT = 0.1;   // a longer gap is a hidden tab coming back, not an animation frame
const wrap = (v, size) => ((((v + 12) % (size + 24)) + size + 24) % (size + 24)) - 12;

// Fewer motes on small screens and weak devices; the scene must never cost a low-end phone its smoothness.
function moteCount(w, h, hw) {
  const cores = (hw && hw.cores) || 4, mem = (hw && hw.memory) || 4;
  let n = Math.round(w * h / 16000);
  if (w < 700) n = Math.min(n, 40);
  if (cores <= 2 || mem <= 2) n = Math.min(n, 36);
  return Math.max(0, Math.min(90, n));
}

function create(n, w, h, seed) {
  const r = rng(seed === undefined ? 1 : seed), motes = [];
  for (let i = 0; i < n; i++) motes.push({ x: r() * w, y: r() * h, vx: 0, vy: 0, r: 0.8 + r() * 1.6, a: r(), k: 0.6 + r() * 0.8 });
  return { w, h, motes };
}

// The current of the water at a point, in px per second. A few sines of different wavelengths, so it never visibly repeats.
function field(x, y, t) {
  const a = Math.sin(y * 0.0045 + t * 0.21) + 0.6 * Math.sin(y * 0.013 - t * 0.37);
  const b = 0.55 * Math.cos(x * 0.004 + t * 0.17) + 0.35 * Math.sin((x + y) * 0.009 + t * 0.3);
  return [a * 16 + 10, b * 12];
}

// 0 outside the lens, 1 well inside, a soft edge between.
const glow = (d, radius) => smooth((radius * 1.15 - d) / (radius * 0.3));

// lens: { x, y, r } or null. Mutates and returns the state.
function step(state, rawDt, t, lens) {
  const dt = rawDt > 0 ? Math.min(rawDt, MAX_DT) : 0, k = 1 - Math.exp(-dt / RELAX);
  for (const p of state.motes) {
    const f = field(p.x, p.y, t); let fx = f[0] * p.k, fy = f[1] * p.k;
    if (lens) {
      const dx = p.x - lens.x, dy = p.y - lens.y, d = Math.hypot(dx, dy), reach = lens.r * SWIRL_REACH;
      if (d > 1 && d < reach) { const w = 1 - d / reach; fx += (-dy / d) * w * 38 - (dx / d) * w * 10; fy += (dx / d) * w * 38 - (dy / d) * w * 10; }   // swirl round the lens, drawn gently in
    }
    p.vx += (fx - p.vx) * k; p.vy += (fy - p.vy) * k;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.x = wrap(p.x, state.w); p.y = wrap(p.y, state.h);
  }
  return state;
}

function mount(host, before, getLens, env) {
  const win = env.win, doc = host.ownerDocument, nav = win.navigator;
  const canvas = doc.createElement('canvas'); canvas.className = 'hs__motes'; canvas.setAttribute('aria-hidden', 'true');
  host.insertBefore(canvas, before);
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return null; }
  let state = create(0, 0, 0), dpr = 1;
  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    dpr = Math.min(2, win.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    state = create(moteCount(w, h, { cores: nav.hardwareConcurrency, memory: nav.deviceMemory }), w, h, 7);
  }
  function frame(dt, t) {
    if (!state.w) return;
    const lens = getLens(); step(state, dt, t / 1000, lens);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, state.w, state.h);
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath();
    const lit = [];
    for (const p of state.motes) {
      const g = lens ? glow(Math.hypot(p.x - lens.x, p.y - lens.y), lens.r) : 0;
      if (g > 0.02) { lit.push([p, g]); continue; }
      ctx.moveTo(p.x + p.r, p.y); ctx.arc(p.x, p.y, p.r, 0, TAU);
    }
    ctx.fill();
    for (const [p, g] of lit) {                         // inside the lens: bigger, orange, with a short comet tail
      ctx.strokeStyle = 'rgba(255,138,61,' + (g * 0.5).toFixed(2) + ')'; ctx.lineWidth = p.r; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.12, p.y - p.vy * 0.12); ctx.stroke();
      ctx.fillStyle = 'rgba(255,150,70,' + (0.35 + 0.6 * g).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + g * 0.8), 0, TAU); ctx.fill();
    }
  }
  resize();
  return { frame, resize, canvas, destroy() { canvas.remove(); } };
}

return { moteCount, create, field, glow, step, mount, rng };
}));
