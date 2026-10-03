'use strict';
/* Release gate. Three-valued on purpose: with a few hundred rows many claims can be neither
   confirmed nor rejected, and the gate says so instead of rounding up.
   PASS          every criterion met with its 95% interval on the right side (precision is prevalence-adjusted)
   INCONCLUSIVE  nothing failed, but at least one criterion is not proven at this sample size
   FAIL          a criterion failed, a regression is significant, or the test data leaks
   NO_EVIDENCE   the dataset is missing or below its stage minimum, so nothing was measured */
const { finalChecks, normalizeForDedup } = require('../data_ops/holdout.js');
const { negativesNeededToProve } = require('./metrics.js');
const { adjusted } = require('./evaluate.js');

function tokens(text) { return new Set(normalizeForDedup(text).split(' ').filter(Boolean)); }
function jaccard(a, b) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Rows in `sealed` that also appear (exactly, or nearly) in `dev`. A leaked test set inflates every metric.
function findLeakage(dev, sealed, threshold = 0.85) {
  const exact = new Map(dev.map(e => [normalizeForDedup(e.text), e.id]));
  const devTok = dev.map(e => ({ id: e.id, t: tokens(e.text) }));
  const hits = [];
  for (const s of sealed) {
    const key = normalizeForDedup(s.text);
    if (exact.has(key)) { hits.push({ sealedId: s.id, devId: exact.get(key), kind: 'exact' }); continue; }
    const st = tokens(s.text);
    if (st.size < 4) continue;
    for (const d of devTok) {
      if (d.t.size >= 4 && jaccard(st, d.t) >= threshold) { hits.push({ sealedId: s.id, devId: d.id, kind: 'near' }); break; }
    }
  }
  return hits;
}

// Gate decision on prevalence-adjusted precision. Raw precision on a test set depends on how many genuine
// messages the test set happens to hold, so it is reported but never used to decide.
//   failed   the measured (point) adjusted precision is below the target
//   met      even the conservative bound (low recall, high false-alarm rate) reaches the target
//   unproven the point estimate reaches the target but the data cannot prove it
function adjustedVerdict(report, policy) {
  const adj = adjusted(report, policy.prevalence);
  if (adj.point === null) return { ...adj, verdict: 'failed', reason: 'recall or false-alarm rate cannot be measured (no scam rows or no genuine rows)' };
  if (adj.point < policy.minPrecision) return { ...adj, verdict: 'failed', reason: `prevalence-adjusted precision ${(100 * adj.point).toFixed(1)}% at ${policy.prevalence * 100}% scam share is below ${policy.minPrecision * 100}%` };
  if (adj.conservative >= policy.minPrecision) return { ...adj, verdict: 'met' };
  const need = negativesNeededToProve(report.recall.lo, policy.minPrecision, policy.prevalence);
  return { ...adj, verdict: 'unproven', reason: `adjusted precision ${(100 * adj.point).toFixed(1)}% at ${policy.prevalence * 100}% scam share reaches ${policy.minPrecision * 100}% but is not proven: worst case ${(100 * adj.conservative).toFixed(1)}%. Proving it needs about ${need} genuine messages with no false alarms; there are ${report.fpr.n}` };
}

function gate({ stats, stage, report, comparison, leakage, policy }) {
  const evidenceProblems = stats ? finalChecks(stats, stage) : ['no dataset'];
  if (evidenceProblems.length) return { status: 'NO_EVIDENCE', reasons: evidenceProblems, criteria: {} };

  const reasons = [];
  const adj = adjustedVerdict(report, policy);
  const criteria = {
    // a model that flags nothing is broken, not "inconclusive" (0/0 precision is defined as 0)
    flagsSomething: report.precision.flagsNothing ? 'failed' : 'met',
    catchesScams: report.tp > 0 ? 'met' : 'failed',
    adjustedPrecision: adj.verdict,
    latency: report.latencyMs.p95 <= policy.maxP95LatencyMs ? 'met' : 'failed'
  };
  if (report.precision.flagsNothing) reasons.push('FATAL: Model Flags Nothing (TP+FP = 0, precision 0/0 defined as 0, recall 0)');
  else if (report.tp === 0) reasons.push('detector caught no scams');
  if (adj.reason && !report.precision.flagsNothing) reasons.push(adj.reason);
  if (criteria.latency === 'failed') reasons.push(`p95 latency ${report.latencyMs.p95.toFixed(2)} ms exceeds ${policy.maxP95LatencyMs} ms`);

  let leaked = false, regressed = false;
  if (leakage && leakage.length) { leaked = true; reasons.push(`${leakage.length} sealed row(s) overlap the dev set (first: ${leakage[0].sealedId} ~ ${leakage[0].devId}, ${leakage[0].kind})`); }
  if (comparison && comparison.better < 0 && comparison.p < policy.regressionAlpha) {
    regressed = true;
    reasons.push(`significantly worse than baseline: right on ${comparison.baselineOnlyCorrect} rows where baseline was wrong vs ${comparison.candidateOnlyCorrect} the other way (p=${comparison.p.toFixed(4)})`);
  }
  const vals = Object.values(criteria);
  let status = 'PASS';
  if (vals.includes('unproven')) status = 'INCONCLUSIVE';
  if (vals.includes('failed') || leaked || regressed) status = 'FAIL';
  return { status, reasons, criteria, adjusted: adj };
}

// Fails loudly on a missing or nonsensical policy instead of gating against undefined.
function validatePolicy(p) {
  const prob = k => { if (!(typeof p[k] === 'number' && p[k] > 0 && p[k] < 1)) throw new RangeError(`policy.${k} must be a number strictly between 0 and 1`); };
  const pos = k => { if (!(typeof p[k] === 'number' && p[k] > 0)) throw new RangeError(`policy.${k} must be a positive number`); };
  ['minPrecision', 'prevalence', 'regressionAlpha', 'nearDuplicateJaccard'].forEach(prob); ['maxP95LatencyMs', 'maxModelBytes'].forEach(pos);
  return p;
}

const HEX64 = /^[0-9a-f]{64}$/;
// The registry is append-only history. This checks shape and ordering, not truth.
function verifyRegistry(entries) {
  const problems = [];
  if (!Array.isArray(entries)) return ['registry must be an array'];
  let prev = '';
  entries.forEach((e, i) => {
    const at = `entry ${i}`;
    if (!e.detector) problems.push(`${at}: missing detector`);
    if (!HEX64.test(e.detector_sha256 || '')) problems.push(`${at}: detector_sha256 is not a sha-256`);
    if (!HEX64.test(e.data_sha256 || '')) problems.push(`${at}: data_sha256 is not a sha-256`);
    if (!['s0', 's1'].includes(e.stage)) problems.push(`${at}: stage must be s0 or s1`);
    if (e.status !== 'PASS' && e.status !== 'INCONCLUSIVE') problems.push(`${at}: only PASS or INCONCLUSIVE runs are recorded`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) problems.push(`${at}: date must be YYYY-MM-DD`);
    else { if (e.date < prev) problems.push(`${at}: dates must not go backwards`); prev = e.date; }
  });
  return problems;
}

module.exports = { gate, adjustedVerdict, validatePolicy, findLeakage, verifyRegistry, jaccard };
