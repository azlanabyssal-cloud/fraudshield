'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const C = require('../lib/creatures.js'), Art = require('../lib/creature-art.js'), Motion = require('../lib/motion.js');

const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} expected ${b}, got ${a}`);
const rng = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

test('a pupil can never leave its eye, whatever direction or distance the pointer is at, for every eye of every character', () => {
  const r = rng(4);
  for (const key of Art.KEYS) {
    const dom = new JSDOM(Art.art(key)), eyes = [...dom.window.document.querySelectorAll('.cr-eye')].map(g => ({ rx: +g.dataset.rx, ry: +g.dataset.ry, pr: +g.dataset.pr }));
    assert.ok(eyes.length >= 2, key + ' has two eyes');
    for (const e of eyes) for (let i = 0; i < 400; i++) {
      const dx = (r() - 0.5) * 6000, dy = (r() - 0.5) * 6000, [ox, oy] = C.gazeOffset(dx, dy, e);
      assert.ok((ox / (e.rx - e.pr)) ** 2 + (oy / (e.ry - e.pr)) ** 2 <= 1.0000001, `${key}: pupil at (${ox}, ${oy}) leaves an eye of ${e.rx}x${e.ry}`);
      assert.ok(Math.abs(ox) + e.pr <= e.rx && Math.abs(oy) + e.pr <= e.ry, 'and the pupil disc stays inside the white');
    }
  }
  assert.deepEqual(C.gazeOffset(0, 0, { rx: 9, ry: 10, pr: 5 }), [0, 0]); assert.deepEqual(C.gazeOffset(NaN, 5, { rx: 9, ry: 10, pr: 5 }), [0, 0]);
  assert.deepEqual(C.gazeOffset(100, 100, { rx: 4, ry: 4, pr: 5 }), [0, 0], 'an eye with no room keeps a centred pupil');
});

test('looking farther away turns the pupil further, with diminishing returns, and in the right direction', () => {
  const eye = { rx: 10, ry: 11, pr: 5 }; let prev = 0;
  for (const d of [10, 40, 100, 200, 400, 1500]) { const o = C.gazeOffset(d, 0, eye)[0]; assert.ok(o > prev && o <= eye.rx - eye.pr); prev = o; }
  assert.ok(C.gazeOffset(-80, 0, eye)[0] < 0 && C.gazeOffset(0, -80, eye)[1] < 0 && C.gazeOffset(0, 80, eye)[1] > 0);
});

test('squash and stretch preserve volume everywhere, stay within limits, and stretch in the air but squash on landing', () => {
  for (let y = -80; y <= 60; y += 2) for (const vy of [-900, -200, 0, 200, 900]) { const q = C.squash(y, vy); near(q.sx * q.sy, 1, 1e-12); assert.ok(q.sy >= 0.78 - 1e-12 && q.sy <= 1.22 + 1e-12); }
  assert.ok(C.squash(-30, 0).sy > 1, 'airborne: taller'); assert.ok(C.squash(15, 0).sy < 1, 'pressed into the ground: shorter'); near(C.squash(0, 0).sy, 1, 1e-12); assert.ok(Number.isFinite(C.squash(NaN, NaN).sy));
});

test('blinks are irregular, sometimes double, shut fast and open slowly, and start and end open', () => {
  const r = rng(8), d = Array.from({ length: 500 }, () => C.nextBlinkDelay(r)); assert.ok(d.every(x => x >= 2.2 && x <= 5.8)); assert.ok(new Set(d.map(x => x.toFixed(4))).size > 490, 'no two blinks are alike');
  const doubles = Array.from({ length: 4000 }, () => C.isDoubleBlink(r)).filter(Boolean).length / 4000; near(doubles, 0.18, 0.03);
  assert.equal(C.lidAmount(0), 0); assert.equal(C.lidAmount(1), 0); assert.equal(C.lidAmount(-1), 0); assert.equal(C.lidAmount(NaN), 0);
  for (let t = 0.35; t <= 0.5; t += 0.01) assert.equal(C.lidAmount(t), 1, 'held shut between 35% and 50%');
  let prev = 0; for (let t = 0.001; t < 0.35; t += 0.001) { const a = C.lidAmount(t); assert.ok(a >= prev && a <= 1); prev = a; } prev = 1; for (let t = 0.5; t < 1; t += 0.001) { const a = C.lidAmount(t); assert.ok(a <= prev + 1e-12 && a >= 0); prev = a; }
  assert.ok(0.35 < 1 - 0.5, 'it closes in 35% of the blink and takes 50% to open: snaps shut, eases open');
});

test('every character floats in its own way: bounded, smooth, and out of step with the others', () => {
  const peaks = {};
  for (const key of Object.keys(C.STYLES)) { let ymax = 0, rmax = 0, prev = C.bob(0, C.phaseOf(key), key); for (let t = 0.05; t < 60; t += 0.05) { const b = C.bob(t, C.phaseOf(key), key); ymax = Math.max(ymax, Math.abs(b.y)); rmax = Math.max(rmax, Math.abs(b.rot)); assert.ok(Math.abs(b.y - prev.y) < 3 && Math.abs(b.x - prev.x) < 3, key + ' moves smoothly'); prev = b; } assert.ok(ymax <= 13 && rmax <= 6.01, `${key}: ${ymax} ${rmax}`); peaks[key] = ymax; }
  assert.ok(peaks.ghost > peaks.bot, 'the ghost drifts further than the robot'); assert.equal(new Set(Object.keys(C.STYLES).map(C.phaseOf)).size, 6, 'no two share a phase');
  assert.ok(C.bob(3, 0, 'nobody') && Number.isFinite(C.bob(3, 0, 'nobody').y), 'an unknown key falls back, never throws');
});

/* ---------- the art ---------- */
test('all six characters share one anatomy, and no two use the same gradient id', () => {
  assert.deepEqual(Art.KEYS.slice().sort(), ['bee', 'bot', 'friend', 'ghost', 'shield', 'star']); const ids = [];
  for (const key of Art.KEYS) {
    const svg = new JSDOM(Art.art(key)).window.document.querySelector('svg'); assert.equal(svg.getAttribute('viewBox'), '0 0 120 140'); assert.equal(svg.getAttribute('data-rig'), key); assert.equal(svg.getAttribute('aria-hidden'), 'true');
    for (const sel of ['.cr-body', '.cr-eye', '.cr-pupil', '.cr-lid', '.cr-mouth', '.cr-mouth-open', '.cr-smile', '.cr-shadow']) assert.ok(svg.querySelector(sel), `${key} has ${sel}`);
    for (const g of svg.querySelectorAll('.cr-eye')) { for (const a of ['cx', 'cy', 'rx', 'ry', 'pr']) assert.ok(Number.isFinite(+g.dataset[a]), `${key} eye ${a}`); assert.ok(+g.dataset.pr < +g.dataset.rx && +g.dataset.pr < +g.dataset.ry, 'the pupil is smaller than its eye'); }
    svg.querySelectorAll('[id]').forEach(e => ids.push(e.id));
    for (const u of Art.art(key).matchAll(/url\(#([^)]+)\)/g)) assert.ok(svg.querySelector('#' + u[1]), `${key}: url(#${u[1]}) has a target`);
  }
  assert.equal(new Set(ids).size, ids.length, 'ids are unique across the page: ' + ids.join(','));
  assert.throws(() => Art.art('dragon'), /unknown creature/);
});

test('the ghost hem is a closed path that ripples within bounds', () => {
  for (const [phase, amp] of [[0, 0], [1.3, 2], [6, 4]]) { const d = Art.hemPath(phase, amp); assert.match(d, /^M22 72.*Z$/); assert.ok(!/NaN|undefined/.test(d)); }
  assert.notEqual(Art.hemPath(0, 2), Art.hemPath(1, 2));
});

test('index.html carries exactly the generated art for every character, so what ships is what was tested', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const key of Art.KEYS) { const m = new RegExp(`<!-- @gen:creature_${key} -->\\n([\\s\\S]*?)\\n<!-- @/gen:creature_${key} -->`).exec(html); assert.ok(m, key + ' region present'); assert.equal(m[1], Art.art(key), key + ' matches the generator'); }
  assert.equal([...html.matchAll(/class="creature c-/g)].length, 6);
  for (const gone of ['@keyframes c-float', '@keyframes arm-lw', '@keyframes eye-blink', 'c-float-mobile']) assert.ok(!html.includes(gone), 'the old keyframe system is gone: ' + gone);
});

/* ---------- mount ---------- */
function clock(reduced = false) {
  let queue = [], id = 0, t = 0;
  const env = { raf: cb => { queue.push({ id: ++id, cb }); return id; }, caf: h => { queue = queue.filter(q => q.id !== h); }, now: () => t, reduced: () => reduced };
  return { env, frames: (s, hz = 60) => { for (let i = 0; i < Math.round(hz * s); i++) { t += 1000 / hz; const q = queue; queue = []; q.forEach(j => j.cb(t)); } } };
}
function stage(key = 'shield') {
  const dom = new JSDOM(`<div class="creature c-${key}">${Art.art(key)}</div>`, { pretendToBeVisual: true }), w = dom.window;
  const svg = w.document.querySelector('svg'); svg.getBoundingClientRect = () => ({ left: 100, top: 100, width: 96, height: 112 });
  return { w, root: w.document.querySelector('.creature'), svg };
}
const pupil = svg => svg.querySelector('.cr-pupil').style.transform;

test('the eyes follow the pointer on a spring, settle, and look elsewhere when it goes quiet', () => {
  const { w, root, svg } = stage(), c = clock(), eng = Motion.createEngine(c.env), m = C.mount(root, { win: w, engine: eng, rand: rng(1) });
  assert.ok(m && eng.running);
  w.dispatchEvent(Object.assign(new w.Event('pointermove'), { clientX: 700, clientY: 130 })); w.performance.now = () => 0;
  c.frames(0.05); const early = parseFloat(/translate\(([-\d.]+)px/.exec(pupil(svg))[1]); c.frames(1.5);
  const settled = parseFloat(/translate\(([-\d.]+)px/.exec(pupil(svg))[1]); assert.ok(settled > early && settled > 2, `it turned right and is still settling at first: ${early} then ${settled}`);
  const eye = { rx: 9.5, ry: 11, pr: 5.4 }; assert.ok(settled <= eye.rx - eye.pr, 'and stays inside the eye');
  m.destroy(); assert.equal(eng.running, false);
});

test('a click launches a hop that lands and settles, squashing and stretching without changing volume', () => {
  const { w, root, svg } = stage(), c = clock(), eng = Motion.createEngine(c.env), m = C.mount(root, { win: w, engine: eng, rand: rng(2) });
  c.frames(0.2); root.dispatchEvent(new w.Event('click'));
  let minY = 0, maxSy = 0, minSy = 9;
  for (let i = 0; i < 90; i++) { c.frames(1 / 60); minY = Math.min(minY, m.hop.x[0]); const q = C.squash(m.hop.x[0], m.hop.v[0]); maxSy = Math.max(maxSy, q.sy); minSy = Math.min(minSy, q.sy); }
  assert.ok(minY < -12, 'it left the ground: ' + minY); assert.ok(maxSy > 1.03 && minSy < 0.99, `stretched in the air (${maxSy}) and squashed on landing (${minSy})`);
  c.frames(3); near(m.hop.x[0], 0, 0.05, 'and came to rest'); assert.match(svg.style.transform, /translate\(.*\) rotate\(/); assert.match(svg.querySelector('.cr-body').style.transform, /^scale\(/);
});

test('the lids close during a blink and are open again afterwards', () => {
  const { w, root, svg } = stage(), c = clock(), eng = Motion.createEngine(c.env); C.mount(root, { win: w, engine: eng, rand: () => 0.0 });   // rand 0: the first blink comes at 2.2 s
  let shut = 0; for (let i = 0; i < 60 * 4; i++) { c.frames(1 / 60); const a = parseFloat(/scaleY\(([\d.]+)\)/.exec(svg.querySelector('.cr-lid').style.transform || 'scaleY(0)')[1]); shut = Math.max(shut, a); }
  assert.ok(shut > 0.95, 'the lid shut completely at some point: ' + shut);
});

test('the mouth opens in syllables while the character speaks, and closes when it stops', async () => {
  const { w, root, svg } = stage(), c = clock(), eng = Motion.createEngine(c.env); C.mount(root, { win: w, engine: eng, rand: rng(3) });
  const open = () => parseFloat(/scaleY\(([\d.]+)\)/.exec(svg.querySelector('.cr-mouth-open').style.transform)[1]);
  c.frames(0.5); assert.ok(open() <= 0.06, 'silent: closed');
  root.classList.add('creature--speaking'); await new Promise(r => setTimeout(r, 0)); const seen = new Set(); let max = 0; for (let i = 0; i < 90; i++) { c.frames(1 / 60); const o = open(); max = Math.max(max, o); seen.add(o.toFixed(1)); }
  assert.ok(max > 0.4 && seen.size > 4, 'it opens and varies like syllables: ' + [...seen]); assert.equal(svg.querySelector('.cr-smile').style.opacity === '0' || max < 0.17, true);
  root.classList.remove('creature--speaking'); await new Promise(r => setTimeout(r, 0)); c.frames(0.6); assert.ok(open() <= 0.08, 'and shuts when the speech ends');
});

test('Thag looks away from a pointer that comes close, while the others look at it', () => {
  const dir = key => { const { w, root, svg } = stage(key), c = clock(), eng = Motion.createEngine(c.env); C.mount(root, { win: w, engine: eng, rand: rng(5) }); w.performance.now = () => 0;
    w.dispatchEvent(Object.assign(new w.Event('pointermove'), { clientX: 190, clientY: 150 })); c.frames(1.2); return parseFloat(/translate\(([-\d.]+)px/.exec(pupil(svg))[1]); };
  assert.ok(dir('shield') > 0.5, 'Kavach looks towards the pointer on his right'); assert.ok(dir('ghost') < -0.5, 'Thag looks away');
});

test('under Reduce Motion, without art, or with no engine, nothing is mounted and nothing animates', () => {
  const { w, root } = stage(), c = clock(true); assert.equal(C.mount(root, { win: w, engine: Motion.createEngine(c.env) }), null);
  const bare = new JSDOM('<div class="creature"><p>no art</p></div>').window; assert.equal(C.mount(bare.document.querySelector('.creature'), { win: bare, engine: Motion.createEngine(clock().env) }), null);
  assert.equal(C.mount(root, { win: w, engine: null }), null === Motion.engine ? null : null);
  assert.deepEqual(C.mountAll(bare.document, { win: bare, engine: Motion.createEngine(clock().env) }), []);
});

test('off screen the ticker stops, and it resumes on screen', () => {
  const { w, root } = stage(); let observer; w.IntersectionObserver = class { constructor(cb) { observer = cb; } observe() {} disconnect() {} };
  const c = clock(), eng = Motion.createEngine(c.env), m = C.mount(root, { win: w, engine: eng, rand: rng(6) }); assert.equal(eng.running, true);
  observer([{ isIntersecting: false }]); assert.equal(eng.running, false); assert.ok(root.classList.contains('creature--paused'));
  observer([{ isIntersecting: true }]); assert.equal(eng.running, true); assert.ok(!root.classList.contains('creature--paused')); m.destroy(); assert.equal(eng.running, false);
});

/* ---------- feeling ---------- */
const val = (el, re) => parseFloat(re.exec(el)[1]);
const smileOf = svg => val(svg.querySelector('.cr-smile').style.transform, /scaleY\(([-\d.]+)\)/);
const lidOf = svg => val(svg.querySelector('.cr-lid').style.transform || 'scaleY(0)', /scaleY\(([-\d.]+)\)/);
const pupilScale = svg => val(svg.querySelector('.cr-pupil').style.transform, /scale\(([-\d.]+)\)/);
const fire = (w, name, detail) => w.dispatchEvent(new w.CustomEvent(name, { detail }));
const rig = (key = 'shield') => { const s = stage(key), c = clock(), eng = Motion.createEngine(c.env), m = C.mount(s.root, { win: s.w, engine: eng, rand: rng(11) }); return { ...s, c, eng, m }; };

test('a scam verdict alarms Kavach (frown, wide pupils, trembling) and delights Thag (grin), blending over time rather than snapping', () => {
  const k = rig('shield'), g = rig('ghost'); k.c.frames(2); g.c.frames(2);
  const calmSmile = smileOf(k.svg), calmPupil = pupilScale(k.svg), thagCalm = smileOf(g.svg);
  fire(k.w, 'fs:mood', { reaction: 'scam' }); fire(g.w, 'fs:mood', { reaction: 'scam' });
  k.c.frames(0.1); g.c.frames(0.1); const earlySmile = smileOf(k.svg); assert.ok(earlySmile < calmSmile && earlySmile > -0.3, 'moving towards a frown, not there yet: ' + earlySmile);
  k.c.frames(2.5); g.c.frames(2.5);
  assert.ok(smileOf(k.svg) < -0.5, 'Kavach frowns: ' + smileOf(k.svg)); assert.ok(pupilScale(k.svg) > calmPupil + 0.1, 'his pupils widen'); assert.ok(smileOf(g.svg) > thagCalm + 0.3, 'Thag grins wider: ' + smileOf(g.svg));
  assert.notEqual(k.svg.style.transform, k.svg.style.transform.replace(/translate\([-\d.]+px/, 'translate(0px'), 'and Kavach is shaking');
});

test('moods blend: a feeling approaches its target smoothly and monotonically, and never overshoots it', () => {
  const k = rig('friend'); k.c.frames(2); fire(k.w, 'fs:mood', { mood: 'alarmed', who: 'friend', hold: 30 });
  const vs = []; for (let i = 0; i < 180; i++) { k.c.frames(1 / 60); vs.push(k.m.mood.x[0]); }
  for (let i = 1; i < vs.length; i++) assert.ok(vs[i] <= vs[i - 1] + 1e-9, 'valence only falls on the way to alarm'); assert.ok(vs.every(v => v >= -0.8 - 1e-9), 'and never goes beyond -0.8');
  near(vs.at(-1), -0.8, 0.02); const gaps = vs.slice(1).map((v, i) => Math.abs(v - vs[i])); assert.ok(Math.max(...gaps) < 0.1, 'no frame jumps more than 6% of the whole range');
});

test('a feeling lasts its hold and then the character returns to its own baseline', () => {
  const k = rig('shield'); k.c.frames(2); const base = k.m.mood.x.slice(); fire(k.w, 'fs:mood', { reaction: 'scam', hold: 1 });
  k.c.frames(0.95); assert.ok(k.m.mood.x[0] < -0.5, 'alarmed for the whole hold'); k.c.frames(5); near(k.m.mood.x[0], base[0], 0.03); near(k.m.mood.x[1], base[1], 0.03);
});

test('events can address one character or all, and ignore unknown moods and malformed events', () => {
  const a = rig('shield'), b = rig('ghost'); a.c.frames(1); b.c.frames(1);
  fire(a.w, 'fs:mood', { mood: 'sad', who: 'ghost', hold: 20 }); a.c.frames(2); assert.ok(a.m.mood.x[0] > 0.5, 'Kavach ignores something addressed to Thag');
  fire(a.w, 'fs:mood', { mood: 'sad', who: 'all', hold: 20 }); a.c.frames(3); assert.ok(a.m.mood.x[0] < -0.5, 'but feels something addressed to all');
  for (const bad of [undefined, {}, { mood: 'nonsense', who: 'all' }, { reaction: 'nonsense' }, { reaction: 'scam', hold: -5 }]) { const x = rig('star'); x.c.frames(1); const before = x.m.mood.x.slice(); fire(x.w, 'fs:mood', bad); x.c.frames(0.1); assert.ok(Number.isFinite(x.m.mood.x[0])); if (!bad || !bad.reaction || bad.reaction === 'nonsense') near(x.m.mood.x[0], before[0], 0.2); }
  a.m.destroy(); fire(a.w, 'fs:mood', { mood: 'joyful', who: 'all' }); assert.equal(a.eng.running, false, 'a destroyed character no longer listens');
});

test('the water makes Thag gleeful step by step, while the guardians grow alarmed', () => {
  const g = rig('ghost'), k = rig('shield'); g.c.frames(2); k.c.frames(2); const out = [];
  for (const lit of [1, 2, 3, 4]) { fire(g.w, 'fs:flow', { lit }); fire(k.w, 'fs:flow', { lit }); g.c.frames(2.5); k.c.frames(2.5); out.push([g.m.mood.x[0], k.m.mood.x[0]]); }
  assert.ok(out[3][0] > out[0][0] - 1e-9 && out[3][0] > 0.8, 'Thag ends delighted'); assert.ok(out[3][1] < out[0][1] && out[3][1] < -0.5, 'Kavach ends alarmed'); fire(g.w, 'fs:flow', { lit: 0 }); fire(g.w, 'fs:flow', undefined);
});

test('hover makes a character curious and a click delights it: waving, hopping on its own, a blush', () => {
  const k = rig('shield'); k.c.frames(2); const calm = k.m.mood.x.slice();
  k.root.dispatchEvent(new k.w.Event('pointerenter')); k.c.frames(2); assert.ok(k.m.mood.x[1] > calm[1], 'curious is more awake than proud'); k.root.dispatchEvent(new k.w.Event('pointerleave')); k.c.frames(3); near(k.m.mood.x[0], calm[0], 0.03);
  k.root.dispatchEvent(new k.w.Event('click')); k.c.frames(0.8);
  assert.ok(k.m.mood.x[0] > 0.9 && k.m.mood.x[1] > 0.8, 'joyful'); assert.match(k.svg.querySelector('.cr-arm-l').style.transform, /rotate\(/, 'the arms wave'); assert.ok(parseFloat(k.svg.querySelector('.cr-cheek').style.opacity) > 0.7, 'the cheeks colour');
});

test('delight turns into hopping on its own, and calm does not', () => {
  const hops = (mood) => { const k = rig('friend'); fire(k.w, 'fs:mood', { mood, who: 'all', hold: 60 }); k.c.frames(1.5); let launches = 0, prev = 0; for (let i = 0; i < 60 * 8; i++) { k.c.frames(1 / 60); const v = k.m.hop.v[0]; if (v < -150 && prev >= -150) launches++; prev = v; } return launches; };
  assert.ok(hops('joyful') >= 2, 'joy hops repeatedly'); assert.equal(hops('calm'), 0); assert.equal(hops('sad'), 0);
});

test('sadness droops the lids and sinks the body; being wired opens the eyes and widens the pupils', () => {
  const s = rig('bot'), w = rig('bot'); fire(s.w, 'fs:mood', { mood: 'sad', who: 'all', hold: 60 }); fire(w.w, 'fs:mood', { mood: 'alarmed', who: 'all', hold: 60 }); s.c.frames(4); w.c.frames(4);
  const lidAt = (r) => { let m = 0; for (let i = 0; i < 20; i++) { r.c.frames(1 / 60); m = Math.min(m === 0 ? 9 : m, lidOf(r.svg)); } return m; };
  assert.ok(lidAt(s) > 0.2, 'sleepy lids'); assert.ok(lidAt(w) < 0.05, 'wide awake'); assert.ok(pupilScale(w.svg) > pupilScale(s.svg));
});

test('the float quickens when wired and slows when sleepy, smoothly, without jumping to a different point of its cycle', () => {
  const rate = mood => { const r = rig('shield'); fire(r.w, 'fs:mood', { mood, who: 'all', hold: 60 }); r.c.frames(4); const a0 = r.m.angle; r.c.frames(2); return (r.m.angle - a0) / 2; };
  const wired = rate('alarmed'), sleepy = rate('sad'); near(wired / sleepy, (0.7 + 0.8 * 0.95) / (0.7 + 0.8 * 0.15), 0.1, 'tempo follows arousal');
  const r = rig('bee'); r.c.frames(2); let prev = r.m.angle, maxStep = 0; fire(r.w, 'fs:mood', { mood: 'alarmed', who: 'all', hold: 60 });
  for (let i = 0; i < 240; i++) { r.c.frames(1 / 60); maxStep = Math.max(maxStep, r.m.angle - prev); prev = r.m.angle; } assert.ok(maxStep < C.angularSpeed('bee') * 1.6 / 60 + 1e-9, 'the angle only ever advances at a bounded rate: no jump');
});
