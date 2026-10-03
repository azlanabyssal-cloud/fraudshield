#!/usr/bin/env node
'use strict';
/* Provenance for the shipped model, and the checks that keep it honest.
     node mlops/lineage.js              write mlops/lineage.json from what is on disk now
     node mlops/lineage.js --check      exit 1 if anything on disk no longer matches the record
     node mlops/lineage.js --reproduce  retrain from the pinned public data into a temp folder, exit 1 unless the model file is
                                        byte-for-byte the shipped one, and record the proof (date, hash, seconds)
   What it ties together: the model file's SHA-256, the pinned digests of the datasets it was trained on, the trainer's own files, a
   fingerprint of the feature code, the hyper-parameters and the one-shot test result. Why a fingerprint of behaviour and not of the file:
   the serving code (lib/urlmodel.js) and the trainer share one feature function; if it ever changed without retraining, the browser would
   compute different numbers from the ones the weights were learned on (train/serve skew) and nothing would crash. The fingerprint is the
   hash of what that function outputs for a fixed set of probe names plus the keyword and brand lists it counts, so a harmless edit elsewhere in the file does not trip it and a
   changed feature always does. The training data is public and pinned by digest (never committed), so git plus these digests is the
   same guarantee a data-versioning tool would give. The private message set (data_ops) is another matter; see mlops/README.md. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const P = {
  model: path.join(ROOT, 'data', 'urlmodel.json'),
  result: path.join(ROOT, 'mlops', 'benchmarks', 'results', 'url_domain_model.json'),
  lineage: process.env.FS_LINEAGE || path.join(__dirname, 'lineage.json'),
  trainer: ['mlops/urlmodel/train.js', 'mlops/urlmodel/data.js', 'mlops/metrics.js']
};
const weightsOf = m => [...m.ngram.q, ...m.eng, ...m.tld];
const isInt8 = w => w.every(x => Number.isInteger(x) && x >= -128 && x <= 127);
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const fileSha = f => sha(fs.readFileSync(path.isAbsolute(f) ? f : path.join(ROOT, f)));

// Fixed probe names: ordinary, hyphenated, digit-heavy, brand-like, long, short, unusual endings, internationalised. Never change one without regenerating.
const PROBES = ['google.com', 'amazon.in', 'sbi-kyc-update.tk', 'hdfc-bank-login.xyz', 'secure-paytm-refund.top', 'a1b2c3d4e5.info', 'verify-account-now.club', 'icicibank.co.in',
  'flipkart-offers-2026.shop', 'xn--pypal-4ve.com', 'my-free-gift-card.online', 'irctc-ticket-help.cc', 'wa.me', 'x.co', 'bit-ly-claim-prize.work', 'support-airtel-care.live',
  'netflix-billing-update.site', 'phonepe-reward-claim.in', 'online-loan-approval-fast.cfd', 'cryptoinvest-profit-daily.io', 'gov-india-subsidy.org', 'kotak-netbanking.com',
  'zxqvbnmlkjhgfdsa.biz', 'aaaaaaaaaaaa.net', '0123456789.com', 'a-b-c-d-e-f-g.co.uk', 'thequickbrownfoxjumpsoverthelazydog.com', 'ministry-of-finance-notice.in', 'apple-id-locked.top',
  'microsoft-support-call.xyz', 'binance-wallet-verify.pro', 'insta-follower-boost.in', 'electricity-bill-pending.in', 'courier-delivery-failed.vip', 'job-offer-work-from-home.live'];

function featureFingerprint(M, model) {
  const rows = PROBES.map(h => {
    const d = M.inScope(h, model);
    if (!d) return [h, null];
    const f = M.features(d.name, d.suffix, model.spec);
    return [h, d.name, d.suffix, M.engineered(d.name, d.suffix).map(x => Math.round(x * 1e9) / 1e9), f.idx, f.val.map(x => Math.round(x * 1e9) / 1e9)];
  });
  // Probes alone cannot see a keyword or brand they do not happen to contain, so the lists themselves are part of the fingerprint.
  const lists = { keys: M.KEYS, brands: M.BRANDS, engineered: M.ENGINEERED };
  return { fingerprint: sha(JSON.stringify({ rows, lists })), probes: PROBES.length, inScope: rows.filter(r => r[1] !== null).length, hashBits: model.spec.hashBits, ngram: model.spec.ngram, engineered: M.ENGINEERED.length, keywords: M.KEYS.length, brands: M.BRANDS.length };
}

function build(extra = {}) {
  const M = require('../lib/urlmodel.js'), model = JSON.parse(fs.readFileSync(P.model, 'utf8')), result = JSON.parse(fs.readFileSync(P.result, 'utf8'));
  M.validate(model);
  const t = result.test;
  return {
    _readme: 'Written by mlops/lineage.js. Everything here is recomputed and compared by `npm run model:lineage:check` (tests and CI run it). Do not edit by hand.',
    schema: 1,
    model: { file: 'data/urlmodel.json', sha256: fileSha(P.model), bytes: fs.statSync(P.model).size, version: model.version, trained: model.trained, quantisation: { type: 'int8', weights: weightsOf(model).length, min: Math.min(...weightsOf(model)), max: Math.max(...weightsOf(model)), scale: model.scale, note: 'every stored weight is an integer in [-128, 127]; the browser divides by the scale' }, format: 'JSON, evaluated in plain JavaScript (ADR-0010: no ONNX runtime for a 127 KB linear model)' },
    features: featureFingerprint(M, model),
    trainer: Object.fromEntries(P.trainer.map(f => [f, fileSha(f)])),
    data: { sources: result.sources, artifacts: result.datasetArtifacts, counts: { phishing: result.counts.phishing, legitimate: result.counts.legitimate, bySplit: result.counts.bySplit }, note: 'public corpora, fetched on demand and hash-checked against the digests pinned in mlops/urlmodel/data.js; never committed' },
    protocol: { hyperparameters: result.hyperparameters.chosen, calibration: 'Platt on validation', thresholds: 'chosen on validation at fixed false-alarm rates', split: 'by owner-chosen name; test scored once' },
    evaluation: { proxy: result.proxy, claimable: result.claimable, testAuc: t.auc, testAucCi95: t.aucCi95, strict: { recall: t.atHighThreshold.recall.value, falseAlarm: t.atHighThreshold.falseAlarm.value }, resultFile: 'mlops/benchmarks/results/url_domain_model.json', resultSha256: fileSha(P.result) },
    reproduction: extra.reproduction || null
  };
}

// Returns a list of problems; empty means the record matches the disk.
function check(record) {
  const problems = [], M = require('../lib/urlmodel.js');
  if (!record || record.schema !== 1) return ['mlops/lineage.json is missing or has an unknown schema: run "npm run model:lineage"'];
  const model = JSON.parse(fs.readFileSync(P.model, 'utf8'));
  const modelSha = fileSha(P.model);
  if (modelSha !== record.model.sha256) problems.push(`the shipped model (${modelSha.slice(0, 12)}) is not the recorded one (${record.model.sha256.slice(0, 12)}): retrain, then run "npm run model:reproduce"`);
  if (fs.statSync(P.model).size !== record.model.bytes) problems.push('the model file size differs from the record');
  if (fs.existsSync(P.result)) { if (fileSha(P.result) !== record.evaluation.resultSha256) problems.push('the evaluation result file changed since the model was recorded'); const r = JSON.parse(fs.readFileSync(P.result, 'utf8')); if (r.modelSha256 !== modelSha) problems.push('the evaluation scored a different model file than the one shipped'); }
  else problems.push('the evaluation result file is missing');
  if (!isInt8(weightsOf(model))) problems.push('the weights are no longer all int8 integers: the recorded quantisation (4x smaller than float32) no longer holds');
  let fp; try { fp = featureFingerprint(M, model); } catch (e) { problems.push('the feature code cannot be run: ' + e.message); }
  if (fp && fp.fingerprint !== record.features.fingerprint) problems.push('the feature code now computes different numbers from the ones the weights were trained on (train/serve skew): retrain, or revert the change');
  for (const f of P.trainer) if (fileSha(f) !== record.trainer[f]) problems.push(`${f} changed since the model was recorded: run "npm run model:reproduce" to prove the model still comes out identical, which also re-records it`);
  const rep = record.reproduction;
  if (!rep) problems.push('no reproduction proof is recorded: run "npm run model:reproduce"');
  else if (rep.sha256 !== record.model.sha256) problems.push('the recorded reproduction was of a different model than the shipped one: run "npm run model:reproduce"');
  return problems;
}

function reproduce() {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'fs-repro-')), t0 = Date.now();
  const run = spawnSync(process.execPath, [path.join(ROOT, 'mlops', 'urlmodel', 'train.js')], { env: { ...process.env, FS_URLMODEL_OUT: path.join(dir, 'model.json'), FS_BENCH_RESULTS: dir }, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (run.status !== 0) return { ok: false, why: 'training failed: ' + (run.stderr || run.stdout).split('\n').slice(-6).join('\n') };
  const again = sha(fs.readFileSync(path.join(dir, 'model.json'))), shipped = fileSha(P.model);
  fs.rmSync(dir, { recursive: true, force: true });
  if (again !== shipped) return { ok: false, why: `retraining from the pinned data gives ${again.slice(0, 12)}, not the shipped ${shipped.slice(0, 12)}: the pipeline is not reproducible, or the data or trainer changed` };
  return { ok: true, proof: { sha256: shipped, seconds: Math.round((Date.now() - t0) / 1000), node: process.version, verifiedAt: new Date().toISOString().slice(0, 10), method: 'retrained from the pinned public data into a temporary folder; the model file is byte-for-byte identical' } };
}

function main(argv) {
  const read = () => (fs.existsSync(P.lineage) ? JSON.parse(fs.readFileSync(P.lineage, 'utf8')) : null);
  if (argv.includes('--check')) { const p = check(read()); p.forEach(x => console.error('lineage: ' + x)); if (!p.length) console.log('lineage: the model, data, trainer and features match the record'); return p.length ? 1 : 0; }
  if (argv.includes('--reproduce')) {
    const r = reproduce(); if (!r.ok) { console.error('reproduce: ' + r.why); return 1; }
    fs.writeFileSync(P.lineage, JSON.stringify(build({ reproduction: r.proof }), null, 2) + '\n');
    console.log(`reproduce: identical model (${r.proof.sha256.slice(0, 12)}) in ${r.proof.seconds}s; mlops/lineage.json updated`); return 0;
  }
  const keep = read(); fs.writeFileSync(P.lineage, JSON.stringify(build({ reproduction: keep && keep.reproduction }), null, 2) + '\n');
  console.log('lineage: mlops/lineage.json written (run --reproduce to refresh the proof)'); return 0;
}

module.exports = { PROBES, featureFingerprint, build, check, reproduce, P, fileSha };
if (require.main === module) process.exit(main(process.argv.slice(2)));
