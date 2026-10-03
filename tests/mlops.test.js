'use strict';
// Fixtures are fake strings. The toy detector keys on the word SCAMWORD so every confusion-matrix
// count in these tests is set by construction, not by the real detector.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const h = require('../data_ops/holdout.js');
const m = require('../mlops/metrics.js');
const ev = require('../mlops/evaluate.js');
const g = require('../mlops/gate.js');
const detectors = require('../mlops/detectors.js');
const policy = require('../mlops/policy.json');

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const letters = n => { let s = ''; do { s = String.fromCharCode(97 + n % 26) + s; n = Math.floor(n / 26); } while (n > 0); return s; };

/* Builds a valid S0-sized dataset: `scam` scam rows and `safe` safe rows.
   flaggedScam / flaggedSafe say how many of each carry SCAMWORD (the toy detector's trigger). */
function fixture({ scam = 100, safe = 100, flaggedScam = scam, flaggedSafe = 0, obf = 12 } = {}) {
  const langs = ['en', 'hi', 'hinglish'], lines = [h.COLUMNS.join(',')];
  const add = (i, isScam, flagged) => {
    const text = `fixture ${isScam ? 'scam' : 'safe'} ${letters(i)} ${flagged ? 'SCAMWORD' : 'plainword'} for testing only`;
    lines.push(h.toCsvLine([`R${isScam ? 'S' : 'N'}${i}`, text, langs[i % 3], isScam ? '1' : '0', isScam ? 'other_scam' : 'safe',
      'sms', `2026-0${1 + (i % 9)}-1${i % 9}`, i < obf ? 'true' : 'false']));
  };
  for (let i = 0; i < scam; i++) add(i, true, i < flaggedScam);
  for (let i = 0; i < safe; i++) add(i, false, i < flaggedSafe);
  return lines.join('\n');
}
const toy = t => t.includes('SCAMWORD');
function run(csvText, { sealed, detector = toy, comparison = null, tweak } = {}) {
  const rows = h.parseCsv(csvText), v = h.validateRows(rows, { today: '2026-10-03' });
  assert.deepEqual(v.errors, [], 'fixture itself must be a valid dataset');
  const ex = ev.toExamples(rows), report = ev.evaluate(ex, detector);
  if (tweak) tweak(report);
  const leakage = sealed ? g.findLeakage(ex, sealed, policy.nearDuplicateJaccard) : null;
  return { report, ex, result: g.gate({ stats: v.stats, stage: 's0', report, comparison, leakage, policy }) };
}

/* ---------- statistics: known answers worked out by hand ---------- */
test('wilson interval: 8/10 is [0.490, 0.943]; bounds stay inside [0,1]; n=0 is undefined', () => {
  const w = m.wilson(8, 10); near(w.lo, 0.4902); near(w.hi, 0.9433);
  const z = m.wilson(0, 20), a = m.wilson(20, 20);
  assert.equal(z.lo, 0); assert.ok(z.hi > 0 && z.hi < 0.2);
  assert.equal(a.hi, 1); assert.ok(a.lo > 0.8);
  assert.equal(m.wilson(0, 0).value, null);
});

test('wilson narrows as n grows at the same rate', () => {
  const small = m.wilson(9, 10), big = m.wilson(900, 1000);
  assert.ok(big.hi - big.lo < (small.hi - small.lo) / 5);
});

test('exact McNemar: (0,5) -> 2/32, (1,9) -> 0.0215, symmetric, capped at 1, empty -> 1', () => {
  near(m.mcnemarExact(0, 5), 0.0625); near(m.mcnemarExact(1, 9), 0.021484);
  assert.equal(m.mcnemarExact(3, 7), m.mcnemarExact(7, 3));
  assert.equal(m.mcnemarExact(5, 5), 1); assert.equal(m.mcnemarExact(0, 0), 1);
});

test('PSI: [50,50] vs [25,75] is 0.2747; identical is 0; different bucket sets handled', () => {
  near(m.psi({ a: 50, b: 50 }, { a: 25, b: 75 }), 0.27465, 1e-4);
  assert.equal(m.psi({ a: 5, b: 5 }, { a: 50, b: 50 }), 0);
  assert.ok(m.psi({ a: 10 }, { b: 10 }) > 1);
  assert.equal(m.psi({}, { a: 1 }), null);
});

test('precision at prevalence: recall .9, fpr .1 -> .9 at 50%, .32 at 5%', () => {
  near(m.precisionAtPrevalence(0.9, 0.1, 0.5), 0.9); near(m.precisionAtPrevalence(0.9, 0.1, 0.05), 0.0450 / (0.045 + 0.095), 1e-9);
  assert.equal(m.precisionAtPrevalence(0, 0, 0.5), null);
});

/* ---------- evaluation harness ---------- */
test('confusion counts and rates match the construction', () => {
  const { report } = run(fixture({ flaggedScam: 90, flaggedSafe: 5 }));
  assert.deepEqual([report.tp, report.fn, report.fp, report.tn], [90, 10, 5, 95]);
  near(report.recall.value, 0.9); near(report.fpr.value, 0.05); near(report.precision.value, 90 / 95);
  assert.equal(report.prevalence, 0.5);
});

test('slices: language cells are counted and small cells are marked underpowered', () => {
  const { report } = run(fixture());
  const langs = report.slices.language;
  assert.equal(langs.en.n + langs.hi.n + langs.hinglish.n, 200);
  assert.equal(report.slices.obfuscated.obfuscated.underpowered, true);   // 24 rows < 30
  assert.equal(report.slices.obfuscated.plain.underpowered, false);
  assert.equal(report.slices.category.other_scam.n, 100);
});

test('reference detectors behave: always_scam recall 1, never_scam recall 0, router_v0 returns booleans', () => {
  const { ex } = run(fixture());
  assert.equal(ev.evaluate(ex, detectors.always_scam).recall.value, 1);
  assert.equal(ev.evaluate(ex, detectors.never_scam).recall.value, 0);
  assert.equal(typeof detectors.router_v0('someone asked for my upi pin'), 'boolean');
  assert.equal(detectors.router_v0('someone asked for my upi pin'), true);
});

test('paired comparison counts only discordant rows', () => {
  const ex = [{ y: true }, { y: true }, { y: false }, { y: false }];
  const c = ev.compare(ex, [true, false, true, false], [true, true, false, false]);
  assert.deepEqual([c.candidateOnlyCorrect, c.baselineOnlyCorrect, c.better], [2, 0, 2]);
});

test('drift: too few rows is reported as not measured; a category shift is large', () => {
  assert.equal(ev.driftReport([{ date: '2026-01-01', category: 'a' }]).psiCategory, null);
  const rows = [];
  for (let i = 0; i < 50; i++) rows.push({ date: `2026-01-${String(1 + (i % 9)).padStart(2, '0')}`, category: 'upi_collect' });
  for (let i = 0; i < 50; i++) rows.push({ date: `2026-06-${String(1 + (i % 9)).padStart(2, '0')}`, category: 'job_fraud' });
  assert.ok(ev.driftReport(rows).psiCategory > 0.25);
});

/* ---------- the gate ---------- */
test('NO_EVIDENCE when the dataset is missing or under the stage minimum', () => {
  assert.equal(g.gate({ stats: null, stage: 's0', policy }).status, 'NO_EVIDENCE');
  const small = run(fixture({ scam: 40, safe: 40, flaggedScam: 40 }));
  assert.equal(small.result.status, 'NO_EVIDENCE');
  assert.match(small.result.reasons.join(' '), /at least 200 rows/);
});

test('PASS only when the precision interval clears 0.90', () => {
  const r = run(fixture({ flaggedScam: 98, flaggedSafe: 2 }));
  assert.ok(r.report.precision.lo >= 0.9, 'fixture should clear the bar'); assert.equal(r.result.status, 'PASS');
});

test('INCONCLUSIVE when the point estimate passes but the interval does not', () => {
  const r = run(fixture({ flaggedScam: 60, flaggedSafe: 6 }));
  assert.ok(r.report.precision.value > 0.9 && r.report.precision.lo < 0.9);
  assert.equal(r.result.status, 'INCONCLUSIVE'); assert.match(r.result.reasons.join(' '), /not proven/);
});

test('FAIL when the whole interval is below 0.90', () => {
  const r = run(fixture({ flaggedScam: 50, flaggedSafe: 50 }));
  assert.equal(r.result.status, 'FAIL');
});

test('FAIL for a detector that flags nothing (no crash on undefined precision)', () => {
  const r = run(fixture({ flaggedScam: 0 }));
  assert.equal(r.result.status, 'FAIL'); assert.match(r.result.reasons.join(' '), /caught no scams/);
});

test('FAIL on a significant regression against the baseline, not on a tie', () => {
  const good = fixture({ flaggedScam: 98, flaggedSafe: 2 });
  const worse = run(good, { comparison: { better: -12, candidateOnlyCorrect: 0, baselineOnlyCorrect: 12, p: m.mcnemarExact(0, 12) } });
  assert.equal(worse.result.status, 'FAIL');
  const tie = run(good, { comparison: { better: -1, candidateOnlyCorrect: 4, baselineOnlyCorrect: 5, p: m.mcnemarExact(4, 5) } });
  assert.equal(tie.result.status, 'PASS');
});

test('FAIL when p95 latency exceeds the budget', () => {
  const r = run(fixture({ flaggedScam: 98, flaggedSafe: 2 }), { tweak: rep => { rep.latencyMs.p95 = 51; } });
  assert.equal(r.result.status, 'FAIL'); assert.match(r.result.reasons.join(' '), /latency/);
});

/* ---------- leakage ---------- */
test('leakage: exact copies (digits differ) and near copies are found, distinct rows are not', () => {
  const sentence = 'please share the one time code that we sent so that we can unblock your account today before midnight tonight okay thanks bye now';
  const dev = [{ id: 'D1', text: sentence + ' 1234' }, { id: 'D2', text: 'a wholly unrelated genuine message about dinner plans for tomorrow evening' }];
  const exact = g.findLeakage(dev, [{ id: 'S1', text: sentence + ' 9876' }]);
  assert.deepEqual(exact.map(x => x.kind), ['exact']);
  const swapped = sentence.replace('midnight', 'noon');
  const nearHit = g.findLeakage(dev, [{ id: 'S2', text: swapped }]);
  assert.deepEqual(nearHit.map(x => [x.sealedId, x.devId, x.kind]), [['S2', 'D1', 'near']]);
  assert.deepEqual(g.findLeakage(dev, [{ id: 'S3', text: 'your electricity connection will be cut tonight pay the bill using this link now please' }]), []);
});

test('a leaking sealed set fails the gate even when every metric is perfect', () => {
  const csv = fixture({ flaggedScam: 98, flaggedSafe: 2 });
  const sealed = h.parseCsv(csv).slice(1).slice(0, 3).map(r => ({ id: 'X' + r[0], text: r[1] }));
  const r = run(csv, { sealed });
  assert.equal(r.result.status, 'FAIL'); assert.match(r.result.reasons.join(' '), /overlap/);
});

/* ---------- registry ---------- */
const good = { detector: 'router_v0', detector_sha256: 'a'.repeat(64), data_sha256: 'b'.repeat(64), stage: 's0', status: 'PASS', date: '2026-10-03' };

test('registry: a valid history verifies; malformed and backwards-dated entries are reported', () => {
  assert.deepEqual(g.verifyRegistry([good, { ...good, date: '2026-10-04' }]), []);
  assert.ok(g.verifyRegistry([{ ...good, detector_sha256: 'xyz' }]).some(p => /detector_sha256/.test(p)));
  assert.ok(g.verifyRegistry([{ ...good, status: 'FAIL' }]).some(p => /only PASS or INCONCLUSIVE/.test(p)));
  assert.ok(g.verifyRegistry([good, { ...good, date: '2026-10-01' }]).some(p => /backwards/.test(p)));
  assert.ok(g.verifyRegistry({}).length);
});

test('the committed registry is valid', () => {
  assert.deepEqual(g.verifyRegistry(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mlops', 'registry.json'), 'utf8'))), []);
});

/* ---------- CLI end to end ---------- */
const cli = (args, env = {}) => spawnSync(process.execPath, [path.join(__dirname, '..', 'mlops', 'run.js'), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

test('CLI: no dataset -> NO_EVIDENCE, exit 0, and exit 1 under --require-evidence', () => {
  const missing = path.join(os.tmpdir(), 'fs-no-such-file.csv');
  const a = cli(['--data', missing]); assert.equal(a.status, 0); assert.match(a.stdout, /NO_EVIDENCE/);
  assert.equal(cli(['--data', missing, '--require-evidence']).status, 1);
});

function cliEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-mlops-'));
  const data = path.join(dir, 'd.csv'), reg = path.join(dir, 'reg.json'), det = path.join(dir, 'toy.js');
  fs.writeFileSync(reg, '[]'); fs.writeFileSync(det, "module.exports = t => t.includes('SCAMWORD');");
  return { dir, data, reg, det };
}
const repoReg = () => fs.readFileSync(path.join(__dirname, '..', 'mlops', 'registry.json'), 'utf8');

test('CLI: a detector that fails is not registered and exits 1; the repo registry is untouched', () => {
  const { data, reg } = cliEnv(), before = repoReg();
  fs.writeFileSync(data, fixture({ flaggedScam: 98, flaggedSafe: 2 }));
  // router_v0 has never heard of the fixture's trigger word: recall 0, so the gate must refuse it
  const r = cli(['--data', data, '--register', '--json'], { FS_REGISTRY: reg });
  assert.equal(r.status, 1); assert.equal(JSON.parse(r.stdout).status, 'FAIL');
  assert.deepEqual(JSON.parse(fs.readFileSync(reg, 'utf8')), []);
  assert.equal(repoReg(), before);
});

test('CLI: a passing candidate file is registered with real hashes of the code and the data', () => {
  const { data, reg, det } = cliEnv(), before = repoReg();
  fs.writeFileSync(data, fixture({ flaggedScam: 98, flaggedSafe: 2 }));
  const r = cli(['--data', data, '--detector-file', det, '--register', '--json'], { FS_REGISTRY: reg });
  assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).status, 'PASS');
  const [e, ...rest] = JSON.parse(fs.readFileSync(reg, 'utf8'));
  assert.equal(rest.length, 0); assert.equal(e.detector, 'toy'); assert.equal(e.rows, 200);
  assert.equal(e.data_sha256, require('node:crypto').createHash('sha256').update(fs.readFileSync(data)).digest('hex'));
  assert.equal(e.detector_sha256, require('node:crypto').createHash('sha256').update(fs.readFileSync(det)).digest('hex'));
  assert.deepEqual(g.verifyRegistry([e]), []);
  assert.equal(repoReg(), before);
});

test('CLI: an invalid dataset is rejected before any evaluation', () => {
  const { data, reg } = cliEnv();
  fs.writeFileSync(data, fixture().replace('RS1,', 'RS0,'));   // duplicate id
  assert.equal(cli(['--data', data], { FS_REGISTRY: reg }).status, 1);
});
