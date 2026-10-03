'use strict';
// The domain-name model is a weak, honest signal, so the tests guard honesty: the shipped file is the one that was measured, the
// numbers the interface quotes are the measured ones, the model stays out of scope where it knows nothing, and it can only warn.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const M = require('../lib/urlmodel.js');
const L = require('../lib/linkcheck.js');

const ROOT = path.join(__dirname, '..');
const shippedPath = path.join(ROOT, 'data', 'urlmodel.json'), resultPath = path.join(ROOT, 'mlops', 'benchmarks', 'results', 'url_domain_model.json');
const shipped = JSON.parse(fs.readFileSync(shippedPath, 'utf8')), result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));

test('the shipped weights are exactly the file the evaluation scored, and the card quotes the measured numbers', () => {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(shippedPath)).digest('hex'), result.modelSha256);
  assert.equal(shipped.card.high.recall, result.test.atHighThreshold.recall.value); assert.equal(shipped.card.high.falseAlarm, result.test.atHighThreshold.falseAlarm.value);
  assert.equal(shipped.card.auc, Math.round(result.test.auc * 1000) / 1000);
  assert.ok(fs.statSync(shippedPath).size < 160 * 1024, 'the PWA ships this file: it stays under 160 KB');
});

test('the result file is honest about what it is', () => {
  assert.equal(result.proxy, true); assert.equal(result.claimable, false); assert.match(result.warning, /Never present these figures as product accuracy/);
  assert.ok(result.test.auc < 0.9, 'a name-only model that scores near 100% would mean a leak or a dataset artifact');
  assert.ok(result.test.aucCi95[0] <= result.test.auc && result.test.auc <= result.test.aucCi95[1]);
  assert.equal(result.datasetArtifacts.https.legitimate, 1, 'the artifact that forced the design is recorded in the result');
  assert.ok(result.test.baselineAuc.nameLengthOnly < 0.6, 'a trivial feature does not already explain the score');
  assert.ok(result.validation.auc > 0.7 && Math.abs(result.validation.auc - result.test.auc) < 0.02, 'validation and test agree: nothing was fitted to the test split');
});

test('the model stays silent where it has nothing to say: IP addresses, one-word hosts, hosting-platform tenants, tiny names', () => {
  for (const host of ['192.168.4.20', 'localhost', 'abc.web.app', 'shop.firebaseapp.com', 'x.org', 'xn--mnchen-3ya.de', '']) assert.equal(M.score(host, shipped), null, host);
  const s = M.score('www.example-shop.com', shipped); assert.ok(s && Number.isFinite(s.score) && s.probability > 0 && s.probability < 1);
  assert.equal(M.score('www.example-shop.com', shipped).score, M.score('example-shop.com', shipped).score, '"www" is not part of the name');
  assert.equal(M.score('mail.example-shop.com', shipped).score, s.score, 'sub-domains are not part of the name');
});

test('scoring is deterministic, finite for hostile input, and bands are ordered', () => {
  assert.ok(shipped.thresholds.high.score > shipped.thresholds.elevated.score);
  for (const h of ['a'.repeat(63) + '.com', 'x'.repeat(3) + '.co.uk', '1234567.top', 'a-b-c-d-e-f-g.xyz', 'ünicode.com', '..', 'a..b.com', '-.com']) { const r = M.score(h, shipped); assert.ok(r === null || Number.isFinite(r.score), h); }
  assert.deepEqual(M.score('paytm-kyc-update.top', shipped), M.score('paytm-kyc-update.top', shipped));
});

test('the soft warning can lift an unexplained address to "suspicious" but never to "scam", and never touches an official one', () => {
  const spec = { hashBits: 4, ngram: [1, 2], bins: M.ENGINEERED.map(() => []), tlds: [] };
  const fake = band => ({ version: 1, scale: 20, spec, bias: band === 'high' ? 1000 : -1000, ngram: { idx: [], q: [] }, eng: new Array(M.ENGINEERED.length).fill(0), tld: [0], calibration: { a: 1, b: 0 },
    thresholds: { high: { score: 1 }, elevated: { score: 0 } }, card: { high: { recall: 0.14, falseAlarm: 0.0012 }, elevated: { recall: 0.24, falseAlarm: 0.011 } } });
  try {
    M.install(null); assert.equal(L.analyzeUrl('https://random-shop.com/').level, 'unverified');
    M.install(fake('high'));
    const lifted = L.analyzeUrl('https://random-shop.com/'); assert.equal(lifted.level, 'suspicious'); assert.ok(lifted.codes.includes('name-model'));
    assert.match(lifted.reasons.join(' '), /about 14 in every 100 phishing domains and about 1 in every 1,000 ordinary ones/);
    assert.match(lifted.reasons.join(' '), /a hint, not proof/);
    assert.equal(L.analyzeUrl('https://sbi.co.in/').level, 'official'); assert.ok(!L.analyzeUrl('https://sbi.co.in/').codes.includes('name-model'));
    assert.equal(L.analyzeUrl('https://sbi-kyc-update.tk/').level, 'scam');
    assert.equal(L.analyzeUrl('https://bit.ly/3abc').level, 'unverified', 'a shortener is judged by what hides behind it, not by its name');
    M.install(fake('none')); assert.equal(L.analyzeUrl('https://random-shop.com/').level, 'unverified', 'a model that says nothing changes nothing');
  } finally { M.install(shipped); }
});

test('when the model is not loaded the analyzer behaves exactly as its rules say', () => {
  M.install(null); const before = L.analyzeUrl('https://random-shop.com/'); M.install(shipped); M.install(null);
  assert.equal(before.level, 'unverified'); assert.ok(!before.codes.includes('name-model')); M.install(shipped);
});
