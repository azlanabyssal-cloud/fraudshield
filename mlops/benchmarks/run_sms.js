'use strict';
// Usage: node mlops/benchmarks/run_sms.js   (downloads and verifies the dataset on first run)
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { load, parseSms, TXT_SHA256, SOURCE } = require('./fetch_sms.js');
const { runBenchmark, loadPolicy } = require('./pipeline.js');
const { adjustedVerdict } = require('../gate.js');
const { normalizeForDedup } = require('../../data_ops/holdout.js');

const pct = c => c.value === null ? 'n/a' : `${(100 * c.value).toFixed(1)}% [${(100 * c.lo).toFixed(1)}-${(100 * c.hi).toFixed(1)}]`;
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, f))).digest('hex');

(async () => {
  const policy = loadPolicy();
  const rows = parseSms(await load());
  const keyed = new Map();
  rows.forEach(r => { const k = normalizeForDedup(r.text); (keyed.get(k) || keyed.set(k, []).get(k)).push(r.y); });
  const dup = [...keyed.values()].filter(v => v.length > 1);
  const data = { rows: rows.length, spam: rows.filter(r => r.y).length, uniqueTexts: keyed.size, rowsInDuplicateGroups: dup.reduce((s, v) => s + v.length, 0), duplicateGroupsWithConflictingLabels: dup.filter(v => new Set(v).size > 1).length };
  const { _model, ...res } = runBenchmark(rows, { policy });
  if (res.error) { console.error(res.error); process.exit(1); }

  const out = {
    benchmark: 'uci-sms-spam', proxy: true, claimable: false,
    warning: 'English SMS spam from a different era and country. A proxy benchmark for the evaluation pipeline, NOT a measure of FraudShield. Never quote these numbers as the product\'s accuracy.',
    source: SOURCE, license: 'CC BY 4.0', dataset_sha256: TXT_SHA256, date: new Date().toISOString().slice(0, 10),
    gateAtPolicyPrevalence: (({ verdict, reason, point, conservative, prevalence }) => ({ verdict, reason: reason || null, adjustedPrecision: point, worstCase: conservative, prevalence, target: policy.minPrecision }))(adjustedVerdict(res.candidate, policy)),
    testLooks: 2,
    disclosure: 'The test split was read twice. Look 1 used naive Bayes chosen on one validation split: precision 89.7% [83.1-93.9], recall 95.0% [89.4-97.7]. That result prompted replacing single-split selection with cross-validation on train+val. Look 2 is the headline below. Every configuration was compared without the test split.',
    code_sha256: { 'text_models.js': sha('text_models.js'), 'pipeline.js': sha('pipeline.js') }, data, ...res
  };
  const outDir = process.env.FS_BENCH_RESULTS || path.join(__dirname, 'results');   // injectable
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'uci_sms_spam.json'), JSON.stringify(out, null, 2) + '\n');

  const row = (name, e) => `${name.padEnd(14)} precision ${pct(e.precision).padEnd(22)} recall ${pct(e.recall).padEnd(22)} false-alarm ${pct(e.fpr)}`;
  console.log(`PROXY BENCHMARK (not FraudShield): ${data.rows} rows, ${data.spam} spam, ${data.uniqueTexts} unique texts, ${data.rowsInDuplicateGroups} rows in duplicate groups`);
  console.log(`split train/val/test: ${res.split.train.rows}/${res.split.val.rows}/${res.split.test.rows}; test after removing ${res.leakage.nearOrExactDuplicatesRemovedFromTest} near-duplicates of train: ${res.split.testAfterRemovingNearDuplicates.rows} rows (${res.split.testAfterRemovingNearDuplicates.spam} spam)`);
  console.log(`selection by ${res.selection.method} (test split not involved):`); res.selection.cv.forEach(c => console.log(`  ${c.name.padEnd(22)} ${String(c.sizeBytes).padStart(7)} B  precision ${pct(c.precision).padEnd(22)} recall ${pct(c.recall).padEnd(22)}precision at ${c.atPrevalence.map(a => a.prevalence * 100 + '%').join('/')} scam share ${c.atPrevalence.map(a => (100 * a.point).toFixed(0) + '%').join('/')}${c.overBudget ? '  OVER SIZE BUDGET' : ''}`));
  console.log(`winner: ${res.selection.winner} (${res.model.kind}, ${res.model.sizeBytes} bytes, ${res.model.features} features)`);
  console.log(row(res.selection.winner, res.candidate)); Object.entries(res.baselines).forEach(([k, v]) => console.log(row(k, v)));
  console.log(`p95 latency ${res.candidate.latencyMs.p95.toFixed(3)} ms (Node, not a phone); vs router_v0: McNemar p=${res.vsRouterV0.p.toExponential(2)}, ${res.vsRouterV0.candidateOnlyCorrect} rows only the model got right, ${res.vsRouterV0.baselineOnlyCorrect} only the router`);
  console.log('adjusted precision on the test split (point, worst case): ' + res.candidate.atPrevalence.map(a => `${a.prevalence * 100}% scam share -> ${(100 * a.point).toFixed(1)}% (${(100 * a.conservative).toFixed(1)}%)`).join(', '));
  const g = out.gateAtPolicyPrevalence; console.log(`GATE at ${g.prevalence * 100}% scam share, target ${g.target * 100}%: ${g.verdict.toUpperCase()}${g.reason ? ' - ' + g.reason : ''}`);
  if (res.naiveSplitContrast) { const n = res.naiveSplitContrast; console.log(`naive random split: ${n.testRowsAlsoInTrain}/${n.testRows} test rows also in train; precision ${pct(n.precision)}, recall ${pct(n.recall)}`); }
})().catch(e => { console.error(e.message); process.exit(1); });
