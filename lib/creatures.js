/* The rig that brings the six characters (lib/creature-art.js) alive. Everything physical is a spring from lib/motion.js:
   - eyes follow the pointer on a spring; a pupil can never leave its eye (the offset is bounded by the socket, per eye)
   - blinks come at irregular intervals, sometimes twice, closing faster than they open
   - a click is a hop: a bouncy spring launched upward, with squash and stretch that always preserve volume (sx * sy = 1)
   - while a character speaks (index.html marks it .creature--speaking) its mouth opens and closes in syllables
   - each has its own manner of floating, and Thag is shy: he looks away when you get close
   - each FEELS: a mood (lib/emotion.js) drives the smile, lids, pupils, blush, energy, slump, trembling, waving and joyful hops, blended by a
     spring. Hover makes them curious, a click delights them, a scam verdict alarms them (and pleases Thag), and the four steps of a trap
     make Thag gleeful as the water reaches them. Page code speaks to them with one event: fs:mood (or fs:flow).
   The maths is pure and tested; mount() is the thin DOM layer. One ticker per visible character; none off screen; none under Reduce Motion. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./motion.js'), require('./emotion.js'));
  else root.FraudShieldCreatures = factory(root.FraudShieldMotion, root.FraudShieldEmotion);
}(typeof self !== 'undefined' ? self : this, function (Motion, Emotion) {
'use strict';

const clamp = (x, lo, hi) => (x > lo ? (x < hi ? x : hi) : lo);   // NaN becomes lo

/* ---------- pure ---------- */

// Where a pupil sits when the character looks along (dx, dy) screen pixels. The offset is scaled per axis by the room the socket
// leaves, and its length never reaches 1 of that room, so the pupil stays inside the eye however far away the pointer is.
function gazeOffset(dx, dy, eye, reach) {
  const mag = Math.hypot(dx, dy);
  if (!(mag > 0)) return [0, 0];
  const k = Math.tanh(mag / (reach || 160)), roomX = Math.max(0, eye.rx - eye.pr - 0.6), roomY = Math.max(0, eye.ry - eye.pr - 0.6);
  return [dx / mag * k * roomX, dy / mag * k * roomY];
}

// Seconds until the next blink, 2.2 to 5.8; 18% of blinks come as a pair.
const nextBlinkDelay = rand => 2.2 + rand() * 3.6;
const isDoubleBlink = rand => rand() < 0.18;
// Lid closure (0 open, 1 shut) over a blink of normalised time t: it snaps shut by 35%, holds shut until 50% (so even a slow frame rate
// catches it fully closed), then eases open over the rest.
function lidAmount(t) {
  if (!(t > 0) || t >= 1) return 0;
  if (t < 0.35) { const x = t / 0.35; return x * x; }
  if (t <= 0.5) return 1;
  const x = (t - 0.5) / 0.5; return (1 - x) * (1 - x);
}

// Squash and stretch from the hop's height y (CSS px, negative is up) and speed vy. Volume is preserved: sx * sy = 1.
function squash(y, vy) {
  const sy = clamp(1 - y * 0.004 + Math.min(Math.abs(vy) * 0.00012, 0.06), 0.78, 1.22);
  return { sx: 1 / sy, sy };
}

// The idle float: a sum of slow sines, different for each kind of character. Returns CSS px and degrees.
const STYLES = {
  shield: { ax: 0, ay: 5, rot: 1.4, w: 0.28 }, friend: { ax: 0, ay: 4, rot: 1.2, w: 0.31 }, bot: { ax: 2, ay: 2.5, rot: 0.8, w: 0.22 },
  bee: { ax: 8, ay: 7, rot: 3, w: 0.55, eight: true }, ghost: { ax: 3, ay: 9, rot: 2, w: 0.21 }, star: { ax: 0, ay: 5, rot: 6, w: 0.3 }
};
// The float at an accumulated angle (radians). The rig advances the angle by dt * angularSpeed(key) * mood speed, so a change of mood changes the
// tempo smoothly instead of jumping the character to a different point of its cycle.
const angularSpeed = key => (STYLES[key] || STYLES.shield).w * 2 * Math.PI;
const bob = (t, phase, key) => bobAt(t * angularSpeed(key) + phase, key);
function bobAt(a, key) {
  const s = STYLES[key] || STYLES.shield;
  return { x: s.ax * Math.sin(a), y: s.eight ? s.ay * Math.sin(2 * a) : s.ay * Math.sin(a) + 0.35 * s.ay * Math.sin(a * 0.43 + 1.1), rot: s.rot * Math.sin(a + 1.1) };
}
const phaseOf = key => { let h = 0; for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) % 628; return h / 100; };

/* ---------- DOM ---------- */
let pointer = { x: -1e4, y: -1e4, at: -1e9 };
const listening = typeof WeakSet === 'function' ? new WeakSet() : { has: () => false, add() {} };   // one listener per window
function listen(win) {
  if (listening.has(win)) return; listening.add(win);
  win.addEventListener('pointermove', e => { pointer = { x: e.clientX, y: e.clientY, at: win.performance.now() }; }, { passive: true });
}

function mount(root, env) {
  const win = env.win, engine = env.engine || Motion.engine, rand = env.rand || Math.random;
  const svg = root.querySelector('svg.cr-svg');
  if (!svg || !engine || engine.reduced()) return null;
  const key = svg.getAttribute('data-rig'), shy = key === 'ghost';
  listen(win);

  const eyes = Array.from(svg.querySelectorAll('.cr-eye')).map(g => ({
    pupil: g.querySelector('.cr-pupil'), lid: g.querySelector('.cr-lid'),
    cx: +g.getAttribute('data-cx'), cy: +g.getAttribute('data-cy'), rx: +g.getAttribute('data-rx'), ry: +g.getAttribute('data-ry'), pr: +g.getAttribute('data-pr')
  })).filter(e => e.pupil && e.lid);
  const body = svg.querySelector('.cr-body'), mouthOpen = svg.querySelector('.cr-mouth-open'), smile = svg.querySelector('.cr-smile');
  const gaze = Motion.body([0, 0], Motion.spring({ response: 0.2, dampingRatio: 0.8 }));
  const hop = Motion.body([0], Motion.spring({ response: 0.5, dampingRatio: 0.42 }));      // bouncy: it lands and settles with a little life
  const arrive = Motion.body([0.6, 22], Motion.spring({ response: 0.55, dampingRatio: 0.7 })); // scale and drop in from the side of the section
  const phase = phaseOf(key), baseline = Emotion.BASELINE[key] || 'calm', feeling = new Emotion.Mood(baseline);
  const mood = Motion.body(Emotion.point(baseline), Motion.spring({ response: 0.7, dampingRatio: 1 }));   // critical: a feeling never overshoots
  const cheeks = Array.from(svg.querySelectorAll('.cr-cheek')), armL = svg.querySelector('.cr-arm-l'), armR = svg.querySelector('.cr-arm-r');
  let clock = 0, angle = phase, hovering = false, hopIn = 1.5;
  let blinkIn = nextBlinkDelay(rand), blinkT = -1, owed = 0, saccadeIn = 1, look = [0, 0], amp = 0, syllableIn = 0, syllable = 0, rect = null, rectAge = 1e9, now0 = null;
  let speaking = root.classList.contains('creature--speaking');
  const watcher = typeof win.MutationObserver === 'function' ? new win.MutationObserver(() => { speaking = root.classList.contains('creature--speaking'); }) : null;
  if (watcher) watcher.observe(root, { attributes: true, attributeFilter: ['class'] });

  function eyeCentre() {      // where the eyes are on screen, refreshed a few times a second rather than every frame
    if (!rect || rectAge > 0.25) { rect = svg.getBoundingClientRect(); rectAge = 0; }
    const e = eyes[0] || { cx: 60, cy: 60 };
    return [rect.left + rect.width * (e.cx / 120), rect.top + rect.height * (e.cy / 140), rect];
  }

  function tick(dt, t) {
    if (now0 === null) now0 = t;
    rectAge += dt; clock += dt;
    const c = eyeCentre(), fresh = t - pointer.at < 3500;
    let tx, ty;
    if (fresh) {
      tx = pointer.x - c[0]; ty = pointer.y - c[1];
      if (shy && Math.hypot(tx, ty) < 190) { tx = -tx; ty = -ty * 0.4; }          // Thag will not look you in the eye
    } else {
      saccadeIn -= dt; if (saccadeIn <= 0) { saccadeIn = 1.4 + rand() * 2.8; look = [(rand() - 0.5) * 220, (rand() - 0.5) * 120]; }
      tx = look[0]; ty = look[1];
    }
    gaze.step(dt, [tx, ty]);
    // What it feels now: an event if one is live, else curiosity while the pointer is on it, else its own baseline. The spring does the blending.
    const live = feeling.override && clock < feeling.until;
    mood.step(dt, live ? feeling.override : hovering ? Emotion.point('curious') : feeling.baseline);
    const ex = Emotion.expression(mood.x[0], mood.x[1]);
    for (const e of eyes) { const o = gazeOffset(gaze.x[0], gaze.x[1], e); e.pupil.style.transform = 'translate(' + o[0].toFixed(2) + 'px,' + o[1].toFixed(2) + 'px) scale(' + ex.pupil.toFixed(3) + ')'; }
    if (smile) smile.style.transform = 'scaleY(' + ex.smile.toFixed(3) + ')';
    for (const c of cheeks) c.style.opacity = (ex.cheeks * 0.85).toFixed(3);
    if (ex.wave > 0.02) { const s = Math.sin(clock * 9); if (armL) armL.style.transform = 'rotate(' + (-ex.wave * 24 * (0.5 + 0.5 * s)).toFixed(1) + 'deg)'; if (armR) armR.style.transform = 'rotate(' + (ex.wave * 24 * (0.5 - 0.5 * s)).toFixed(1) + 'deg)'; }
    else { if (armL && armL.style.transform) armL.style.transform = ''; if (armR && armR.style.transform) armR.style.transform = ''; }
    if (ex.hop > 0.15) { hopIn -= dt; if (hopIn <= 0) { hop.v[0] = -(200 + 220 * ex.hop); hopIn = 1.6 + rand() * 1.4 - ex.hop * 0.6; } } else hopIn = Math.max(hopIn, 1);   // delight turns into hopping on its own

    blinkIn -= dt;
    if (blinkT < 0 && blinkIn <= 0) { blinkT = 0; blinkIn = nextBlinkDelay(rand); owed = isDoubleBlink(rand) ? 1 : 0; }
    if (blinkT >= 0) {
      blinkT += dt / 0.2;
      if (blinkT >= 1) { blinkT = -1; if (owed) { owed = 0; blinkT = 0; } }
    }
    const lid = Math.max(blinkT >= 0 ? lidAmount(blinkT) : 0, ex.lid).toFixed(3);   // heavy-lidded when sleepy, shut during a blink, whichever is more
    for (const e of eyes) e.lid.style.transform = 'scaleY(' + lid + ')';

    hop.step(dt, 0); arrive.step(dt, [1, 0]);
    angle += dt * angularSpeed(key) * ex.speed;
    const q = squash(hop.x[0], hop.v[0]), b = bobAt(angle, key), shake = ex.tremble * (0.9 * Math.sin(clock * 47) + 0.5 * Math.sin(clock * 31 + 1));
    if (body) body.style.transform = 'scale(' + (q.sx * arrive.x[0]).toFixed(4) + ',' + (q.sy * arrive.x[0]).toFixed(4) + ')';
    svg.style.transform = 'translate(' + (b.x * ex.energy + shake).toFixed(2) + 'px,' + (b.y * ex.energy + ex.slump + hop.x[0] + arrive.x[1]).toFixed(2) + 'px) rotate(' + (b.rot * ex.energy).toFixed(2) + 'deg)';

    if (mouthOpen) {
      syllableIn -= dt; if (speaking && syllableIn <= 0) { syllableIn = 0.07 + rand() * 0.09; syllable = rand() < 0.2 ? 0.1 : 0.35 + rand() * 0.65; }
      const goal = speaking ? syllable : 0; amp += (goal - amp) * (1 - Math.exp(-dt / 0.045));
      mouthOpen.style.transform = 'scaleY(' + clamp(amp, 0.05, 1).toFixed(3) + ')'; mouthOpen.style.opacity = amp > 0.06 ? '1' : '0';
      if (smile) smile.style.opacity = amp > 0.16 ? '0' : '1';
    }
  }

  let job = engine.each(tick);
  // Feelings from outside. One event, fs:mood: { reaction } (a page-wide event each character feels in its own way), or { mood, who } for one
  // character or 'all'. fs:flow: { lit } is how many of the four steps of a trap the water has reached.
  const onMood = e => {
    const d = (e && e.detail) || {}, hold = d.hold > 0 ? d.hold : 4;
    const name = d.reaction ? (Emotion.REACTIONS[d.reaction] || {})[key] : (d.who === 'all' || d.who === key ? d.mood : null);
    if (name) feeling.set(name, hold, clock);
  };
  const onFlow = e => { const lit = e && e.detail ? e.detail.lit : 0, step = lit > 0 ? Emotion.FLOW_STEPS[Math.min(lit, Emotion.FLOW_STEPS.length) - 1] : null; if (step && step[key]) feeling.set(step[key], 5, clock); };
  win.addEventListener('fs:mood', onMood); win.addEventListener('fs:flow', onFlow);
  root.addEventListener('pointerenter', () => { hovering = true; }); root.addEventListener('pointerleave', () => { hovering = false; });
  root.addEventListener('click', () => { hop.v[0] = -520; feeling.set('joyful', 1.8, clock); });   // the launch is upward speed in px per second; a click delights
  let io = null;
  if (typeof win.IntersectionObserver === 'function') {                                      // off screen, no ticker and no animation; back on screen, it resumes
    io = new win.IntersectionObserver(entries => {
      const seen = entries[entries.length - 1].isIntersecting;
      root.classList.toggle('creature--paused', !seen);
      if (!seen && job.active) job.stop(); else if (seen && !job.active) job = engine.each(tick);
    }, { threshold: 0 });
    io.observe(root);
  }
  return { key, get job() { return job; }, get angle() { return angle; }, gaze, hop, mood, feeling, destroy() { job.stop(); win.removeEventListener('fs:mood', onMood); win.removeEventListener('fs:flow', onFlow); if (watcher) watcher.disconnect(); if (io) io.disconnect(); } };
}

function mountAll(doc, env) { return Array.from(doc.querySelectorAll('.creature')).map(el => mount(el, env)).filter(Boolean); }

return { gazeOffset, nextBlinkDelay, isDoubleBlink, lidAmount, squash, bob, bobAt, angularSpeed, phaseOf, STYLES, mount, mountAll };
}));
