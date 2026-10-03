'use strict';
// The pipeline that produced the shipped weights, tested on small fixtures: the split cannot leak, the platform rule cannot be fooled,
// and the trainer's pieces do what the evaluation assumes they do.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../mlops/urlmodel/data.js');
const T = require('../mlops/urlmodel/train.js');
const M = require('../lib/urlmodel.js');
const { auc } = require('../mlops/metrics.js');
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);

const phi = (url, label) => ({ url, label });

test('hostOf reduces any address to the bare host, and refuses what is not an ordinary named host', () => {
  assert.equal(D.hostOf('https://www.Example.com:8080/a/b?c=d#e'), 'example.com'); assert.equal(D.hostOf('http://sub.shop.co.uk/'), 'sub.shop.co.uk'); assert.equal(D.hostOf('example.com/path'), 'example.com');
  for (const bad of ['http://192.168.4.20/login', 'http://localhost/', 'not a url at all', 'http://under_score.com/', '']) assert.equal(D.hostOf(bad), null, bad);
});

test('the dataset artifacts that forced the design are measured, not assumed', () => {
  const a = D.artifactShares([phi('https://www.a.com', '1'), phi('https://www.b.com', '1'), phi('http://x.top/login.php?id=1', '0'), phi('https://y.xyz/', '0')]);
  assert.equal(a.https.legitimate, 1); assert.equal(a.https.phishing, 0.5); assert.equal(a.path.legitimate, 0); assert.equal(a.path.phishing, 0.5); assert.equal(a.query.phishing, 0.5); assert.equal(a.bareHost.legitimate, 1);
});

test('build: platforms are found by how many distinct phishing hosts they carry, excluded, and never trained on', () => {
  const rows = []; for (let i = 0; i < 60; i++) rows.push(phi(`https://tenant${i}.web.app/`, '0'));
  rows.push(phi('https://paytm-kyc-update.top/', '0'), phi('https://www.honest-bakery.com/', '1'));
  const d = D.build(rows, ['1,google.com'], { platformMinHosts: 50 });
  assert.deepEqual(d.platforms, ['web.app']); assert.ok(d.rows.every(r => !r.reg.endsWith('web.app')));
  const regs = d.rows.map(r => r.reg).sort();   // the popularity list is thinned by a fixed hash, so google.com may or may not be kept; the labelled rows always are
  assert.ok(regs.includes('honest-bakery.com') && regs.includes('paytm-kyc-update.top')); assert.ok(regs.every(r => ['google.com', 'honest-bakery.com', 'paytm-kyc-update.top'].includes(r)));
  assert.equal(d.rows.find(r => r.reg === 'paytm-kyc-update.top').y, 1); assert.equal(d.rows.find(r => r.reg === 'honest-bakery.com').y, 0);
});

test('build: a domain seen on both sides is dropped rather than guessed, and Tranco never overrides the labelled data', () => {
  const d = D.build([phi('https://www.both-ways.com', '1'), phi('http://both-ways.com/x', '0'), phi('https://www.only-bad.com/x', '0')], ['1,both-ways.com', '2,only-bad.com'], {});
  assert.ok(!d.rows.some(r => r.reg === 'both-ways.com')); assert.equal(d.counts.conflictingDomains, 1);
  assert.equal(d.rows.find(r => r.reg === 'only-bad.com').y, 1, 'a domain labelled phishing stays phishing even if the popularity list names it');
});

test('the split is by the owner-chosen name: the same name under any ending lands on the same side, always', () => {
  for (const name of ['amazon', 'paytm-kyc', 'a1b2c3', 'sbi', 'ravi-stores']) { const s = D.splitOf(name); assert.ok(['train', 'val', 'test'].includes(s)); assert.equal(D.splitOf(name), s); }
  const rows = []; for (let i = 0; i < 400; i++) for (const tld of ['com', 'in', 'co.uk']) rows.push(phi(`https://www.name${i}.${tld}`, i % 3 ? '1' : '0'));
  const d = D.build(rows, [], {}), side = new Map();
  for (const r of d.rows) { if (side.has(r.name) && side.get(r.name) !== r.split) assert.fail(`${r.name} straddles the split`); side.set(r.name, r.split); }
  const share = s => d.rows.filter(r => r.split === s).length / d.rows.length;
  assert.ok(Math.abs(share('train') - 0.7) < 0.08 && Math.abs(share('val') - 0.15) < 0.06 && Math.abs(share('test') - 0.15) < 0.06, 'about 70/15/15');
  assert.deepEqual(d.rows.map(r => r.reg), d.rows.map(r => r.reg).slice().sort(), 'a fixed order: nothing depends on file order');
});

test('quantileEdges are ascending, finite, and leave the last bin reachable', () => {
  const e = T.quantileEdges(Array.from({ length: 1000 }, (_, i) => i), 12); assert.equal(e.length, 11); assert.deepEqual(e, e.slice().sort((a, b) => a - b)); assert.ok(e[e.length - 1] < 999);
  assert.deepEqual(T.quantileEdges([5, 5, 5, 5, 5, 5], 12), [], 'a constant feature has no edges and so one bin'); assert.deepEqual(T.quantileEdges([0, 0, 0, 0, 0, 1], 4).every(Number.isFinite), true);
});

test('the trainer learns a separable toy problem, is deterministic, and the regulariser shrinks weights', () => {
  const rng = T.rng(5), rows = [];
  for (let i = 0; i < 600; i++) { const bad = i % 2 === 0; rows.push({ name: (bad ? 'verify-kyc-' : 'bakery-') + Math.floor(rng() * 1e4), suffix: bad ? 'top' : 'com', y: bad ? 1 : 0 }); }
  const spec = T.buildSpec(rows, 10), X = T.matrix(rows, spec), y = rows.map(r => r.y), size = M.layout(spec).size;
  const a = T.fit(X, y, size, { l2: 1e-3, epochs: 3, lr: 0.2 }), b = T.fit(X, y, size, { l2: 1e-3, epochs: 3, lr: 0.2 });
  assert.deepEqual(Array.from(a.w), Array.from(b.w)); assert.equal(a.b, b.b);
  assert.ok(auc(T.scores(a, X), y) > 0.99, 'it separates what is plainly separable');
  const strong = T.fit(X, y, size, { l2: 0.5, epochs: 3, lr: 0.2 }), norm = m => Math.sqrt(m.w.reduce((s, v) => s + v * v, 0));
  assert.ok(norm(strong) < norm(a), 'a stronger penalty gives smaller weights');
});

test('Platt scaling recovers a known calibration, and thresholds hit the false-alarm rate they are asked for', () => {
  const rng = T.rng(3), z = [], y = [];
  for (let i = 0; i < 20000; i++) { const s = (rng() - 0.5) * 8, p = T.sigmoid(1.7 * s - 0.6); z.push(s); y.push(rng() < p ? 1 : 0); }
  const c = T.platt(z, y); assert.ok(Math.abs(c.a - 1.7) < 0.12 && Math.abs(c.b + 0.6) < 0.12, JSON.stringify(c));
  const legit = Array.from({ length: 10000 }, () => rng() * 10); for (const fpr of [0.001, 0.01, 0.1]) { const thr = T.thresholdForFpr(legit, fpr), flagged = legit.filter(v => v >= thr).length / legit.length; assert.ok(flagged <= fpr + 1e-9 && flagged >= fpr * 0.5, `fpr ${fpr} -> ${flagged}`); }
});

test('atThreshold counts correctly and the precision it quotes matches Bayes', () => {
  const z = [5, 4, 3, 1, 0.5, 0.2], y = [1, 1, 0, 1, 0, 0], r = T.atThreshold(z, y, 2.5);
  assert.deepEqual(r.flagged, { phishing: 2, legitimate: 1 }); assert.equal(r.recall.value, 0.6667); assert.equal(r.falseAlarm.value, 0.33333);
  near(r.precisionIfPrevalence['0.1'], (0.6667 * 0.1) / (0.6667 * 0.1 + 0.33333 * 0.9), 0.002);
  assert.ok(r.precisionIfPrevalence['0.3'] > r.precisionIfPrevalence['0.1'] && r.precisionIfPrevalence['0.1'] > r.precisionIfPrevalence['0.01'], 'precision rises with prevalence');
});

test('features: scheme, path and www can never matter, because they are never inputs', () => {
  const spec = T.buildSpec([{ name: 'example', suffix: 'com', y: 0 }, { name: 'paytm-kyc', suffix: 'top', y: 1 }, { name: 'bakery', suffix: 'com', y: 0 }], 10);
  const f1 = M.features('example', 'com', spec), f2 = M.features('example', 'com', spec);
  assert.deepEqual(f1, f2); assert.ok(f1.idx.every(i => i >= 0 && i < f1.size) && f1.val.every(Number.isFinite));
  for (const bad of [{ host: 'http://www.example.com/login?x=1', want: 'example.com' }]) assert.equal(D.hostOf(bad.host), bad.want);
});
