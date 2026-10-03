'use strict';
// Property tests: the detector must be invariant to the tricks scammers use to dodge keywords.
// Perturbations are seeded so any failure is reproducible.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../lib/core.js');

function rng(seed) { // mulberry32
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const HOMOGLYPH = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', i: 'і' };
const LEET = { o: '0', e: '3', a: '4', i: '1', s: '5', t: '7' };

// Each perturbation keeps the human meaning of the message intact.
const PERTURBATIONS = {
  upper: (s) => s.toUpperCase(),
  spaces: (s, r) => s.replace(/ /g, () => ' '.repeat(1 + Math.floor(r() * 3))),
  zeroWidth: (s, r) => [...s].map(ch => (/[a-z]/i.test(ch) && r() < 0.4 ? ch + '​' : ch)).join(''),
  homoglyph: (s, r) => [...s].map(ch => (HOMOGLYPH[ch] && r() < 0.5 ? HOMOGLYPH[ch] : ch)).join(''),
  // at most ONE swapped character per word, so the word stays within the normalizer's contract
  leet: (s, r) => s.split(' ').map(w => {
    const idx = [...w].map((c, i) => (LEET[c.toLowerCase()] ? i : -1)).filter(i => i >= 0);
    if (w.replace(/[^a-z]/gi, '').length < 2 || !idx.length || r() < 0.5) return w;
    const i = idx[Math.floor(r() * idx.length)];
    return w.slice(0, i) + LEET[w[i].toLowerCase()] + w.slice(i + 1);
  }).join(' ')
};
const names = Object.keys(PERTURBATIONS);
// Distinct perturbations only: applying the swap perturbation twice would put two swaps in a
// 3-letter word ("otp" -> "07p"), which the normalizer deliberately leaves alone, since a token
// that is mostly digits is far more likely a number than a disguised word. Known limit.
function perturb(s, r) {
  const pool = [...names];
  let out = s;
  for (let n = 1 + Math.floor(r() * 3); n > 0 && pool.length; n--) {
    const name = pool.splice(Math.floor(r() * pool.length), 1)[0];
    out = PERTURBATIONS[name](out, r);
  }
  return out;
}

const SCAMS = [
  ['digital arrest warrant from cbi', 'Digital Arrest'],
  ['share the otp now', 'OTP Scam'],
  ['scan the qr code to receive money', 'UPI Fraud'],
  ['your kyc update is pending', 'Phishing'],
  ['guaranteed return on crypto scheme', 'Investment Scam'],
  ['work from home job registration fee', 'Job Fraud']
];
const BENIGN = ['we ate hotpot yesterday', 'what a stupid idea', 'the train was late', 'see you at lunch tomorrow',
  'the building was denuded by storms'];

test('detectIntent is invariant to case, spacing, zero-width chars, homoglyphs and in-word swaps', () => {
  const r = rng(20261003);
  for (const [phrase, intent] of SCAMS) {
    assert.equal(core.detectIntent(phrase), intent, `baseline wrong for: ${phrase}`);
    for (let i = 0; i < 300; i++) {
      const variant = perturb(phrase, r);
      assert.equal(core.detectIntent(variant), intent, `flipped: ${JSON.stringify(variant)} (from "${phrase}")`);
    }
  }
});

test('benign text stays benign under the same perturbations (no wildcard false positives)', () => {
  const r = rng(77);
  for (const phrase of BENIGN) {
    assert.equal(core.detectIntent(phrase), null, `baseline wrong for: ${phrase}`);
    for (let i = 0; i < 300; i++) {
      const variant = perturb(phrase, r);
      assert.equal(core.detectIntent(variant), null, `false positive: ${JSON.stringify(variant)}`);
    }
  }
});

test('normalize is idempotent', () => {
  const r = rng(5);
  const corpus = [...SCAMS.map(s => s[0]), ...BENIGN, 'U.P.I collect', 'kyc p@nding', 'Rs 1,00,000 call 1930', 'आपका खाता बंद'];
  for (const base of corpus) for (let i = 0; i < 100; i++) {
    const once = core.normalize(perturb(base, r));
    assert.equal(core.normalize(once), once);
  }
});

test('normalize leaves numbers, amounts, phone-like tokens and Devanagari untouched', () => {
  for (const t of ['Rs 1,00,000 debited on 12/10/2025', 'call 1930 now', 'Rs500 only', 'आपका खाता बंद हो जाएगा', 'OTP123456']) {
    assert.equal(core.normalize(t), t);
  }
});

test('known obfuscations resolve', () => {
  assert.equal(core.normalize('U.P.I collect'), 'UPI collect');
  assert.equal(core.normalize('K Y C update'), 'KYC update');
  assert.equal(core.detectIntent('kyc upd@te karo'), 'Phishing');
  assert.equal(core.detectIntent('0TP bhej do'), 'OTP Scam');
  assert.equal(core.detectIntent('your CBI c​ase'), 'Digital Arrest');
  assert.equal(core.detectIntent('оtp batao'), 'OTP Scam'); // Cyrillic o
});

test('URL analysis still sees raw text (normalization must not touch links)', () => {
  assert.equal(core.findLinkIn('visit sbi-kyc-upd4te.tk now'), 'sbi-kyc-upd4te.tk');
  assert.equal(core.checkLink('sbi-kyc-upd4te.tk').verdict, 'danger');
});
