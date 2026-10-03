'use strict';
/* Statistics for evaluating a detector. Pure functions, no file access. */

const isCount = x => Number.isInteger(x) && x >= 0;
function needCounts(...xs) { for (const x of xs) if (!isCount(x)) throw new RangeError(`expected a non-negative integer count, got ${x}`); }
function needProb(name, x, { open = false } = {}) {
  if (typeof x !== 'number' || Number.isNaN(x) || x < 0 || x > 1 || (open && (x === 0 || x === 1))) throw new RangeError(`${name} must be a probability${open ? ' strictly between 0 and 1' : ''}, got ${x}`);
}

// Wilson score interval for a proportion k/n (z = 1.96 gives 95%). Never the Wald interval.
function wilson(k, n, z = 1.96) {
  needCounts(k, n);
  if (k > n) throw new RangeError(`k (${k}) cannot exceed n (${n})`);
  if (!(z > 0)) throw new RangeError('z must be positive');
  if (n === 0) return { k, n, value: null, lo: null, hi: null };
  const p = k / n, d = 1 + z * z / n;
  const centre = (p + z * z / (2 * n)) / d;
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return { k, n, value: p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

const LOG_FACT = [0];
function logFact(n) { for (let i = LOG_FACT.length; i <= n; i++) LOG_FACT[i] = LOG_FACT[i - 1] + Math.log(i); return LOG_FACT[n]; }

// Exact two-sided McNemar test. b = rows only the candidate got right, c = rows only the baseline got right.
// Under "no difference" each discordant row is a fair coin flip.
function mcnemarExact(b, c) {
  needCounts(b, c);
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += Math.exp(logFact(n) - logFact(i) - logFact(n - i) - n * Math.LN2);
  return Math.min(1, 2 * tail);
}

// Population Stability Index between two count tables over the same buckets.
// Empty buckets use 1e-4 so the log is defined. Rule of thumb: <0.1 stable, 0.1-0.25 shifted, >0.25 large shift.
function psi(expected, actual) {
  for (const t of [expected, actual]) for (const v of Object.values(t)) if (!(v >= 0) || !Number.isFinite(v)) throw new RangeError(`PSI counts must be finite and non-negative, got ${v}`);
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])];
  const sum = o => keys.reduce((s, k) => s + (o[k] || 0), 0);
  const e = sum(expected), a = sum(actual);
  if (!e || !a) return null;
  return keys.reduce((s, k) => {
    const pe = Math.max((expected[k] || 0) / e, 1e-4), pa = Math.max((actual[k] || 0) / a, 1e-4);
    return s + (pa - pe) * Math.log(pa / pe);
  }, 0);
}

/* Precision depends on how common scams are among the messages checked, not on the mix in a test set.
   Bayes: P(scam | flagged) = recall*pi / (recall*pi + fpr*(1-pi)), where pi is the real-world prevalence.
   0/0 (the model flags nothing, so recall = fpr = 0) is defined as 0, never 1; callers must treat it as fatal. */
function precisionAtPrevalence(recall, fpr, prevalence) {
  needProb('recall', recall); needProb('fpr', fpr); needProb('prevalence', prevalence, { open: true });
  const tp = recall * prevalence, fp = fpr * (1 - prevalence);
  return tp + fp === 0 ? 0 : tp / (tp + fp);
}

/* How many genuine messages, all correctly passed, are needed before the Wilson upper bound of the false-alarm
   rate is low enough to PROVE adjusted precision >= minPrecision. Derivation:
     precision >= m  <=>  fpr <= r*pi*(1-m) / (m*(1-pi))  =: f
     Wilson upper bound with 0 false alarms in n messages = z^2 / (n + z^2)  <=  f   <=>   n >= z^2 * (1/f - 1) */
function negativesNeededToProve(recallLow, minPrecision, prevalence, z = 1.96) {
  needProb('recallLow', recallLow); needProb('minPrecision', minPrecision, { open: true }); needProb('prevalence', prevalence, { open: true });
  if (recallLow === 0) return Infinity;
  const f = recallLow * prevalence * (1 - minPrecision) / (minPrecision * (1 - prevalence));
  return Math.ceil(z * z * (1 / f - 1));
}

function percentile(sorted, q) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
}

module.exports = { wilson, mcnemarExact, psi, precisionAtPrevalence, negativesNeededToProve, percentile };
