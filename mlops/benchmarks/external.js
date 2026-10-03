'use strict';
/* External validation: does a detector hold up on a corpus it was not built on?
   Pure functions (no file or network access). Protocol, fixed before any result was seen:
   1. labels are normalised; texts that appear with conflicting labels are dropped; duplicate texts are collapsed
   2. positives are "smishing"; negatives are "ham"; marketing "spam" is excluded (the SOP: honest marketing is not a scam)
   3. the INDEPENDENT slice drops every row that equals, or is a near-duplicate of, any text in the reference corpus
   4. detectors are fixed in advance and never tuned on this data; individual failures are not inspected */
const { normalizeForDedup } = require('../../data_ops/holdout.js');
const core = require('../../lib/core.js');
const { analyzeMessage } = require('../../lib/msgcheck.js');
const { evaluate, compare } = require('../evaluate.js');
const { auc } = require('../metrics.js');
const { adjustedVerdict, findLeakage } = require('../gate.js');
const detectors = require('../detectors.js');

const toEx = (rows, prefix) => rows.map((r, i) => ({ id: prefix + i, text: r.text, y: r.y, language: 'en', category: r.y ? 'other_scam' : 'safe', source: 'sms', date: '', obfuscated: false }));

function prepareExternal(mend, reference, { nearDuplicateJaccard = 0.85 } = {}) {
  const counts = { input: mend.length, byLabel: {} };
  mend.forEach(r => { counts.byLabel[r.label] = (counts.byLabel[r.label] || 0) + 1; });

  // 1. conflicting labels and duplicates
  const groups = new Map();
  mend.forEach(r => { const k = normalizeForDedup(r.text); (groups.get(k) || groups.set(k, []).get(k)).push(r); });
  const conflicting = [...groups.values()].filter(g => new Set(g.map(r => r.label)).size > 1);
  counts.conflictingLabelGroups = conflicting.length;
  const clean = [...groups.values()].filter(g => new Set(g.map(r => r.label)).size === 1).map(g => g[0]);
  counts.afterConflictsAndDuplicates = clean.length;

  // 2. classes
  counts.spamExcluded = clean.filter(r => r.label === 'spam').length;
  const labelled = clean.filter(r => r.label !== 'spam').map(r => ({ text: r.text, y: r.label === 'smishing' }));
  counts.full = { smishing: labelled.filter(r => r.y).length, ham: labelled.filter(r => !r.y).length };

  // 3. independence from the reference corpus (exact first, then near-duplicates)
  const leaks = findLeakage(toEx(reference, 'R'), toEx(labelled, 'M'), nearDuplicateJaccard);
  const leakIds = new Set(leaks.map(l => l.sealedId));
  const independent = labelled.filter((_, i) => !leakIds.has('M' + i));
  counts.removedAsExactOrNearDuplicateOfReference = { exact: leaks.filter(l => l.kind === 'exact').length, near: leaks.filter(l => l.kind === 'near').length };
  counts.independent = { smishing: independent.filter(r => r.y).length, ham: independent.filter(r => !r.y).length };
  return { full: toEx(labelled, 'F'), independent: toEx(independent, 'I'), counts };
}

// The shipped link checker used as a classifier: flag a message when its first link is judged "danger"
// (strict) or "danger or caution" (the checker says "caution" for every domain it cannot vouch for).
function linkDetector(strict) {
  return text => {
    const link = core.findLinkIn(text);
    if (!link) return false;
    const v = core.checkLink(link).verdict;
    return strict ? v === 'danger' : v === 'danger' || v === 'caution';
  };
}

function evaluateExternal(sets, policy, extra = {}) {
  const dets = {
    router_v0: detectors.router_v0, link_danger: linkDetector(true), link_danger_or_caution: linkDetector(false),
    shipped_router_or_link_danger: t => detectors.router_v0(t) || linkDetector(true)(t),
    // the message check, written before this benchmark was run and never tuned on it (ADR-0013)
    message_scam: t => analyzeMessage(t).level === 'scam', message_flag: t => analyzeMessage(t).level !== 'nothing', ...extra,
    always_scam: detectors.always_scam, never_scam: detectors.never_scam
  };
  const out = {};
  for (const [setName, examples] of Object.entries(sets)) {
    out[setName] = {};
    const preds = {};
    for (const [name, fn] of Object.entries(dets)) {
      const r = evaluate(examples, fn); preds[name] = r.predictions;
      const { predictions, slices, ...rest } = r;
      const g = adjustedVerdict(rest, policy);
      out[setName][name] = { ...rest, gate: { verdict: g.verdict, adjusted: g.point, worstCase: g.conservative, reason: g.reason || null } };
    }
    if (extra.uci_model) out[setName]._modelVsRouter = compare(examples, preds.router_v0, preds.uci_model);
  }
  return out;
}

// Is a high score just a style shortcut? Compares a model against message length alone (AUC 0.5 = no information).
// A trivial rule that scores well means the corpus is easy, and a good model score proves less than it seems.
function shortcutCheck(examples, scoreFn) {
  const y = examples.map(e => e.y), len = examples.map(e => e.text.length);
  const med = a => { const s = a.slice().sort((p, q) => p - q); return s.length ? s[s.length >> 1] : null; };
  return {
    medianLength: { scam: med(len.filter((_, i) => y[i])), genuine: med(len.filter((_, i) => !y[i])) },
    aucLengthOnly: auc(len, y), aucModel: auc(examples.map(e => scoreFn(e.text)), y)
  };
}

module.exports = { prepareExternal, evaluateExternal, linkDetector, shortcutCheck };
