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

// Pollution guard: nothing in this file may change the real registry or the committed benchmark results.
const REAL = ['mlops/registry.json', 'mlops/benchmarks/results/uci_sms_spam.json'].map(f => path.join(__dirname, '..', f));
const snapshot = () => REAL.map(f => (fs.existsSync(f) ? require('node:crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex') : 'absent'));
const BEFORE = snapshot();
test.after(() => assert.deepEqual(snapshot(), BEFORE, 'a test wrote to the real registry or results file'));

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const letters = n => { let s = ''; do { s = String.fromCharCode(97 + n % 26) + s; n = Math.floor(n / 26); } while (n > 0); return s; };

/* Builds a valid S0-sized dataset: `scam` scam rows and `safe` safe rows.
   flaggedScam / flaggedSafe say how many of each carry SCAMWORD (the toy detector's trigger). */
function fixture({ scam = 100, safe = 100, flaggedScam = scam, flaggedSafe = 0, obf = Math.ceil(0.03 * (scam + safe)) } = {}) {
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

test('precision at prevalence: recall .9, fpr .1 -> .9 at 50%, .32 at 5%; 0/0 is defined as 0, never 1', () => {
  near(m.precisionAtPrevalence(0.9, 0.1, 0.5), 0.9); near(m.precisionAtPrevalence(0.9, 0.1, 0.05), 0.0450 / (0.045 + 0.095), 1e-9);
  assert.equal(m.precisionAtPrevalence(0, 0, 0.01), 0);
  near(m.precisionAtPrevalence(0.95, 0.013, 0.01), 0.0095 / (0.0095 + 0.01287), 1e-4);   // the 1% prevalence case from the benchmark
});

test('negativesNeededToProve is exact: n genuine messages suffice, n-1 do not', () => {
  for (const [r, pi, mp] of [[0.95, 0.01, 0.9], [0.9, 0.05, 0.9], [0.99, 0.01, 0.95]]) {
    const n = m.negativesNeededToProve(r, mp, pi), f = r * pi * (1 - mp) / (mp * (1 - pi));
    assert.ok(m.wilson(0, n).hi <= f, 'n suffices'); assert.ok(m.wilson(0, n - 1).hi > f, 'n-1 does not');
  }
  assert.equal(m.negativesNeededToProve(0.95, 0.9, 0.01), 3600);
  assert.equal(m.negativesNeededToProve(0, 0.9, 0.01), Infinity);
});

test('the maths rejects impossible inputs instead of returning a number', () => {
  assert.throws(() => m.wilson(5, 3), RangeError); assert.throws(() => m.wilson(-1, 3), RangeError); assert.throws(() => m.wilson(1.5, 3), RangeError);
  assert.throws(() => m.mcnemarExact(-1, 2), RangeError); assert.throws(() => m.psi({ a: -1 }, { a: 1 }), RangeError);
  for (const bad of [0, 1, -0.1, 1.1, NaN]) assert.throws(() => m.precisionAtPrevalence(0.9, 0.1, bad), RangeError);
  assert.throws(() => m.precisionAtPrevalence(1.2, 0.1, 0.5), RangeError);
});

test('validatePolicy rejects a missing or nonsensical policy', () => {
  assert.doesNotThrow(() => g.validatePolicy(policy));
  for (const k of ['minPrecision', 'prevalence', 'maxP95LatencyMs']) assert.throws(() => g.validatePolicy({ ...policy, [k]: undefined }), RangeError);
  assert.throws(() => g.validatePolicy({ ...policy, prevalence: 1 }), RangeError);
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
// At 1% scam prevalence, 0.90 adjusted precision needs a false-alarm rate near 0.1%, which only thousands of
// genuine messages can prove. PASS therefore needs a large genuine set: 100 scams and 4,000 genuine, none flagged wrongly.
const PASS_CSV = fixture({ scam: 100, safe: 4000, flaggedScam: 100, flaggedSafe: 0 });

test('NO_EVIDENCE when the dataset is missing or under the stage minimum', () => {
  assert.equal(g.gate({ stats: null, stage: 's0', policy }).status, 'NO_EVIDENCE');
  const small = run(fixture({ scam: 40, safe: 40, flaggedScam: 40 }));
  assert.equal(small.result.status, 'NO_EVIDENCE');
  assert.match(small.result.reasons.join(' '), /at least 200 rows/);
});

test('PASS needs the worst case of the prevalence-adjusted precision to clear 0.90', () => {
  const r = run(PASS_CSV);
  assert.ok(r.result.adjusted.conservative >= 0.9 && r.result.adjusted.point === 1); assert.equal(r.result.status, 'PASS');
});

test('INCONCLUSIVE when the measured value passes but the data cannot prove it, and the reason says how much data is missing', () => {
  const r = run(fixture({ flaggedScam: 98, flaggedSafe: 0 }));   // 0 false alarms in 100 genuine messages
  assert.equal(r.result.adjusted.point, 1); assert.ok(r.result.adjusted.conservative < 0.9);
  assert.equal(r.result.status, 'INCONCLUSIVE');
  assert.match(r.result.reasons.join(' '), /needs about \d+ genuine messages with no false alarms; there are 100/);
});

test('raw precision is never the decision: 98% raw precision still FAILS when adjusted precision at 1% is poor', () => {
  const r = run(fixture({ flaggedScam: 98, flaggedSafe: 2 }));
  assert.ok(r.report.precision.value > 0.97, 'raw precision looks excellent');
  assert.ok(r.result.adjusted.point < 0.4); assert.equal(r.result.status, 'FAIL');
});

test('FAIL when the model flags nothing: precision 0/0 is 0 (not null, not 1) with a fatal message', () => {
  const r = run(fixture({ flaggedScam: 0, flaggedSafe: 0 }));
  assert.equal(r.report.precision.value, 0); assert.equal(r.report.precision.flagsNothing, true); assert.equal(r.report.recall.value, 0);
  assert.equal(r.result.status, 'FAIL'); assert.equal(r.result.criteria.flagsSomething, 'failed');
  assert.match(r.result.reasons.join(' '), /FATAL: Model Flags Nothing/);
});

test('FAIL when the model flags only genuine messages (catches no scam)', () => {
  const r = run(fixture({ flaggedScam: 0, flaggedSafe: 5 }));
  assert.equal(r.result.status, 'FAIL'); assert.match(r.result.reasons.join(' '), /caught no scams/);
});

test('adjustedVerdict: unmeasurable rates fail instead of passing silently', () => {
  const none = { recall: { n: 0 }, fpr: { n: 10 }, precision: {}, tp: 0 };
  assert.equal(g.adjustedVerdict(none, policy).verdict, 'failed');
});

test('FAIL on a significant regression against the baseline, not on a tie', () => {
  const worse = run(PASS_CSV, { comparison: { better: -12, candidateOnlyCorrect: 0, baselineOnlyCorrect: 12, p: m.mcnemarExact(0, 12) } });
  assert.equal(worse.result.status, 'FAIL');
  const tie = run(PASS_CSV, { comparison: { better: -1, candidateOnlyCorrect: 4, baselineOnlyCorrect: 5, p: m.mcnemarExact(4, 5) } });
  assert.equal(tie.result.status, 'PASS');
});

test('FAIL when p95 latency exceeds the budget', () => {
  const r = run(PASS_CSV, { tweak: rep => { rep.latencyMs.p95 = 51; } });
  assert.equal(r.result.status, 'FAIL'); assert.match(r.result.reasons.join(' '), /latency/);
});

test('latency excludes the cold start: a detector whose first call is slow is measured after warm-up', () => {
  let calls = 0;
  const cold = t => { if (calls++ === 0) { const end = Date.now() + 40; while (Date.now() < end); } return t.length > 0; };
  const five = Array.from({ length: 5 }, (_, i) => ({ text: 'x' + i, y: true }));   // p95 of 5 samples is the maximum
  assert.ok(ev.evaluate(five, cold).latencyMs.p95 < 20, 'the 40 ms cold call must not be timed');
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
  const sealed = h.parseCsv(PASS_CSV).slice(1).slice(0, 3).map(r => ({ id: 'X' + r[0], text: r[1] }));
  const r = run(PASS_CSV, { sealed });
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
const crypto = require('node:crypto');
const cli = (args, env = {}) => spawnSync(process.execPath, [path.join(__dirname, '..', 'mlops', 'run.js'), ...args], { encoding: 'utf8', env: { ...process.env, FS_REGISTRY: '', FS_DATA: '', FS_POLICY: '', FS_SEALED: '', ...env } });
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-mlops-'));
  const o = { dir, data: path.join(dir, 'd.csv'), reg: path.join(dir, 'reg.json'), det: path.join(dir, 'toy.js'), pol: path.join(dir, 'policy.json') };
  fs.writeFileSync(o.reg, '[]'); fs.writeFileSync(o.det, "module.exports = t => t.includes('SCAMWORD');"); fs.writeFileSync(o.pol, JSON.stringify(policy));
  return o;
}

test('CLI: missing data exits 1 (never 0)', () => {
  const r = cli(['--data', path.join(os.tmpdir(), 'fs-no-such-file.csv')]);
  assert.equal(r.status, 1); assert.match(r.stdout, /NO_EVIDENCE/);
});

test('CLI --report: with no evidence yet it says so and exits 0, a model that measurably fails still exits 1, and without the flag a release is blocked', () => {
  const missing = path.join(os.tmpdir(), 'fs-no-such-file.csv');
  const r = cli(['--data', missing, '--report']);
  assert.equal(r.status, 0); assert.match(r.stdout, /NO_EVIDENCE/); assert.match(r.stdout, /REPORT MODE: nothing was measured/);
  assert.equal(cli(['--data', missing]).status, 1, 'the release gate is unchanged');
  const { data, reg, pol, dir } = sandbox();
  fs.writeFileSync(data, PASS_CSV);
  const flagsNothing = path.join(dir, 'none.js'); fs.writeFileSync(flagsNothing, 'module.exports = () => false;');
  const bad = cli(['--data', data, '--registry', reg, '--policy', pol, '--detector-file', flagsNothing, '--report']);
  assert.equal(bad.status, 1); assert.match(bad.stdout, /GATE FAIL/);
});

test('CLI: on GitHub Actions the answer is also written as a table to the run summary', () => {
  const { dir } = sandbox(), summary = path.join(dir, 'summary.md');
  cli(['--data', path.join(os.tmpdir(), 'fs-no-such-file.csv'), '--report'], { GITHUB_STEP_SUMMARY: summary });
  const t = fs.readFileSync(summary, 'utf8');
  assert.match(t, /### Release evidence: NO_EVIDENCE/); assert.match(t, /report \(pull request\)/);
});

test('CLI: corrupt data, a missing policy and a corrupt registry all exit non-zero', () => {
  const { data, reg, pol } = sandbox();
  fs.writeFileSync(data, fixture().replace('RS1,', 'RS0,'));   // duplicate id
  assert.equal(cli(['--data', data, '--registry', reg, '--policy', pol]).status, 1);
  fs.writeFileSync(data, PASS_CSV);
  assert.notEqual(cli(['--data', data, '--registry', reg, '--policy', path.join(os.tmpdir(), 'nope.json')]).status, 0);
  fs.writeFileSync(reg, '{not json');
  assert.notEqual(cli(['--data', data, '--registry', reg, '--policy', pol]).status, 0);
});

test('CLI: every path is injectable by environment variable alone', () => {
  const { data, reg, det, pol } = sandbox();
  fs.writeFileSync(data, PASS_CSV);
  const env = { FS_DATA: data, FS_REGISTRY: reg, FS_POLICY: pol };
  const ok = cli(['--detector-file', det, '--json'], env);
  assert.equal(ok.status, 0); assert.equal(JSON.parse(ok.stdout).status, 'PASS');
  fs.writeFileSync(pol, JSON.stringify({ ...policy, maxP95LatencyMs: 1e-9 }));   // a policy only the env var can reach
  const strict = cli(['--detector-file', det, '--json'], env);
  assert.equal(strict.status, 1); assert.match(JSON.parse(strict.stdout).reasons.join(' '), /latency/);
});

test('CLI: INCONCLUSIVE warns and exits 0, and exits 1 under --strict', () => {
  const { data, reg, det, pol } = sandbox();
  fs.writeFileSync(data, fixture({ flaggedScam: 98, flaggedSafe: 0 }));
  const base = ['--data', data, '--registry', reg, '--policy', pol, '--detector-file', det];
  const lax = cli(base); assert.equal(lax.status, 0); assert.match(lax.stdout, /INCONCLUSIVE/); assert.match(lax.stderr, /not proven/);
  assert.equal(cli([...base, '--strict']).status, 1);
});

test('CLI: failing detectors exit 1 and are never registered; a detector that flags nothing is called out as fatal', () => {
  const { dir, data, reg, pol } = sandbox();
  fs.writeFileSync(data, PASS_CSV);
  const base = ['--data', data, '--registry', reg, '--policy', pol, '--register', '--json'];
  const never = path.join(dir, 'never.js'); fs.writeFileSync(never, 'module.exports = () => false;');
  const a = cli([...base, '--detector-file', never]), outA = JSON.parse(a.stdout);
  assert.equal(a.status, 1); assert.equal(outA.status, 'FAIL'); assert.match(outA.reasons.join(' '), /FATAL: Model Flags Nothing/); assert.equal(outA.report.precision.value, 0);
  const b = cli(base), outB = JSON.parse(b.stdout);   // shipped router: knows nothing about the fixture's trigger word
  assert.equal(b.status, 1); assert.equal(outB.status, 'FAIL');
  assert.deepEqual(JSON.parse(fs.readFileSync(reg, 'utf8')), []);
});

test('CLI: a passing candidate is registered with real hashes of the code and the data, in the injected registry only', () => {
  const { data, reg, det, pol } = sandbox();
  fs.writeFileSync(data, PASS_CSV);
  const r = cli(['--data', data, '--registry', reg, '--policy', pol, '--detector-file', det, '--register', '--json']);
  assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).status, 'PASS');
  const [e, ...rest] = JSON.parse(fs.readFileSync(reg, 'utf8'));
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  assert.equal(rest.length, 0); assert.equal(e.detector, 'toy'); assert.equal(e.rows, 4100);
  assert.equal(e.data_sha256, sha(data)); assert.equal(e.detector_sha256, sha(det));
  assert.equal(e.adjusted_precision.prevalence, 0.01); assert.deepEqual(g.verifyRegistry([e]), []);
});
