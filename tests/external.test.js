'use strict';
// Fixtures are fabricated strings. The real datasets are never needed here.
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../mlops/metrics.js');
const { parseMendeley } = require('../mlops/benchmarks/fetch_mendeley.js');
const { prepareExternal, evaluateExternal, linkDetector, shortcutCheck } = require('../mlops/benchmarks/external.js');
const policy = require('../mlops/policy.json');

test('AUC: known answers, ties count half, one class gives null, bad input throws', () => {
  assert.equal(m.auc([1, 2, 3, 4], [0, 0, 1, 1]), 1); assert.equal(m.auc([1, 2, 3, 4], [1, 1, 0, 0]), 0);
  assert.equal(m.auc([5, 5, 5, 5], [0, 1, 0, 1]), 0.5);
  assert.equal(m.auc([1, 2, 3, 4], [0, 1, 0, 1]), 0.75);      // positives 2,4 vs negatives 1,3: 3 of 4 pairs ordered
  assert.equal(m.auc([1, 1, 2, 2], [0, 1, 0, 1]), 0.5);       // pairs: tie .5, loss 0, win 1, tie .5
  assert.equal(m.auc([1, 2], [1, 1]), null);
  assert.throws(() => m.auc([1], [1, 0]), RangeError); assert.throws(() => m.auc([NaN, 1], [0, 1]), RangeError);
});

test('parseMendeley normalises the label case the source mixes, and rejects unknown labels and missing columns', () => {
  const csv = 'LABEL,TEXT,URL,EMAIL,PHONE\nSmishing,"a, b",yes,no,no\nsmishing,c,no,no,no\nSpam,d,no,no,no\nham,e,no,no,no\n';
  assert.deepEqual(parseMendeley(csv).map(r => r.label), ['smishing', 'smishing', 'spam', 'ham']);
  assert.throws(() => parseMendeley('LABEL,TEXT\nphish,x\n'), /unknown label/);
  assert.throws(() => parseMendeley('A,B\n1,2\n'), /LABEL and TEXT/);
});

const longText = 'please confirm the one time code we sent so that we can unblock your account today before midnight tonight okay thanks';
const ref = [{ text: 'an exact reference message about dinner plans for tomorrow' }, { text: longText + ' alpha' }];

test('prepareExternal: conflicts and duplicates dropped, spam excluded, exact and near copies of the reference removed', () => {
  const mend = [
    { label: 'ham', text: 'an exact reference message about dinner plans for tomorrow' },            // exact copy of the reference
    { label: 'smishing', text: longText + ' beta' },                                                   // near copy (one word differs)
    { label: 'smishing', text: 'click http://bad-bank-login.xyz to claim your refund right now' },
    { label: 'smishing', text: 'click http://bad-bank-login.xyz to claim your refund right now' },     // duplicate, collapses
    { label: 'ham', text: 'see you at the station at 6 pm' },
    { label: 'ham', text: 'conflicting text with two labels here' }, { label: 'smishing', text: 'conflicting text with two labels here' },
    { label: 'spam', text: 'big sale on shoes this weekend only' }
  ];
  const { counts, independent, full } = prepareExternal(mend, ref);
  assert.equal(counts.input, 8); assert.equal(counts.conflictingLabelGroups, 1); assert.equal(counts.afterConflictsAndDuplicates, 5);
  assert.equal(counts.spamExcluded, 1); assert.deepEqual(counts.full, { smishing: 2, ham: 2 });
  assert.deepEqual(counts.removedAsExactOrNearDuplicateOfReference, { exact: 1, near: 1 });
  assert.deepEqual(counts.independent, { smishing: 1, ham: 1 });
  assert.equal(full.length, 4); assert.equal(independent.length, 2);
  assert.ok(independent.every(e => !/dinner|midnight/.test(e.text)), 'no reference copy may survive in the independent slice');
});

test('link detector: strict flags only danger, lenient also flags caution, official and link-free texts are never flagged', () => {
  const strict = linkDetector(true), lenient = linkDetector(false);
  const danger = 'verify now at http://sbi.co.in@evil.com/x', caution = 'offer at http://some-unknown-shop.com/offer', official = 'see https://www.sbi.co.in/web/personal-banking';
  assert.deepEqual([strict(danger), strict(caution), strict(official), strict('no link here')], [true, false, false, false]);
  assert.deepEqual([lenient(danger), lenient(caution), lenient(official), lenient('no link here')], [true, true, false, false]);
});

test('shortcutCheck: a corpus where length separates the classes is exposed, an unrelated score sits near 0.5', () => {
  const ex = [...Array(40)].map((_, i) => ({ y: i < 20, text: 'x'.repeat(i < 20 ? 140 + (i % 5) : 40 + (i % 5)) }));
  const lengthy = shortcutCheck(ex, t => t.length);
  assert.equal(lengthy.aucLengthOnly, 1); assert.deepEqual(lengthy.medianLength, { scam: 142, genuine: 42 });
  const unrelated = shortcutCheck(ex, t => (t.charCodeAt(0) * 7919) % 13);
  assert.equal(unrelated.aucModel, 0.5);   // every text starts with "x": identical scores
});

test('evaluateExternal reports every detector on both slices and applies the same gate rules', () => {
  const ex = [...Array(60)].map((_, i) => ({ id: 'I' + i, text: i < 30 ? 'urgent http://sbi.co.in@evil.com claim ' + i : 'see you soon ' + i, y: i < 30, language: 'en', category: i < 30 ? 'other_scam' : 'safe', source: 'sms', date: '', obfuscated: false }));
  const r = evaluateExternal({ independent: ex, full: ex }, policy, { uci_model: t => t.includes('claim') });
  for (const set of ['independent', 'full']) {
    for (const name of ['router_v0', 'link_danger', 'link_danger_or_caution', 'shipped_router_or_link_danger', 'uci_model', 'always_scam', 'never_scam']) assert.ok(r[set][name].gate.verdict, `${set}/${name}`);
    assert.equal(r[set].link_danger.recall.value, 1); assert.equal(r[set].never_scam.gate.verdict, 'failed');
    assert.equal(r[set].uci_model.recall.value, 1); assert.equal(r[set].uci_model.fpr.value, 0);
    assert.ok(r[set]._modelVsRouter.p <= 1);
  }
});
