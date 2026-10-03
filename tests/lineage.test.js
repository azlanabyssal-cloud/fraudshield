'use strict';
// The shipped model's provenance is checked like code: break each link on purpose and the check must say which one broke.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const L = require('../mlops/lineage.js');
const M = require('../lib/urlmodel.js');

const ROOT = path.join(__dirname, '..');
const record = () => JSON.parse(fs.readFileSync(L.P.lineage, 'utf8'));
const clone = o => JSON.parse(JSON.stringify(o));

test('the shipped model, its evaluation, its trainer and its feature code all match the lineage record', () => {
  assert.deepEqual(L.check(record()), []);
});

test('the record names the dataset digests, says the model was reproduced bit for bit, and never claims more than a proxy', () => {
  const r = record();
  assert.match(r.model.sha256, /^[0-9a-f]{64}$/); assert.equal(r.reproduction.sha256, r.model.sha256); assert.ok(r.reproduction.seconds > 0 && /^\d{4}-\d\d-\d\d$/.test(r.reproduction.verifiedAt));
  assert.match(r.data.sources.phiusiil.csvSha256, /^[0-9a-f]{64}$/); assert.ok(Object.keys(r.data.sources).length >= 2, 'every source is pinned');
  assert.equal(r.evaluation.proxy, true); assert.equal(r.evaluation.claimable, false);
  assert.ok(r.features.inScope >= 30 && r.features.probes === L.PROBES.length);
});

test('a different model file is caught, and so is a model that no longer matches what the evaluation scored', () => {
  const r = clone(record()); r.model.sha256 = '0'.repeat(64); assert.ok(L.check(r).some(p => /is not the recorded one/.test(p)));
  const r2 = clone(record()); r2.model.bytes += 1; assert.ok(L.check(r2).some(p => /size differs/.test(p)));
  const r3 = clone(record()); r3.evaluation.resultSha256 = 'f'.repeat(64); assert.ok(L.check(r3).some(p => /evaluation result file changed/.test(p)));
});

test('changing what a feature computes is caught as train/serve skew; an unrelated edit to the same file is not', () => {
  const r = record(), before = M.KEYS.slice();
  try {
    M.KEYS.push('refund2');   // a new keyword feature, served but never trained on
    assert.ok(L.check(r).some(p => /train\/serve skew/.test(p)), 'a changed keyword list is detected');
  } finally { M.KEYS.length = 0; M.KEYS.push(...before); }
  assert.deepEqual(L.check(r), [], 'restored, the record matches again');
  const brands = M.BRANDS.slice();
  try { M.BRANDS.push('somebank'); assert.ok(L.check(r).some(p => /skew/.test(p)), 'a changed brand list is detected'); } finally { M.BRANDS.length = 0; M.BRANDS.push(...brands); }
  assert.equal(L.featureFingerprint(M, JSON.parse(fs.readFileSync(L.P.model, 'utf8'))).fingerprint, r.features.fingerprint, 'the fingerprint is deterministic');
});

test('a changed trainer, a missing reproduction proof, and a proof for some other model are each refused', () => {
  const r = clone(record()); r.trainer['mlops/urlmodel/train.js'] = 'a'.repeat(64); assert.ok(L.check(r).some(p => /train\.js changed since the model was recorded/.test(p)));
  const r2 = clone(record()); r2.reproduction = null; assert.ok(L.check(r2).some(p => /no reproduction proof/.test(p)));
  const r3 = clone(record()); r3.reproduction.sha256 = '1'.repeat(64); assert.ok(L.check(r3).some(p => /different model/.test(p)));
  assert.ok(L.check(null)[0].includes('missing')); assert.ok(L.check({ schema: 9 })[0].includes('unknown schema'));
});

test('the probe set exercises the cases that differ: a hyphen, digits, a brand, a long name, an odd ending, punycode; every probe is a host', () => {
  assert.ok(L.PROBES.some(h => /-/.test(h.split('.')[0])) && L.PROBES.some(h => /\d{4}/.test(h)) && L.PROBES.some(h => /^xn--/.test(h)) && L.PROBES.some(h => h.split('.')[0].length > 30) && L.PROBES.some(h => /\.co\.(uk|in)$/.test(h)));
  assert.equal(new Set(L.PROBES).size, L.PROBES.length, 'no duplicates'); assert.ok(L.PROBES.every(h => /^[a-z0-9.-]+$/.test(h)));
});

test('the model is not stale: it was trained within the last 400 days, and the check says when it is time to retrain', () => {
  const age = (Date.now() - new Date(record().model.trained + 'T00:00:00Z').getTime()) / 86400000;
  assert.ok(age >= 0 && age < 400, `the model is ${Math.round(age)} days old: scammers change tactics, so retrain it on fresh data (npm run model:reproduce after training)`);
});

test('the CLI: --check passes now, fails on a tampered record, and writes nothing while checking', () => {
  const { spawnSync } = require('node:child_process'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-lin-')), tampered = path.join(dir, 'lineage.json');
  const r = clone(record()); r.model.sha256 = 'e'.repeat(64); fs.writeFileSync(tampered, JSON.stringify(r));
  const ok = spawnSync(process.execPath, [path.join(ROOT, 'mlops', 'lineage.js'), '--check'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const bad = spawnSync(process.execPath, [path.join(ROOT, 'mlops', 'lineage.js'), '--check'], { encoding: 'utf8', env: { ...process.env, FS_LINEAGE: tampered } });
  assert.equal(bad.status, 1); assert.match(bad.stderr, /is not the recorded one/); assert.equal(fs.readFileSync(tampered, 'utf8'), JSON.stringify(r), 'a check never rewrites the record');
});

test('the model really is int8: every one of its weights is an integer in [-128, 127], and a float or an out-of-range weight is refused', () => {
  const r = record(), m = JSON.parse(fs.readFileSync(L.P.model, 'utf8')); assert.equal(r.model.quantisation.type, 'int8'); assert.equal(r.model.quantisation.weights, m.ngram.q.length + m.eng.length + m.tld.length);
  assert.ok(r.model.quantisation.min >= -128 && r.model.quantisation.max <= 127);
  const orig = fs.readFileSync(L.P.model, 'utf8'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-q-'));
  const probe = mut => { const x = JSON.parse(orig); mut(x); const f = path.join(dir, 'm.json'); fs.writeFileSync(f, JSON.stringify(x)); return f; };
  const wrap = f => { const save = L.P.model; L.P.model = f; try { return L.check(clone(record())); } finally { L.P.model = save; } };
  assert.ok(wrap(probe(x => { x.eng[0] = 1.5; })).some(p => /no longer all int8/.test(p)), 'a float weight');
  assert.ok(wrap(probe(x => { x.tld[0] = 300; })).some(p => /no longer all int8/.test(p)), 'an out-of-range weight');
});
