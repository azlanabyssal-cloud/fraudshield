'use strict';
const { COLUMNS, SCAM_CATEGORIES } = require('../data_ops/holdout.js');
const { wilson, mcnemarExact, psi, precisionAtPrevalence, percentile } = require('./metrics.js');

const WARMUP_CALLS = 5; // untimed calls so JIT/first-call cost is not counted in latency
const PREVALENCES = [0.01, 0.05, 0.2, 0.5];

const MIN_SLICE = 30; // below this a slice is reported but marked underpowered

// parseCsv output (already validated, header first) -> examples
function toExamples(csvRows) {
  const ix = Object.fromEntries(COLUMNS.map((c, i) => [c, i]));
  return csvRows.slice(1).map(r => ({
    id: r[ix.id], text: r[ix.raw_text_scrubbed], y: r[ix.is_scam] === '1', language: r[ix.language_tag],
    category: r[ix.attack_category], source: r[ix.source_platform], date: r[ix.date_received],
    obfuscated: r[ix.contains_obfuscation] === 'true'
  }));
}

function rates(items) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const it of items) { if (it.y) { it.p ? tp++ : fn++; } else { it.p ? fp++ : tn++; } }
  // 0/0: nothing flagged. Precision is defined as 0 (never 1) and the result is marked so the gate can fail it loudly.
  const precision = tp + fp === 0 ? { k: 0, n: 0, value: 0, lo: 0, hi: 0, flagsNothing: true } : wilson(tp, tp + fp);
  return {
    n: items.length, tp, fp, fn, tn,
    precision, recall: wilson(tp, tp + fn), fpr: wilson(fp, fp + tn),
    underpowered: items.length < MIN_SLICE
  };
}

// Precision at a real-world scam prevalence. `point` uses the measured rates; `conservative` uses the worst ends of
// their 95% intervals (lowest recall, highest false-alarm rate). Null when either rate cannot be measured.
function adjusted(r, prevalence) {
  if (!r.recall.n || !r.fpr.n) return { prevalence, point: null, conservative: null };
  return {
    prevalence,
    point: precisionAtPrevalence(r.recall.value, r.fpr.value, prevalence),
    conservative: precisionAtPrevalence(r.recall.lo, r.fpr.hi, prevalence)
  };
}

// Runs the detector once per example and times each call.
function evaluate(examples, detect) {
  const times = [];
  if (examples.length) for (let i = 0; i < WARMUP_CALLS; i++) detect(examples[0].text);
  const items = examples.map(e => {
    const t0 = process.hrtime.bigint();
    const p = Boolean(detect(e.text));
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    return { ...e, p };
  });
  const overall = rates(items);
  const group = keyFn => {
    const g = {};
    for (const it of items) (g[keyFn(it)] = g[keyFn(it)] || []).push(it);
    return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, rates(v)]));
  };
  const byCategory = {};
  for (const c of SCAM_CATEGORIES) {
    const v = items.filter(it => it.category === c);
    if (v.length) byCategory[c] = rates(v);
  }
  times.sort((a, b) => a - b);
  return {
    ...overall,
    prevalence: overall.n ? (overall.tp + overall.fn) / overall.n : null,
    atPrevalence: PREVALENCES.map(pi => adjusted(overall, pi)),
    slices: { language: group(it => it.language), obfuscated: group(it => (it.obfuscated ? 'obfuscated' : 'plain')), category: byCategory },
    latencyMs: { p50: percentile(times, 0.5), p95: percentile(times, 0.95), warmupCalls: WARMUP_CALLS, note: 'Node on this machine after warm-up, not a phone' },
    predictions: items.map(it => it.p)
  };
}

// Paired comparison on identical rows. Positive `better` means the candidate is right more often.
function compare(examples, baselinePreds, candidatePreds) {
  let candOnly = 0, baseOnly = 0;
  examples.forEach((e, i) => {
    const bc = baselinePreds[i] === e.y, cc = candidatePreds[i] === e.y;
    if (cc && !bc) candOnly++; else if (bc && !cc) baseOnly++;
  });
  return { candidateOnlyCorrect: candOnly, baselineOnlyCorrect: baseOnly, p: mcnemarExact(candOnly, baseOnly), better: candOnly - baseOnly };
}

// Compares the category mix of the older and newer half of the data (by date_received).
function driftReport(examples) {
  const dated = examples.filter(e => e.date).slice().sort((a, b) => a.date.localeCompare(b.date));
  if (dated.length < 40) return { psiCategory: null, note: 'under 40 dated rows; drift not measured' };
  const mid = Math.floor(dated.length / 2), count = arr => arr.reduce((o, e) => (o[e.category] = (o[e.category] || 0) + 1, o), {});
  return { psiCategory: psi(count(dated.slice(0, mid)), count(dated.slice(mid))), olderRows: mid, newerRows: dated.length - mid };
}

module.exports = { toExamples, evaluate, compare, driftReport, rates, adjusted, PREVALENCES, MIN_SLICE };
