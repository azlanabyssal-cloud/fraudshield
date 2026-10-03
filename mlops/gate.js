'use strict';
/* Release gate. Three-valued on purpose: with a few hundred rows many claims can be neither
   confirmed nor rejected, and the gate says so instead of rounding up.
   PASS          every criterion met with its 95% interval on the right side
   INCONCLUSIVE  nothing failed, but at least one criterion is not proven at this sample size
   FAIL          a criterion failed, a regression is significant, or the test data leaks
   NO_EVIDENCE   the dataset is missing or below its stage minimum, so nothing was measured */
const { finalChecks, normalizeForDedup } = require('../data_ops/holdout.js');

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

function against(ci, threshold) {
  if (ci.n === 0) return 'unproven';
  if (ci.lo >= threshold) return 'met';
  if (ci.hi < threshold) return 'failed';
  return 'unproven';
}

function gate({ stats, stage, report, comparison, leakage, policy }) {
  const reasons = [];
  const evidenceProblems = stats ? finalChecks(stats, stage) : ['no dataset'];
  if (evidenceProblems.length) return { status: 'NO_EVIDENCE', reasons: evidenceProblems, criteria: {} };

  const criteria = {
    // a detector that never catches a scam is worthless whatever its precision says
    catchesScams: report.tp > 0 ? 'met' : 'failed',
    precision: against(report.precision, policy.minPrecision),
    latency: report.latencyMs.p95 <= policy.maxP95LatencyMs ? 'met' : 'failed'
  };
  let leaked = false, regressed = false;
  if (leakage && leakage.length) { leaked = true; reasons.push(`${leakage.length} sealed row(s) overlap the dev set (first: ${leakage[0].sealedId} ~ ${leakage[0].devId}, ${leakage[0].kind})`); }
  if (comparison && comparison.better < 0 && comparison.p < policy.regressionAlpha) {
    regressed = true;
    reasons.push(`significantly worse than baseline: right on ${comparison.baselineOnlyCorrect} rows where baseline was wrong vs ${comparison.candidateOnlyCorrect} the other way (p=${comparison.p.toFixed(4)})`);
  }
  for (const [name, v] of Object.entries(criteria)) {
    if (v === 'failed') reasons.push(name === 'latency' ? `p95 latency ${report.latencyMs.p95.toFixed(2)} ms exceeds ${policy.maxP95LatencyMs} ms` : name === 'catchesScams' ? 'detector caught no scams' : `${name} failed (95% interval upper bound is below the target)`);
    if (v === 'unproven') {
      const p = report.precision;
      reasons.push(p.n === 0 ? 'precision undefined: the detector flagged no messages'
        : `precision not proven: point ${(p.value * 100).toFixed(1)}%, 95% interval ${(p.lo * 100).toFixed(1)}-${(p.hi * 100).toFixed(1)}% vs target ${policy.minPrecision * 100}%`);
    }
  }
  const vals = Object.values(criteria);
  let status = 'PASS';
  if (vals.includes('unproven')) status = 'INCONCLUSIVE';
  if (vals.includes('failed') || leaked || regressed) status = 'FAIL';
  return { status, reasons, criteria };
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

module.exports = { gate, findLeakage, verifyRegistry, jaccard };
