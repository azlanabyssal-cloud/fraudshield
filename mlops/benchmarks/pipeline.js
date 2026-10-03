'use strict';
/* Proxy-benchmark pipeline. Pure: takes rows [{ text, y }], returns results. No file or network access,
   so tests can run it on synthetic data.
   Protocol:
   1. split by hash of the normalised text into train / val / test (duplicates always share a split)
   2. choose the model configuration by grouped 5-fold cross-validation on train+val only
   3. fit the winner on train, set its threshold on val, then read the test split
   4. headline numbers use the test split with near-duplicates of training rows removed */
const crypto = require('node:crypto');
const { normalizeForDedup } = require('../../data_ops/holdout.js');
const { wilson, precisionAtPrevalence } = require('../metrics.js');
const { evaluate, compare } = require('../evaluate.js');
const { findLeakage } = require('../gate.js');
const detectors = require('../detectors.js');
const tm = require('./text_models.js');
const policy = require('../policy.json');

const SEED = 'fs-sms-v1';
const SPLITS = { train: 0.6, val: 0.2 };   // the remaining 20% is test
const FOLDS = 5, INNER_VAL = 0.25;
const MARGINS = [0.90, 0.95];              // precision lower bound required when picking a threshold

function unit(text, salt) {
  return crypto.createHash('sha256').update(salt + '|' + normalizeForDedup(text)).digest().readUInt32BE(0) / 4294967296;
}
function splitOf(text, seed = SEED) {
  const u = unit(text, seed);
  return u < SPLITS.train ? 'train' : u < SPLITS.train + SPLITS.val ? 'val' : 'test';
}
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function naiveSplit(rows, seed) {
  const idx = rows.map((_, i) => i), rnd = mulberry32(parseInt(crypto.createHash('sha256').update(seed).digest('hex').slice(0, 8), 16));
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const a = Math.floor(rows.length * SPLITS.train), b = a + Math.floor(rows.length * SPLITS.val);
  return { train: idx.slice(0, a).map(i => rows[i]), val: idx.slice(a, b).map(i => rows[i]), test: idx.slice(b).map(i => rows[i]) };
}

const asExamples = rows => rows.map((r, i) => ({ id: 'E' + i, text: r.text, y: r.y, language: 'en', category: r.y ? 'other_scam' : 'safe', source: 'sms', date: '', obfuscated: false }));
const counts = a => ({ rows: a.length, spam: a.filter(r => r.y).length });
const strip = ({ predictions, slices, ...rest }) => rest;

// Fixed list, decided before any comparison.
const CANDIDATES = [
  { name: 'nb_words', train: ex => tm.trainNB(ex, { chars: false }) },
  { name: 'nb_words_chars', train: ex => tm.trainNB(ex, { chars: true }) },
  { name: 'lr_words', train: ex => tm.trainLR(ex, { chars: false }) },
  { name: 'lr_words_chars', train: ex => tm.trainLR(ex, { chars: true }) }
];

function fit(candidate, train, val, margin) {
  const model = candidate.train(train);
  const pick = tm.chooseThreshold(val.map(r => tm.score(model, r.text)), val.map(r => r.y), margin);
  return { model: pick ? { ...model, threshold: pick.threshold } : model, pick };
}

/* Grouped k-fold over `pool`. Each held-out fold is scored by models fitted on the other folds, with the
   threshold set on a hash-chosen slice of those folds. Near-duplicates of the fitting rows are dropped from
   the held-out fold. Nothing outside `pool` is touched. */
function crossValidate(pool, seed) {
  const folds = Array.from({ length: FOLDS }, () => []);
  pool.forEach(r => folds[Math.min(FOLDS - 1, Math.floor(unit(r.text, seed + '|cv') * FOLDS))].push(r));
  const tally = {};   // config name -> pooled confusion + per-fold precision
  const cell = name => tally[name] || (tally[name] = { tp: 0, fp: 0, fn: 0, tn: 0, foldPrecision: [], foldsWithoutThreshold: 0 });
  folds.forEach((held, f) => {
    const rest = folds.flatMap((x, i) => (i === f ? [] : x));
    const inner = { train: [], val: [] };
    rest.forEach(r => inner[unit(r.text, seed + '|inner') < INNER_VAL ? 'val' : 'train'].push(r));
    const leak = new Set(findLeakage(asExamples(rest), asExamples(held), policy.nearDuplicateJaccard).map(l => l.sealedId));
    const heldClean = held.filter((_, i) => !leak.has('E' + i));
    CANDIDATES.forEach(c => {
      const model = c.train(inner.train);
      const valScores = inner.val.map(r => tm.score(model, r.text)), valY = inner.val.map(r => r.y);
      const heldScores = heldClean.map(r => tm.score(model, r.text));
      MARGINS.forEach(margin => {
        const t = cell(`${c.name}@${margin}`), pick = tm.chooseThreshold(valScores, valY, margin);
        if (!pick) { t.foldsWithoutThreshold++; return; }
        let tp = 0, fp = 0;
        heldClean.forEach((r, i) => { const flagged = heldScores[i] >= pick.threshold; if (r.y) { flagged ? t.tp++ : t.fn++; flagged && tp++; } else { flagged ? t.fp++ : t.tn++; flagged && fp++; } });
        if (tp + fp) t.foldPrecision.push(tp / (tp + fp));
      });
    });
  });
  return Object.entries(tally).map(([name, t]) => ({
    name, precision: wilson(t.tp, t.tp + t.fp), recall: wilson(t.tp, t.tp + t.fn), fpr: wilson(t.fp, t.fp + t.tn),
    precisionAtPrevalence: [0.05, 0.2].map(pi => ({ prevalence: pi, precision: precisionAtPrevalence(wilson(t.tp, t.tp + t.fn).lo, wilson(t.fp, t.fp + t.tn).hi, pi) })),
    foldPrecisionMin: t.foldPrecision.length ? Math.min(...t.foldPrecision) : null, foldPrecisionMax: t.foldPrecision.length ? Math.max(...t.foldPrecision) : null,
    foldsWithoutThreshold: t.foldsWithoutThreshold
  }));
}

// Highest cross-validated recall among configurations that fit the size budget and whose precision lower
// bound reaches the floor; ties go to the smaller model. Returns null when none qualifies.
function selectWinner(ranked, minPrecision) {
  const eligible = ranked.filter(c => !c.overBudget && c.precision.n > 0 && c.precision.lo >= minPrecision);
  if (!eligible.length) return null;
  return eligible.reduce((a, b) => (b.recall.value > a.recall.value || (b.recall.value === a.recall.value && b.sizeBytes < a.sizeBytes) ? b : a));
}

function runBenchmark(rows, { seed = SEED, maxModelBytes = policy.maxModelBytes } = {}) {
  const groups = { train: [], val: [], test: [] };
  rows.forEach(r => groups[splitOf(r.text, seed)].push(r));
  const split = { train: counts(groups.train), val: counts(groups.val), test: counts(groups.test) };

  // 2. configuration chosen on train+val only
  const cv = crossValidate([...groups.train, ...groups.val], seed);
  const sizes = Object.fromEntries(CANDIDATES.map(c => [c.name, tm.sizeBytes(c.train(groups.train))]));
  const ranked = cv.map(c => ({ ...c, sizeBytes: sizes[c.name.split('@')[0]], overBudget: sizes[c.name.split('@')[0]] > maxModelBytes }));
  const winner = selectWinner(ranked, policy.minPrecision);
  if (!winner) return { error: 'no configuration keeps the cross-validated precision lower bound at the target within the size budget', split, selection: { cv: ranked } };
  const [winnerName, winnerMargin] = [winner.name.split('@')[0], Number(winner.name.split('@')[1])];
  const candidate = CANDIDATES.find(c => c.name === winnerName);

  // 3. fit on train, threshold on val, then the test split
  const { model, pick } = fit(candidate, groups.train, groups.val, winnerMargin);
  if (!pick) return { error: 'winner has no valid threshold on the validation split', split, selection: { cv: ranked, winner: winner.name } };
  const trainEx = asExamples(groups.train), testAll = asExamples(groups.test);
  const leaks = findLeakage(trainEx, testAll, policy.nearDuplicateJaccard);
  const leakIds = new Set(leaks.map(l => l.sealedId));
  const test = testAll.filter(e => !leakIds.has(e.id));
  const cand = evaluate(test, tm.predictor(model));
  const base = { router_v0: evaluate(test, detectors.router_v0), always_scam: evaluate(test, detectors.always_scam), never_scam: evaluate(test, detectors.never_scam) };

  // contrast: the common naive random split, same recipe, same size
  const naive = naiveSplit(rows, seed + '|naive');
  const trainKeys = new Set(naive.train.map(r => normalizeForDedup(r.text)));
  const nf = fit(candidate, naive.train, naive.val, winnerMargin);
  const naiveEval = nf.pick ? evaluate(asExamples(naive.test), tm.predictor(nf.model)) : null;

  return {
    seed, split: { ...split, testAfterRemovingNearDuplicates: counts(test) },
    leakage: { nearOrExactDuplicatesRemovedFromTest: leaks.length, exact: leaks.filter(l => l.kind === 'exact').length },
    selection: { method: `grouped ${FOLDS}-fold cross-validation on train+val`, minPrecisionLowerBound: policy.minPrecision, maxModelBytes, cv: ranked, winner: winner.name },
    model: { kind: model.kind, sizeBytes: tm.sizeBytes(model), features: Object.keys(model.weights).length, threshold: model.threshold, thresholdChosenOn: 'validation', validation: pick },
    candidate: strip(cand), baselines: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, strip(v)])),
    vsRouterV0: compare(test, base.router_v0.predictions, cand.predictions),
    naiveSplitContrast: naiveEval && { testRowsAlsoInTrain: naive.test.filter(r => trainKeys.has(normalizeForDedup(r.text))).length, testRows: naive.test.length, precision: strip(naiveEval).precision, recall: strip(naiveEval).recall },
    _model: model
  };
}

module.exports = { selectWinner, runBenchmark, crossValidate, splitOf, naiveSplit, fit, CANDIDATES, MARGINS, SEED };
