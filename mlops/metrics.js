'use strict';
/* Statistics for evaluating a detector. Pure functions, no file access. */

// Wilson score interval for a proportion k/n (z = 1.96 gives 95%).
function wilson(k, n, z = 1.96) {
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
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])];
  const sum = o => keys.reduce((s, k) => s + (o[k] || 0), 0);
  const e = sum(expected), a = sum(actual);
  if (!e || !a) return null;
  return keys.reduce((s, k) => {
    const pe = Math.max((expected[k] || 0) / e, 1e-4), pa = Math.max((actual[k] || 0) / a, 1e-4);
    return s + (pa - pe) * Math.log(pa / pe);
  }, 0);
}

// Precision depends on how common scams are among checked messages: r*pi / (r*pi + fpr*(1-pi)).
function precisionAtPrevalence(recall, fpr, prevalence) {
  const tp = recall * prevalence, fp = fpr * (1 - prevalence);
  return tp + fp === 0 ? null : tp / (tp + fp);
}

function percentile(sorted, q) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
}

module.exports = { wilson, mcnemarExact, psi, precisionAtPrevalence, percentile };
