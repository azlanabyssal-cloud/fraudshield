'use strict';
// Fixtures below are obviously fake strings used only to test the validator.
// They are never written to data_ops/ — the dataset itself contains real messages only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const h = require('../data_ops/holdout.js');

const TODAY = '2026-10-03';
const HEADER = h.COLUMNS.join(',');
const row = (o = {}) => {
  const r = { id: 'T-1', raw_text_scrubbed: 'fixture text for testing only', language_tag: 'en', is_scam: '1',
    attack_category: 'other_scam', source_platform: 'sms', date_received: '2026-09-01', contains_obfuscation: 'false', ...o };
  return h.toCsvLine(h.COLUMNS.map(c => r[c]));
};
const check = (...lines) => h.validateRows(h.parseCsv([HEADER, ...lines].join('\n')), { today: TODAY });

test('parseCsv handles quotes, commas, embedded newlines and CRLF', () => {
  const rows = h.parseCsv('a,b\r\n"x, ""y""","line1\nline2"\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, "y"', 'line1\nline2']]);
  assert.throws(() => h.parseCsv('a,"unterminated'), /Unterminated/);
});

test('toCsvLine round-trips through parseCsv', () => {
  const vals = ['id', 'has, comma and "quote"\nand newline', 'en'];
  assert.deepEqual(h.parseCsv(h.toCsvLine(vals))[0], vals);
});

test('a clean row passes', () => {
  assert.deepEqual(check(row()).errors, []);
});

test('findPii catches unmasked phone numbers in every common format', () => {
  for (const t of ['call 9876543210 now', 'call +91 98765 43210', 'call 98765-43210 now', 'call 0987 654 3210', 'call 91-9876543210']) {
    assert.ok(h.findPii(t).some(p => /unmasked number/.test(p)), `missed: ${t}`);
  }
});

test('findPii catches account and Aadhaar-length numbers', () => {
  assert.ok(h.findPii('acct 123456789012').length);
  assert.ok(h.findPii('aadhaar 1234 5678 9012').length);
});

test('findPii catches UPI IDs, emails, handles and PAN', () => {
  for (const t of ['pay to scammer@ybl', 'pay x@okicici now', 'mail me a.b@gmail.com', 'dm @someone', 'my PAN ABCDE1234F']) {
    assert.ok(h.findPii(t).length, `missed: ${t}`);
  }
});

test('findPii: leet-speak "@" is allowed, unknown-suffix UPI IDs with digits are not', () => {
  assert.deepEqual(h.findPii('your kyc p@nding, upd@te now'), []);
  assert.ok(h.findPii('pay user99@newbank').length);
  assert.ok(h.findPii('pay john.doe@somebank').length);
  assert.ok(h.findPii('write to a@b.com').length);
});

test('an allowed "@" requires contains_obfuscation=true', () => {
  const t = 'your kyc p@nding, update now';
  assert.ok(check(row({ raw_text_scrubbed: t, contains_obfuscation: 'false' })).errors.some(e => /contains_obfuscation must be true/.test(e)));
  assert.deepEqual(check(row({ raw_text_scrubbed: t, contains_obfuscation: 'true' })).errors, []);
});

test('findPii accepts correctly masked text and ordinary numbers', () => {
  const ok = 'Call [PHONE] or pay [UPI]. Account [ACCOUNT] debited Rs 1,00,000 on 12/10/2025. Use code [OTP] within 10 minutes. Dial 1930.';
  assert.deepEqual(h.findPii(ok), []);
});

test('findPii rejects unknown placeholders (typos would otherwise slip through)', () => {
  assert.ok(h.findPii('call [PHONNE] now').some(p => /unknown placeholder/.test(p)));
});

test('validateRows rejects bad schema values with line numbers', () => {
  const words = ['apple', 'bridge', 'candle', 'dragon', 'engine', 'forest', 'garden'];
  const u = (id, o) => row({ id, raw_text_scrubbed: `fixture about ${words[Number(id.slice(2)) - 1]} only`, ...o });
  const r = check(u('T-1', { language_tag: 'te' }), u('T-2', { is_scam: '2' }), u('T-3', { source_platform: 'fax' }),
    u('T-4', { date_received: '2026-02-30' }), u('T-5', { date_received: '2027-01-01' }),
    u('T-6', { contains_obfuscation: 'yes' }), u('T-7', { attack_category: 'made_up' }));
  assert.equal(r.errors.length, 7, r.errors.join('\n'));
  assert.match(r.errors[0], /^line 2:/);
});

test('is_scam and attack_category must agree', () => {
  assert.equal(check(row({ is_scam: '0', attack_category: 'safe', raw_text_scrubbed: 'your parcel arrives tomorrow' })).errors.length, 0);
  assert.equal(check(row({ is_scam: '1', attack_category: 'safe' })).errors.length, 1);
  assert.equal(check(row({ is_scam: '0', attack_category: 'upi_collect' })).errors.length, 1);
});

test('duplicate ids and near-duplicate texts are rejected', () => {
  assert.ok(check(row(), row()).errors.some(e => /duplicate id/.test(e)));
  const a = row({ id: 'A', raw_text_scrubbed: 'Your account 12 is blocked, update KYC today' });
  const b = row({ id: 'B', raw_text_scrubbed: 'Your account 99 is blocked, update  KYC today' });
  assert.ok(check(a, b).errors.some(e => /duplicate of line/.test(e)));
});

test('wrong header and wrong column count are rejected', () => {
  assert.ok(h.validateRows(h.parseCsv('id,text\n1,2'), { today: TODAY }).errors[0].includes('header must be exactly'));
  assert.ok(check('T-1,only two cols').errors.some(e => /expected 8 columns/.test(e)));
  assert.ok(h.validateRows([]).errors.length);
});

test('finalChecks refuses an incomplete dataset', () => {
  const stats = check(row()).stats;
  const problems = h.finalChecks(stats);
  assert.ok(problems.some(p => /at least 1000 rows/.test(p)));
  assert.ok(problems.some(p => /language "hi"/.test(p)));
});

test('CLI: generated template validates; a leaky file exits non-zero', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holdout-'));
  const tpl = path.join(dir, 'golden_holdout_template.csv');
  execFileSync('node', [path.join(__dirname, '../data_ops/generate_template.js'), tpl]);
  assert.equal(fs.readFileSync(tpl, 'utf8'), HEADER + '\n');
  const validator = path.join(__dirname, '../data_ops/validate_csv.js');
  assert.equal(spawnSync('node', [validator, tpl]).status, 0);
  const bad = path.join(dir, 'bad.csv');
  fs.writeFileSync(bad, HEADER + '\n' + row({ raw_text_scrubbed: 'call 9876543210 pay x@ybl now' }) + '\n');
  const res = spawnSync('node', [validator, bad]);
  assert.equal(res.status, 1);
  assert.match(res.stderr.toString(), /unmasked number/);
  assert.equal(spawnSync('node', [validator, path.join(dir, 'nope.csv')]).status, 2);
});

// ---- staged gates ----
function statsFor(n, { hi = 0.3, hinglish = 0.3, safe = 0.3, obf = 0.2, perCat = 25 } = {}) {
  const lang = { en: Math.round(n * (1 - hi - hinglish)), hi: Math.round(n * hi), hinglish: Math.round(n * hinglish) };
  const category = { safe: Math.round(n * safe) };
  for (const c of h.SCAM_CATEGORIES) category[c] = perCat;
  return { rows: n, language: lang, category, obfuscated: Math.round(n * obf) };
}

test('stage s0 passes a modest real set that s1 rejects', () => {
  const s = statsFor(200, { perCat: 5 });
  assert.deepEqual(h.finalChecks(s, 's0'), []);
  assert.ok(h.finalChecks(s, 's1').length > 0);
});

test('stage s0 still enforces size, language floor, safe share and obfuscation share', () => {
  assert.ok(h.finalChecks(statsFor(150), 's0').some(p => /at least 200 rows/.test(p)));
  assert.ok(h.finalChecks(statsFor(200, { hi: 0.05, hinglish: 0.05 }), 's0').some(p => /language "hi"/.test(p)));
  assert.ok(h.finalChecks(statsFor(200, { safe: 0.1 }), 's0').some(p => /"safe" is under/.test(p)));
  assert.ok(h.finalChecks(statsFor(200, { obf: 0 }), 's0').some(p => /adversarial/.test(p)));
});

test('stage s1 enforces the language mix and per-category coverage; unknown stage is an error', () => {
  assert.deepEqual(h.finalChecks(statsFor(1000, { hi: 0.4, hinglish: 0.3 }), 's1'), []);
  assert.ok(h.finalChecks(statsFor(1000, { hi: 0.1, hinglish: 0.3 }), 's1').some(p => /language "hi"/.test(p)));
  assert.ok(h.finalChecks(statsFor(1000, { hi: 0.4, hinglish: 0.3, perCat: 3 }), 's1').some(p => /category/.test(p)));
  assert.ok(h.finalChecks(statsFor(10), 'nope')[0].includes('unknown stage'));
});
