'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../lib/emotion.js');
const Art = require('../lib/creature-art.js');

const KEYS = Art.KEYS;

test('every named mood is a valid point on the valence/arousal plane, and every character has a baseline and a reaction to everything', () => {
  for (const [name, [v, a]] of Object.entries(E.MOODS)) assert.ok(v >= -1 && v <= 1 && a >= 0 && a <= 1, name);
  assert.deepEqual(Object.keys(E.BASELINE).sort(), KEYS.slice().sort());
  for (const b of Object.values(E.BASELINE)) assert.ok(E.MOODS[b], 'baseline mood exists: ' + b);
  for (const [event, map] of Object.entries(E.REACTIONS)) { assert.deepEqual(Object.keys(map).sort(), KEYS.slice().sort(), event + ' covers all six'); for (const m of Object.values(map)) assert.ok(E.MOODS[m], `${event}: ${m}`); }
  assert.equal(E.FLOW_STEPS.length, 4); for (const step of E.FLOW_STEPS) for (const [k, m] of Object.entries(step)) { assert.ok(KEYS.includes(k)); assert.ok(E.MOODS[m]); }
  assert.deepEqual(E.point('no such mood'), E.MOODS.calm, 'an unknown mood is calm, never undefined');
});

test('what alarms everyone else delights Thag, and the trap makes him enjoy each step more while the others like it less', () => {
  const v = (event, key) => E.MOODS[E.REACTIONS[event][key]][0];
  assert.ok(v('scam', 'ghost') > 0.5 && v('scam', 'shield') < -0.5 && v('scam', 'bee') < -0.5, 'a scam verdict: Thag gleeful, the guardians alarmed');
  assert.ok(v('cheer', 'ghost') < 0 && v('cheer', 'friend') > 0.5, 'good news: Thag sulks, the friend rejoices');
  const val = (step, key, fallback) => (E.FLOW_STEPS[step][key] ? E.MOODS[E.FLOW_STEPS[step][key]][0] : fallback);
  let thag = -2, shield = 2; for (let s = 0; s < 4; s++) { const t = val(s, 'ghost', thag), h = val(s, 'shield', shield); assert.ok(t >= thag - 1e-9, 'Thag never enjoys it less as the trap closes'); assert.ok(h <= shield + 1e-9 || s === 0, 'Kavach never likes it better'); thag = t; shield = h; }
  assert.ok(E.MOODS[E.FLOW_STEPS[3].ghost][1] > 0.7, 'at the last step Thag is wired with glee');
});

test('expression is bounded for every input, including hostile ones', () => {
  const lim = { smile: [-1.2, 1.2], lid: [0, 0.47], pupil: [0.84, 1.31], cheeks: [0, 1], energy: [0.54, 1.46], speed: [0.69, 1.51], slump: [0, 4], tremble: [0, 1], wave: [0, 1], hop: [0, 1] };
  for (let v = -1.5; v <= 1.5; v += 0.05) for (let a = -0.5; a <= 1.5; a += 0.05) {
    const x = E.expression(v, a); for (const [k, [lo, hi]] of Object.entries(lim)) assert.ok(Number.isFinite(x[k]) && x[k] >= lo - 1e-9 && x[k] <= hi + 1e-9, `${k} at (${v}, ${a}) = ${x[k]}`);
  }
  for (const bad of [NaN, undefined, null, Infinity, -Infinity]) { const x = E.expression(bad, bad); for (const k of Object.keys(lim)) assert.ok(Number.isFinite(x[k]), `${k} for ${bad}`); }
});

test('the face follows the feeling: the smile rises with valence and turns into a frown below zero, lids droop only when sleepy, pupils widen with arousal', () => {
  let prev = -9; for (let v = -1; v <= 1; v += 0.02) { const s = E.expression(v, 0.5).smile; assert.ok(s >= prev - 1e-12, 'smile never falls as valence rises'); prev = s; }
  assert.ok(E.expression(-0.1, 0.5).smile > 0, 'mildly negative is still a faint smile'); assert.ok(E.expression(-0.3, 0.5).smile < 0, 'clearly negative frowns'); assert.ok(E.expression(1, 0.5).smile > 1);
  assert.equal(E.expression(0, 0.5).lid, 0); assert.ok(E.expression(0, 0.1).lid > 0.3 && E.expression(0, 0.1).lid > E.expression(0, 0.3).lid);
  prev = 0; for (let a = 0; a <= 1; a += 0.02) { const p = E.expression(0, a).pupil; assert.ok(p >= prev); prev = p; }
});

test('behaviour switches on in the right feelings and nowhere else: slump, tremble, wave, hop', () => {
  const sad = E.expression(...E.MOODS.sad), fear = E.expression(...E.MOODS.alarmed), joy = E.expression(...E.MOODS.joyful), calm = E.expression(...E.MOODS.calm);
  assert.ok(sad.slump > 2 && fear.slump < 0.5, 'sadness sinks the body, panic does not'); assert.ok(fear.tremble > 0.6 && sad.tremble === 0 && joy.tremble === 0 && calm.tremble === 0, 'only fear shakes');
  assert.ok(joy.wave > 0.9 && joy.hop > 0.8 && calm.wave === 0 && calm.hop === 0 && sad.hop === 0 && fear.hop === 0, 'joy waves and hops; calm and fear do neither');
  assert.ok(E.expression(...E.MOODS.happy).wave > 0.3 && E.expression(...E.MOODS.happy).hop < 0.15, 'merely happy waves but stays below the rig\'s hop threshold of 0.15');
});

test('expression is continuous: a small change of feeling never makes a large change of face', () => {
  for (let v = -1; v < 1; v += 0.1) for (let a = 0; a < 1; a += 0.1) {
    const p = E.expression(v, a), q = E.expression(v + 0.01, a + 0.01);
    for (const k of Object.keys(p)) assert.ok(Math.abs(p[k] - q[k]) <= 0.2, `${k} jumps at (${v}, ${a}): ${p[k]} -> ${q[k]}`);
  }
});

test('Mood returns to its baseline when an event expires, and a later event replaces an earlier one', () => {
  const m = new E.Mood('proud'); assert.deepEqual(m.target(0), E.MOODS.proud); assert.equal(m.active, false);
  m.set('alarmed', 3, 10); assert.deepEqual(m.target(10), E.MOODS.alarmed); assert.deepEqual(m.target(12.9), E.MOODS.alarmed); assert.deepEqual(m.target(13), E.MOODS.proud, 'back to baseline when the hold ends');
  m.set('worried', 5, 20); m.set('joyful', 1, 21); assert.deepEqual(m.target(21.5), E.MOODS.joyful); assert.deepEqual(m.target(22.5), E.MOODS.proud);
  m.set('sad', -4, 30); assert.deepEqual(m.target(30), E.MOODS.proud, 'a negative hold is no hold'); m.set('sad', 9, 40); m.clear(); assert.deepEqual(m.target(41), E.MOODS.proud);
  assert.deepEqual(new E.Mood('nonsense').target(0), E.MOODS.calm);
});
