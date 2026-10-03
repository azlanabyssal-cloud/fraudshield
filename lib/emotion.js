/* Emotion for the characters. Feeling is two numbers, valence (unpleasant to pleasant, -1..1) and arousal (sleepy to wired, 0..1), the
   standard circumplex of affect. Every named mood is a point on that plane; the rig follows the point with a critically damped spring, so
   moods flow into one another instead of switching, and a feeling can never overshoot into something stronger than was asked for.
   expression() turns a point into the parts of a face and body: how far the smile curves (through to a frown), how heavy the lids are,
   how wide the pupils are, how much the cheeks colour, how much energy the body has, whether it slumps, trembles, waves or hops for joy.
   Pure and tested. lib/creatures.js applies the result to the art. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FraudShieldEmotion = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const clamp = (x, lo, hi) => (x > lo ? (x < hi ? x : hi) : lo);   // NaN becomes lo

// [valence, arousal]
const MOODS = Object.freeze({
  calm: [0.25, 0.25], serious: [-0.1, 0.4], proud: [0.7, 0.4], hopeful: [0.6, 0.5], happy: [0.85, 0.7], joyful: [1, 0.95],
  curious: [0.3, 0.65], worried: [-0.45, 0.62], alarmed: [-0.8, 0.95], sad: [-0.75, 0.15], smug: [0.45, 0.42], gleeful: [0.9, 0.82]
});
// What each character feels when nothing is happening: where it lives on the page decides it.
const BASELINE = Object.freeze({ shield: 'proud', friend: 'happy', bee: 'worried', bot: 'serious', ghost: 'smug', star: 'hopeful' });

// How each character feels about a page-wide event. Thag is the scammer, so what alarms everyone else delights him.
const REACTIONS = Object.freeze({
  scam:    { shield: 'alarmed', friend: 'worried', bee: 'alarmed', bot: 'worried', ghost: 'gleeful', star: 'worried' },
  curious: { shield: 'curious', friend: 'curious', bee: 'curious', bot: 'curious', ghost: 'smug', star: 'curious' },
  cheer:   { shield: 'happy', friend: 'joyful', bee: 'happy', bot: 'happy', ghost: 'sad', star: 'joyful' },
  numbers: { shield: 'worried', friend: 'worried', bee: 'alarmed', bot: 'worried', ghost: 'smug', star: 'hopeful' }
});
// The four steps of a trap, as the water reaches them: each step Thag enjoys more and the others like less.
const FLOW_STEPS = Object.freeze([
  { ghost: 'smug', shield: 'proud' }, { ghost: 'smug', shield: 'curious', bee: 'worried' },
  { ghost: 'gleeful', shield: 'worried', bee: 'alarmed', friend: 'worried' }, { ghost: 'gleeful', shield: 'alarmed', bee: 'alarmed', friend: 'worried', star: 'worried' }
]);

const point = name => MOODS[name] || MOODS.calm;

// Valence and arousal to the parts of a face and body. Every output is bounded, and each moves smoothly with its inputs.
function expression(valence, arousal) {
  const v = clamp(valence, -1, 1), a = clamp(arousal, 0, 1);
  return {
    smile: v >= 0 ? 0.25 + 0.95 * v : 0.25 + 1.45 * v,            // curvature: 0.25 at neutral, 1.2 beaming, 0 at v of about -0.17, below that a frown
    lid: Math.max(0, 0.42 - a) * 1.1,                              // heavy lids when sleepy, none once awake (0 to 0.46)
    pupil: 0.85 + 0.45 * a,                                         // wider with arousal: fear and excitement both dilate
    cheeks: clamp(0.15 + 0.85 * Math.max(0, v), 0, 1),             // colour when pleased
    energy: 0.55 + 0.9 * a, speed: 0.7 + 0.8 * a,                  // how big and how fast the floating is
    slump: clamp(-v, 0, 1) * (1 - a) * 4,                          // sadness and low energy sink the body, in px
    tremble: clamp(-v, 0, 1) * clamp((a - 0.6) / 0.4, 0, 1),       // fear shakes
    wave: clamp((v - 0.5) / 0.5, 0, 1) * clamp((a - 0.3) / 0.4, 0, 1),   // pleased and awake: waves
    hop: clamp((v - 0.7) / 0.3, 0, 1) * clamp((a - 0.6) / 0.4, 0, 1)     // delighted: hops for joy, unprompted
  };
}

// A feeling with a baseline it returns to. set() overrides for `hold` seconds; later events replace earlier ones. All times are in seconds.
class Mood {
  constructor(baseline) { this.baseline = point(baseline); this.until = -Infinity; this.override = null; }
  set(name, hold, now) { this.override = point(name); this.until = now + (hold > 0 ? hold : 0); return this; }
  clear() { this.until = -Infinity; this.override = null; }
  target(now) { return this.override && now < this.until ? this.override : this.baseline; }
  get active() { return this.override !== null; }
}

return { MOODS, BASELINE, REACTIONS, FLOW_STEPS, point, expression, Mood };
}));
