'use strict';
/* Tiny on-device text classifiers. Every model has the same shape, a bias plus one weight per feature,
   so inference is `bias + sum of weights of the features present` with no runtime library.
   Trainers: binary naive Bayes (log-likelihood ratios) and L2 logistic regression (seeded SGD). */
const { wilson } = require('../metrics.js');

const round3 = x => Math.round(x * 1000) / 1000;

function features(text, { chars }) {
  const lower = text.toLowerCase(), out = new Set();
  (lower.match(/[a-z]{2,}/g) || []).forEach(w => out.add(w));
  if (/\d{5,}/.test(lower)) out.add('__longnum');
  if (/https?:\/\/|www\.|\.com\b|\.co\.uk/.test(lower)) out.add('__url');
  if (/[£$₹€]/.test(text)) out.add('__currency');
  if ((text.match(/\b[A-Z]{3,}\b/g) || []).length >= 2) out.add('__caps');
  out.add('__len' + Math.min(5, Math.floor(text.length / 40)));
  if (chars) {
    const s = ' ' + lower.replace(/\d/g, '0').replace(/\s+/g, ' ') + ' ';
    for (let n = 3; n <= 5; n++) for (let i = 0; i + n <= s.length; i++) out.add('c:' + s.slice(i, i + n));
  }
  return [...out];
}

function vocabulary(examples, opts, minDocs) {
  const df = new Map();
  for (const e of examples) for (const f of features(e.text, opts)) df.set(f, (df.get(f) || 0) + 1);
  return [...df].filter(([, c]) => c >= minDocs).map(([f]) => f).sort();
}

function trainNB(examples, { chars = false, minDocs = chars ? 3 : 2 } = {}) {
  const opts = { chars }, spam = new Map(), ham = new Map();
  let ns = 0, nh = 0;
  for (const e of examples) {
    const bag = e.y ? spam : ham; e.y ? ns++ : nh++;
    for (const f of features(e.text, opts)) bag.set(f, (bag.get(f) || 0) + 1);
  }
  if (!ns || !nh) throw new Error('training data needs both classes');
  const weights = {};
  for (const f of new Set([...spam.keys(), ...ham.keys()])) {
    const s = spam.get(f) || 0, h = ham.get(f) || 0;
    if (s + h >= minDocs) weights[f] = round3(Math.log((s + 1) / (ns + 2)) - Math.log((h + 1) / (nh + 2)));
  }
  return { version: 2, kind: 'nb', features: opts, bias: round3(Math.log(ns / nh)), threshold: 0, weights };
}

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Hyperparameters are fixed in advance (common defaults), not tuned.
function trainLR(examples, { chars = false, minDocs = chars ? 3 : 2, epochs = 25, lr0 = 0.2, l2 = 1e-5, seed = 1 } = {}) {
  const opts = { chars }, vocab = vocabulary(examples, opts, minDocs), index = new Map(vocab.map((f, i) => [f, i]));
  if (!examples.some(e => e.y) || examples.every(e => e.y)) throw new Error('training data needs both classes');
  const docs = examples.map(e => ({ y: e.y ? 1 : 0, ix: features(e.text, opts).map(f => index.get(f)).filter(i => i !== undefined) }));
  const w = new Float64Array(vocab.length), rnd = mulberry32(seed);
  let b = 0;
  const order = docs.map((_, i) => i);
  for (let ep = 0; ep < epochs; ep++) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const lr = lr0 / (1 + 0.3 * ep);
    for (const k of order) {
      const d = docs[k];
      let z = b; for (const i of d.ix) z += w[i];
      const g = 1 / (1 + Math.exp(-z)) - d.y;
      for (const i of d.ix) w[i] -= lr * (g + l2 * w[i]);
      b -= lr * g;
    }
  }
  const weights = {};
  vocab.forEach((f, i) => { const v = round3(w[i]); if (v !== 0) weights[f] = v; });
  return { version: 2, kind: 'lr', features: opts, bias: round3(b), threshold: 0, weights };
}

function score(model, text) {
  let s = model.bias;
  for (const f of features(text, model.features)) { const v = model.weights[f]; if (v !== undefined) s += v; }
  return s;
}
const predictor = model => text => score(model, text) >= model.threshold;
const sizeBytes = model => Buffer.byteLength(JSON.stringify(model));

/* Highest recall whose 95% precision lower bound stays at or above `minPrecisionLo`.
   Only validation data may be passed here. Returns null if no threshold qualifies. */
function chooseThreshold(scores, labels, minPrecisionLo) {
  const cands = [...new Set(scores)].sort((a, b) => a - b), totalPos = labels.filter(Boolean).length;
  let best = null;
  for (const t of cands) {
    let tp = 0, fp = 0;
    scores.forEach((s, i) => { if (s >= t) (labels[i] ? tp++ : fp++); });
    if (!tp) continue;
    const prec = wilson(tp, tp + fp), recall = totalPos ? tp / totalPos : 0;
    if (prec.lo >= minPrecisionLo && (!best || recall > best.recall || (recall === best.recall && t > best.threshold))) {
      best = { threshold: t, recall, precision: prec.value, precisionLo: prec.lo };
    }
  }
  return best;
}

module.exports = { features, trainNB, trainLR, score, predictor, sizeBytes, chooseThreshold };
