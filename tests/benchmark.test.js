'use strict';
// Everything here runs offline on synthetic data. The real benchmark is run by hand (mlops/benchmarks/run_sms.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const { extractEntry, parseSms } = require('../mlops/benchmarks/fetch_sms.js');
const tm = require('../mlops/benchmarks/text_models.js');
const pl = require('../mlops/benchmarks/pipeline.js');
const { normalizeForDedup } = require('../data_ops/holdout.js');

const ROOT = path.join(__dirname, '..');

/* ---------- zip reader ---------- */
function makeZip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name), raw = Buffer.from(e.data), data = e.method === 8 ? zlib.deflateRawSync(raw) : raw;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(e.method, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(e.method, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, data); centrals.push(ch, name); offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('zip reader extracts stored and deflated entries and rejects bad input', () => {
  const zip = makeZip([{ name: 'a.txt', data: 'stored text', method: 0 }, { name: 'dir/b.txt', data: 'hello '.repeat(200), method: 8 }]);
  assert.equal(extractEntry(zip, 'a.txt').toString(), 'stored text');
  assert.equal(extractEntry(zip, 'dir/b.txt').toString(), 'hello '.repeat(200));
  assert.throws(() => extractEntry(zip, 'missing.txt'), /not found/);
  assert.throws(() => extractEntry(Buffer.from('not a zip at all, just text'), 'a.txt'), /not a zip/);
});

test('parseSms reads labelled lines, keeps tabs inside the text, rejects bad labels', () => {
  assert.deepEqual(parseSms('ham\thello there\nspam\twin\tbig prize\r\n'), [{ y: false, text: 'hello there' }, { y: true, text: 'win\tbig prize' }]);
  assert.throws(() => parseSms('maybe\tx'), /expected "ham" or "spam"/);
});

/* ---------- models ---------- */
const SPAM_WORDS = 'free prize winner claim urgent cash reward voucher selected congratulations'.split(' ');
const HAM_WORDS = 'dinner tomorrow meeting lunch home reach later thanks office movie weekend'.split(' ');
const FILLER = 'the a you your now to call at for with and'.split(' ');
const letters = n => { let t = ''; do { t = String.fromCharCode(97 + n % 26) + t; n = Math.floor(n / 26); } while (n > 0); return t; };
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function corpus(n = 1600, seed = 7) {
  const rnd = mulberry32(seed), pick = a => a[Math.floor(rnd() * a.length)], rows = [];
  for (let i = 0; i < n; i++) {
    const y = rnd() < 0.2, words = [];
    for (let k = 0; k < 8; k++) words.push(rnd() < 0.5 ? pick(y ? SPAM_WORDS : HAM_WORDS) : pick(FILLER));
    rows.push({ y, text: words.join(' ') });
  }
  // long texts that differ by one word: near-duplicates the exact-match key cannot see
  for (let i = 0; i < 100; i++) {
    const base = Array.from({ length: 20 }, () => pick(HAM_WORDS)).join(' ');
    rows.push({ y: false, text: base + ' alpha' }, { y: false, text: base + ' beta' });
  }
  return rows;
}
const fakeAccuracy = (model, rows) => rows.filter(r => tm.predictor(model)(r.text) === r.y).length / rows.length;

test('both trainers separate a clean synthetic corpus and ship a model that survives JSON round trip', () => {
  const rows = corpus(), thr = { threshold: 0 };
  for (const model of [tm.trainNB(rows), tm.trainLR(rows)]) {
    assert.ok(fakeAccuracy({ ...model, ...thr }, rows) > 0.95, model.kind);
    const again = JSON.parse(JSON.stringify(model));
    assert.deepEqual(rows.slice(0, 50).map(r => tm.predictor(again)(r.text)), rows.slice(0, 50).map(r => tm.predictor(model)(r.text)));
    for (const v of Object.values(model.weights)) assert.equal(v, Math.round(v * 1000) / 1000);   // shipped = evaluated
  }
});

test('training needs both classes and LR is deterministic for a seed', () => {
  assert.throws(() => tm.trainNB([{ y: true, text: 'only spam here' }]), /both classes/);
  assert.throws(() => tm.trainLR([{ y: false, text: 'only ham here' }]), /both classes/);
  const rows = corpus(200);
  assert.deepEqual(tm.trainLR(rows, { seed: 3 }), tm.trainLR(rows, { seed: 3 }));
});

test('char n-gram features are opt-in and make the model larger', () => {
  assert.ok(!tm.features('hello world', { chars: false }).some(f => f.startsWith('c:')));
  assert.ok(tm.features('hello world', { chars: true }).some(f => f.startsWith('c:')));
  const rows = corpus(200);
  assert.ok(tm.sizeBytes(tm.trainNB(rows, { chars: true })) > tm.sizeBytes(tm.trainNB(rows, { chars: false })));
});

test('chooseThreshold: known answer, ties go to the higher threshold, impossible target gives null', () => {
  const scores = [...Array(50).keys()].map(i => 50 + i).concat([...Array(50).keys()]);   // 50 positives above 50 negatives
  const labels = scores.map((_, i) => i < 50);
  const pick = tm.chooseThreshold(scores, labels, 0.9);
  assert.equal(pick.threshold, 50); assert.equal(pick.recall, 1); assert.ok(pick.precisionLo >= 0.9);
  // only 10 positives: even a perfect 10/10 has a Wilson lower bound near 0.72
  assert.equal(tm.chooseThreshold([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, -1], [true, true, true, true, true, true, true, true, true, true, false], 0.9), null);
});

/* ---------- pipeline protocol ---------- */
test('splits partition the rows, and rows that differ only in digits or bracketed placeholders share a split', () => {
  const rows = corpus(), seen = { train: 0, val: 0, test: 0 };
  rows.forEach(r => seen[pl.splitOf(r.text)]++);
  assert.equal(seen.train + seen.val + seen.test, rows.length);
  for (const s of Object.values(seen)) assert.ok(s > 0);
  // many pairs, so agreement cannot be a coincidence of hashing (a chance match is about 44% for one pair)
  for (let i = 0; i < 60; i++) assert.equal(pl.splitOf(`call ${1000 + i} now [PHONE] to claim prize ${letters(i)}`), pl.splitOf(`call ${9000 + i * 7} now [UPI] to claim prize ${letters(i)}`));
  assert.equal(normalizeForDedup('call 98765 now [PHONE] to claim'), normalizeForDedup('call 12345 now [UPI] to claim'));
});

test('naive split is a seeded shuffle and does keep duplicates apart', () => {
  const a = pl.naiveSplit(corpus(), 'x'), b = pl.naiveSplit(corpus(), 'x'), c = pl.naiveSplit(corpus(), 'y');
  assert.deepEqual(a.test.map(r => r.text), b.test.map(r => r.text));
  assert.notDeepEqual(a.test.map(r => r.text), c.test.map(r => r.text));
});

const bench2 = (rows, o) => { const { _model, ...r } = pl.runBenchmark(rows, o); return r; };
const bench = rows => bench2(rows);

test('the test split plays no part in choosing the model: flipping every test label changes nothing upstream', () => {
  const rows = corpus(), flipped = rows.map(r => (pl.splitOf(r.text) === 'test' ? { ...r, y: !r.y } : r));
  const a = bench(rows), b = bench(flipped);
  assert.ok(!a.error, a.error);
  assert.deepEqual(a.selection, b.selection); assert.deepEqual(a.model, b.model);
  assert.notDeepEqual(a.candidate.recall, b.candidate.recall);   // only the test-time numbers react
});

test('near-duplicates of training rows are removed from the test split before scoring', () => {
  const r = bench(corpus());
  assert.ok(r.leakage.nearOrExactDuplicatesRemovedFromTest >= 1, 'corpus is built to contain cross-split near-duplicates');
  assert.equal(r.split.testAfterRemovingNearDuplicates.rows, r.split.test.rows - r.leakage.nearOrExactDuplicatesRemovedFromTest);
  assert.equal(r.candidate.n, r.split.testAfterRemovingNearDuplicates.rows);
});

test('selection honours the size budget and the precision floor, and reports every configuration', () => {
  const r = bench(corpus());
  assert.equal(r.selection.cv.length, pl.CANDIDATES.length * pl.MARGINS.length);
  const win = r.selection.cv.find(c => c.name === r.selection.winner);
  assert.ok(!win.overBudget && win.precision.lo >= 0.9);
  assert.ok(r.model.sizeBytes <= r.selection.maxModelBytes);
});

test('the size budget is enforced: a tight budget excludes the larger models, an impossible one yields an error', () => {
  const rows = corpus(), full = bench(rows), sizeOf = n => full.selection.cv.find(c => c.name.startsWith(n)).sizeBytes;
  assert.ok(sizeOf('nb_words_chars') > sizeOf('nb_words'), 'fixture needs char models to be larger');
  const budget = Math.floor((Math.max(sizeOf('nb_words@'), sizeOf('lr_words@')) + Math.min(sizeOf('nb_words_chars'), sizeOf('lr_words_chars'))) / 2);
  const tight = bench2(rows, { maxModelBytes: budget });
  assert.ok(!tight.error && !/chars/.test(tight.selection.winner), tight.selection.winner);
  assert.ok(tight.selection.cv.filter(c => /chars/.test(c.name)).every(c => c.overBudget));
  assert.ok(bench2(rows, { maxModelBytes: 1 }).error);
});

const cfg = (name, recall, lo, extra = {}) => ({ name, recall: { value: recall }, precision: { n: 100, lo }, sizeBytes: 100, overBudget: false, ...extra });

test('selectWinner: highest recall among configs that clear the precision floor and the budget', () => {
  const ranked = [cfg('best_recall_bad_precision', 0.99, 0.80), cfg('ok_a', 0.90, 0.92), cfg('ok_b', 0.93, 0.91), cfg('too_big', 0.97, 0.95, { overBudget: true })];
  assert.equal(pl.selectWinner(ranked, 0.9).name, 'ok_b');
  assert.equal(pl.selectWinner([cfg('x', 0.9, 0.5)], 0.9), null);
  assert.equal(pl.selectWinner([cfg('empty', 1, 1, { precision: { n: 0, lo: null } })], 0.9), null);   // flagged nothing
  assert.equal(pl.selectWinner([cfg('big', 0.9, 0.95, { sizeBytes: 500 }), cfg('small', 0.9, 0.95)], 0.9).name, 'small');   // tie -> smaller
});

test('an impossible precision floor is reported as an error, not papered over', () => {
  const tiny = [...corpus(60)].map((r, i) => ({ ...r, y: i % 2 === 0 }));   // labels unrelated to text
  const r = pl.runBenchmark(tiny);
  assert.ok(r.error, 'noise labels must not produce a "winner"');
});

/* ---------- claims guard ---------- */
test('proxy benchmark numbers are never presented as FraudShield results on any page', () => {
  const dir = path.join(ROOT, 'mlops', 'benchmarks', 'results');
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const pct = c => (100 * c.value).toFixed(1) + '%';
  const needles = ['sms spam collection', 'uci-sms', 'mendeley-smishing'];
  for (const f of files) {
    const res = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.equal(res.proxy, true, f); assert.equal(res.claimable, false, f); assert.match(res.warning, /NOT a measure of FraudShield/, f);
    // headline numbers: the UCI candidate, and the independent-slice recall and false-alarm of every external detector
    if (res.candidate) needles.push(pct(res.candidate.precision), pct(res.candidate.recall));
    if (res.results && res.results.independent) for (const d of Object.values(res.results.independent)) if (d.recall && d.recall.value !== null && d.recall.value > 0 && d.recall.value < 1) needles.push(pct(d.recall));
  }
  const shipped = fs.readdirSync(ROOT).filter(f => /\.(html|md)$/.test(f)).concat(['script.js', 'sw.js', 'lib/core.js']);
  for (const f of shipped) {
    let text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (f === 'README.md') {
      // the README may report the proxy numbers only inside its "Measured so far" section, labelled as a proxy
      const m = text.match(/\n## Measured so far[\s\S]*?(?=\n## |$)/);
      assert.ok(m, 'README needs a "Measured so far" section');
      assert.match(m[0], /proxy/i); assert.match(m[0], /not FraudShield/i);
      text = text.replace(m[0], '');
    }
    text = text.toLowerCase();
    for (const n of needles) assert.ok(!text.includes(n.toLowerCase()), `${f} mentions "${n}" outside a labelled proxy section; proxy benchmark results must not appear in product copy`);
  }
});
