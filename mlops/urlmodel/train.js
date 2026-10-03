'use strict';
/* Trains and evaluates the domain-name model. Usage: node mlops/urlmodel/train.js   (fetches and hash-checks the public data on first run)

   Protocol, fixed before any number was seen:
   - features come from lib/urlmodel.js, the same file the browser runs, so training and serving cannot disagree
   - train / validation / test are split by the owner-chosen name; hyperparameters, the calibration and both alert thresholds
     are chosen on VALIDATION only; the test split is scored once, through the deployed (quantised) model, at the end
   - the weights are trained on the training split alone, so the validation thresholds stay honest (no refit on train+val)
   - every number is reported with ablations and shortcut baselines, and with the rule-based analyzer measured on the same test rows */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const M = require('../../lib/urlmodel.js');
const Link = require('../../lib/linkcheck.js');
const { wilson, auc, precisionAtPrevalence } = require('../metrics.js');
const D = require('./data.js');

const ROOT = path.join(__dirname, '..', '..');
const OUT_MODEL = process.env.FS_URLMODEL_OUT || path.join(ROOT, 'data', 'urlmodel.json');
const OUT_RESULT = path.join(process.env.FS_BENCH_RESULTS || path.join(ROOT, 'mlops', 'benchmarks', 'results'), 'url_domain_model.json');
const BINS = 12, MIN_TLD = 30, SCALE = 20, PRUNE = 0.1, ALERT_FPR = { high: 0.001, elevated: 0.01 };
// 14 hash bits keeps the shipped file near 120 KB. The 16-bit run is only a reference: it gains 0.008 AUC for five times the size.
// More epochs overfit (measured: 16 epochs scored below 6), so the epoch count and L2 strength are searched, not assumed.
const GRID = { hashBits: [14], l2: [1e-4, 1e-3, 1e-2], epochs: [2, 3, 4], lr: 0.2, reference: { hashBits: 16 } };

const rng = seed => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const sigmoid = z => 1 / (1 + Math.exp(-z));
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const round = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

/* ---------- spec and matrices ---------- */
function quantileEdges(values, bins) {
  const s = Float64Array.from(values).sort(), edges = [];
  for (let i = 1; i < bins; i++) { const e = s[Math.floor(i * s.length / bins)]; if (!edges.length || e > edges[edges.length - 1]) edges.push(e); }
  while (edges.length && edges[edges.length - 1] >= s[s.length - 1]) edges.pop();   // the last bin must be reachable
  return edges;
}
function buildSpec(trainRows, hashBits) {
  const eng = trainRows.map(r => M.engineered(r.name, r.suffix));
  const bins = M.ENGINEERED.map((_, i) => quantileEdges(eng.map(e => e[i]), BINS));
  const counts = new Map(); trainRows.forEach(r => counts.set(r.suffix, (counts.get(r.suffix) || 0) + 1));
  const tlds = [...counts].filter(([, n]) => n >= MIN_TLD).map(([s]) => s).sort();
  return { hashBits, ngram: [1, 5], bins, tlds };
}
const matrix = (rows, spec) => rows.map(r => M.features(r.name, r.suffix, spec));

/* ---------- logistic regression, Adagrad, seeded ---------- */
function fit(X, y, size, { l2, epochs, lr, seed = 1 }) {
  const w = new Float64Array(size), G = new Float64Array(size).fill(0), order = Int32Array.from(X.keys());
  let b = 0, Gb = 0; const rand = rng(seed);
  for (let e = 0; e < epochs; e++) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (const r of order) {
      const f = X[r]; let z = b; for (let k = 0; k < f.idx.length; k++) z += w[f.idx[k]] * f.val[k];
      const err = sigmoid(z) - y[r];
      for (let k = 0; k < f.idx.length; k++) { const i = f.idx[k], g = err * f.val[k] + l2 * w[i]; G[i] += g * g; w[i] -= lr * g / (Math.sqrt(G[i]) + 1e-8); }
      Gb += err * err; b -= lr * err / (Math.sqrt(Gb) + 1e-8);
    }
  }
  return { w, b };
}
const scores = (m, X) => X.map(f => { let z = m.b; for (let k = 0; k < f.idx.length; k++) z += m.w[f.idx[k]] * f.val[k]; return z; });

// Platt scaling by Newton's method on (score -> label). Two parameters; the validation split is large enough that this cannot overfit.
function platt(z, y) {
  let a = 1, b = 0;
  for (let it = 0; it < 50; it++) {
    let ga = 0, gb = 0, haa = 0, hab = 0, hbb = 0;
    for (let i = 0; i < z.length; i++) { const p = sigmoid(a * z[i] + b), d = p - y[i], h = p * (1 - p); ga += d * z[i]; gb += d; haa += h * z[i] * z[i]; hab += h * z[i]; hbb += h; }
    const det = haa * hbb - hab * hab; if (Math.abs(det) < 1e-12) break;
    const da = (hbb * ga - hab * gb) / det, db = (haa * gb - hab * ga) / det; a -= da; b -= db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  return { a: round(a, 5), b: round(b, 5) };
}

// The score at or above which at most `fpr` of the legitimate side is flagged.
function thresholdForFpr(legitScores, fpr) {
  const s = Float64Array.from(legitScores).sort();
  return s[Math.min(s.length - 1, Math.ceil(s.length * (1 - fpr)))] + 1e-9;
}

/* ---------- the deployed artifact ---------- */
function toModel(spec, m, z, y, meta) {
  const lay = M.layout(spec), q = x => Math.round(x * SCALE);
  const ngramQ = [];
  for (let i = 0; i < lay.H; i++) { const v = Math.abs(m.w[i]) < PRUNE ? 0 : q(m.w[i]); if (v !== 0) ngramQ.push([i, v]); }   // tiny weights are noise from rare n-grams
  const model = {
    version: 1, scale: SCALE, spec, bias: q(m.b),
    ngram: { idx: ngramQ.map(p => p[0]), q: ngramQ.map(p => p[1]) },
    eng: Array.from(m.w.slice(lay.H, lay.tldAt), q), tld: Array.from(m.w.slice(lay.tldAt), q),
    calibration: { a: 1, b: 0 }, thresholds: { high: { score: 0, fpr: ALERT_FPR.high }, elevated: { score: 0, fpr: ALERT_FPR.elevated } }, ...meta
  };
  return model;
}

const bootstrapAuc = (zs, ys, reps = 200, seed = 11) => {
  const rand = rng(seed), n = zs.length, out = [];
  for (let r = 0; r < reps; r++) { const s = [], l = []; for (let i = 0; i < n; i++) { const j = Math.floor(rand() * n); s.push(zs[j]); l.push(ys[j]); } out.push(auc(s, l)); }
  out.sort((a, b) => a - b); return [round(out[Math.floor(0.025 * reps)]), round(out[Math.floor(0.975 * reps)])];
};
const atThreshold = (zs, ys, thr) => {
  let tp = 0, fn = 0, fp = 0, tn = 0;
  zs.forEach((z, i) => { if (ys[i]) { if (z >= thr) tp++; else fn++; } else if (z >= thr) fp++; else tn++; });
  const recall = wilson(tp, tp + fn), fpr = wilson(fp, fp + tn);
  return { flagged: { phishing: tp, legitimate: fp }, recall: { value: round(tp / (tp + fn)), lo: round(recall.lo), hi: round(recall.hi) }, falseAlarm: { value: round(fp / (fp + tn), 5), lo: round(fpr.lo, 5), hi: round(fpr.hi, 5) },
    precisionIfPrevalence: Object.fromEntries([0.01, 0.1, 0.3].map(p => [p, round(precisionAtPrevalence(tp / (tp + fn), fp / (fp + tn), p), 3)])) };
};

/* ---------- the run ---------- */
async function main() {
  const t0 = Date.now(), data = await D.load();
  const by = s => data.rows.filter(r => r.split === s), train = by('train'), val = by('val'), test = by('test');
  const label = rows => rows.map(r => r.y);
  console.log('domains', data.counts.domains, 'train/val/test', train.length, val.length, test.length);

  // 1. hyperparameters, chosen on validation AUC only
  const grid = []; let best = null;
  for (const hashBits of GRID.hashBits) {
    const spec = buildSpec(train, hashBits), Xtr = matrix(train, spec), Xva = matrix(val, spec), size = M.layout(spec).size;
    for (const l2 of GRID.l2) for (const epochs of GRID.epochs) {
      const m = fit(Xtr, label(train), size, { l2, epochs, lr: GRID.lr });
      const a = auc(scores(m, Xva), label(val)); grid.push({ hashBits, l2, epochs, valAuc: round(a) });
      console.log(`  hashBits=${hashBits} l2=${l2} epochs=${epochs}  val AUC ${a.toFixed(4)}`);
      if (!best || a > best.a + 1e-4) best = { a, hashBits, l2, epochs, spec, m };
    }
  }
  console.log('chosen', best.hashBits, best.l2, best.epochs, 'val AUC', best.a.toFixed(4));
  const refSpec = buildSpec(train, GRID.reference.hashBits);
  const refModel = fit(matrix(train, refSpec), label(train), M.layout(refSpec).size, { l2: best.l2, epochs: best.epochs, lr: GRID.lr });
  const referenceValAuc = round(auc(scores(refModel, matrix(val, refSpec)), label(val)));

  // 2. calibration and thresholds on validation, through the quantised model that will actually ship
  const meta = { trained: new Date().toISOString().slice(0, 10), platforms: data.platforms };
  const model = toModel(best.spec, best.m, null, null, meta);
  const scoreRows = (rows, mod) => rows.map(r => { const s = M.score(r.reg, mod); return s ? s.score : null; });
  const zVal = scoreRows(val, model), keep = zVal.map((z, i) => z !== null ? i : -1).filter(i => i >= 0);
  const zv = keep.map(i => zVal[i]), yv = keep.map(i => val[i].y);
  model.calibration = platt(zv, yv);
  model.thresholds = { high: { score: round(thresholdForFpr(zv.filter((_, i) => !yv[i]), ALERT_FPR.high), 4), fpr: ALERT_FPR.high }, elevated: { score: round(thresholdForFpr(zv.filter((_, i) => !yv[i]), ALERT_FPR.elevated), 4), fpr: ALERT_FPR.elevated } };
  const quantisedValAuc = auc(zv, yv);
  console.log('quantised val AUC', quantisedValAuc.toFixed(4), 'thresholds', JSON.stringify(model.thresholds), 'model bytes', JSON.stringify(model).length);

  // 3. the one look at the test split
  const zTest = scoreRows(test, model), tk = zTest.map((z, i) => z !== null ? i : -1).filter(i => i >= 0);
  const zt = tk.map(i => zTest[i]), yt = tk.map(i => test[i].y);
  const testAuc = auc(zt, yt);
  // What the interface may say about the model, taken from the one test run, so the wording can never drift from the measurement.
  const atHigh = atThreshold(zt, yt, model.thresholds.high.score), atElevated = atThreshold(zt, yt, model.thresholds.elevated.score);
  model.card = { high: { recall: atHigh.recall.value, falseAlarm: atHigh.falseAlarm.value }, elevated: { recall: atElevated.recall.value, falseAlarm: atElevated.falseAlarm.value }, auc: round(testAuc, 3), basis: 'held-out test split, scored once' };
  const result = {
    model: 'domain-name-logistic-regression', proxy: true, claimable: false,
    warning: 'Trained and tested on reported-phishing hosts and ranked legitimate domains. It sees only the registered name and its ending, never the page. NOT a measure of FraudShield on real Indian links. Never present these figures as product accuracy.',
    date: new Date().toISOString().slice(0, 10),
    sources: { phiusiil: { url: D.SOURCES.phiusiil.url, zipSha256: D.SOURCES.phiusiil.zipSha, csvSha256: D.SOURCES.phiusiil.sha, licence: 'CC BY 4.0' }, tranco: { listId: D.SOURCES.tranco.listId, csvSha256: D.SOURCES.tranco.sha } },
    datasetArtifacts: data.artifacts, counts: data.counts,
    protocol: 'Split by owner-chosen name (70/15/15). Hyperparameters, calibration and thresholds chosen on validation only; test scored once through the quantised deployed model. Platform tenants excluded.',
    hyperparameters: { chosen: { hashBits: best.hashBits, l2: best.l2, epochs: best.epochs, lr: GRID.lr }, grid, reference16BitValAuc: referenceValAuc, quantisation: { scale: SCALE, pruneBelow: PRUNE } },
    validation: { auc: round(quantisedValAuc) },
    test: {
      n: { phishing: yt.filter(Boolean).length, legitimate: yt.filter(v => !v).length, outOfScope: test.length - tk.length },
      auc: round(testAuc), aucCi95: bootstrapAuc(zt, yt),
      atHighThreshold: atHigh, atElevatedThreshold: atElevated
    }
  };

  // 4. what carries the signal, and what a lazy model would score
  const lay = M.layout(best.spec), Xte = matrix(test, best.spec), Xtr = matrix(train, best.spec), ytr = label(train), yte = label(test);
  const subset = (X, lo, hi) => X.map(f => { const idx = [], val2 = []; f.idx.forEach((i, k) => { if (i >= lo && i < hi) { idx.push(i); val2.push(f.val[k]); } }); return { idx, val: val2 }; });
  const ablate = (lo, hi) => { const m = fit(subset(Xtr, lo, hi), ytr, lay.size, { l2: best.l2, epochs: best.epochs, lr: GRID.lr }); return round(auc(scores(m, subset(Xte, lo, hi)), yte)); };
  result.test.ablationAuc = { nameNgramsOnly: ablate(0, lay.H), engineeredOnly: ablate(lay.H, lay.tldAt), endingOnly: ablate(lay.tldAt, lay.size) };
  result.test.baselineAuc = { nameLengthOnly: round(auc(test.map(r => r.name.length), yte)), digitsOnly: round(auc(test.map(r => (r.name.match(/\d/g) || []).length), yte)), coinFlip: 0.5 };

  // 5. the rule-based analyzer on the same held-out addresses, with and without the model's soft warning
  const levels = (rows, withModel) => {
    M.install(withModel ? model : null);
    const out = { phishing: { scam: 0, suspicious: 0, unverified: 0, official: 0 }, legitimate: { scam: 0, suspicious: 0, unverified: 0, official: 0 } };
    for (const r of rows) out[r.y ? 'phishing' : 'legitimate'][Link.analyzeUrl('https://' + r.reg + '/').level]++;
    return out;
  };
  result.test.rules = { withoutModel: levels(test, false), withModel: levels(test, true) };
  result.model = model;
  fs.mkdirSync(path.dirname(OUT_MODEL), { recursive: true }); fs.mkdirSync(path.dirname(OUT_RESULT), { recursive: true });
  const shipped = { ...model }; delete shipped._w;
  fs.writeFileSync(OUT_MODEL, JSON.stringify(shipped) + '\n');
  const out = { ...result, model: undefined, modelSha256: sha(fs.readFileSync(OUT_MODEL)), modelBytes: fs.statSync(OUT_MODEL).size, codeSha256: { 'urlmodel.js': sha(fs.readFileSync(path.join(ROOT, 'lib', 'urlmodel.js'))), 'train.js': sha(fs.readFileSync(__filename)), 'data.js': sha(fs.readFileSync(path.join(__dirname, 'data.js'))) } };
  fs.writeFileSync(OUT_RESULT, JSON.stringify(out, null, 2) + '\n');
  const t = out.test;
  console.log(`\nTEST (scored once): AUC ${t.auc} [${t.aucCi95}]  ablation ${JSON.stringify(t.ablationAuc)}  baselines ${JSON.stringify(t.baselineAuc)}`);
  for (const k of ['atHighThreshold', 'atElevatedThreshold']) console.log(k, 'recall', t[k].recall.value, `[${t[k].recall.lo}-${t[k].recall.hi}]`, 'false alarm', t[k].falseAlarm.value, `[${t[k].falseAlarm.lo}-${t[k].falseAlarm.hi}]`, 'precision at 1/10/30% prevalence', JSON.stringify(t[k].precisionIfPrevalence));
  console.log('rules alone on test:        ', JSON.stringify(t.rules.withoutModel));
  console.log('rules + name model on test: ', JSON.stringify(t.rules.withModel));
  console.log(`model ${out.modelBytes} bytes, sha ${out.modelSha256.slice(0, 12)}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

if (require.main === module) main().catch(e => { console.error(e.stack || e.message); process.exit(1); });
module.exports = { quantileEdges, buildSpec, matrix, fit, scores, platt, thresholdForFpr, toModel, atThreshold, rng, sigmoid, SCALE, ALERT_FPR };
