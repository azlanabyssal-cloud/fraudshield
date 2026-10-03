'use strict';
// All personal-looking strings below are fabricated for testing. They are never written to data_ops/.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const h = require('../data_ops/holdout.js');
const { scrub, maskTerms, suggestLanguage, suggestObfuscation, classifyDigits } = require('../data_ops/scrub.js');
const { buildRow, nextId } = require('../data_ops/row_builder.js');

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const KNOWN = /\[(?:PHONE|UPI|EMAIL|ACCOUNT|ID_NUMBER|PAN|HANDLE|CARD|OTP)\]/g;

test('known answer: every kind of personal token is replaced and everything else is untouched', () => {
  const t = 'Dear customer your SBI a/c XXXX1234 will be blocked. Call +91 98765 43210 or 1800 123 4567 now, UPI 98765xxxxx@paytm, mail help.desk@sbi-kyc.com. OTP is 482913, pay Rs 1,00,000 at sbi-kyc-update.com/login?x=1. PAN ABCDE1234F. p@nding K Y C 🙏 कृपया';
  const r = scrub(t);
  assert.equal(r.text, 'Dear customer your SBI a/c [ACCOUNT] will be blocked. Call [PHONE] or [PHONE] now, UPI [UPI], mail [EMAIL]. OTP is [OTP], pay Rs 1,00,000 at sbi-kyc-update.com/login?x=1. PAN [PAN]. p@nding K Y C 🙏 कृपया');
  assert.deepEqual(r.replaced, { OTP: 1, UPI: 1, EMAIL: 1, PAN: 1, ACCOUNT: 1, PHONE: 2 }); assert.deepEqual(r.residual, []);
});

test('signal is preserved byte for byte: obfuscation, short public codes, amounts, URLs, Devanagari, odd spacing', () => {
  for (const t of ['Pay Rs 1,00,000 to avoid arrest. Call 1930 or 112 or 181 or 155260.', 'p@nding K Y C u.p.i bl0cked 0TP', '₹5,000 जीता है! अभी claim करें: bit.ly/x1y2',
    'Visit sbi-kyc-update.com/login?id=ab12 today 12/10/2025', 'a  double  space\ttab\nnew line', 'OTP expires in 10 minutes', 'Do not share your OTP with anyone', 'zero​width', '🚨🚨 URGENT 🚨🚨']) {
    assert.equal(scrub(t).text, t, JSON.stringify(t));
  }
});

test('property: PII injected in many formats is always masked, surrounding text and punctuation never change, and scrubbing is idempotent', () => {
  const rnd = mulberry32(2028), pick = a => a[Math.floor(rnd() * a.length)], digits = n => Array.from({ length: n }, () => Math.floor(rnd() * 10)).join('');
  const mobile = () => pick(['6', '7', '8', '9']) + digits(9), alnum = n => Array.from({ length: n }, () => pick('abcdefghijklmnopqrstuvwxyz0123456789'.split(''))).join('');
  const suffixes = [...h.UPI_SUFFIXES], letters = n => Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(rnd() * 26))).join('');
  const makers = [
    () => mobile(), () => { const m = mobile(); return `${m.slice(0, 5)} ${m.slice(5)}`; }, () => { const m = mobile(); return `${m.slice(0, 5)}-${m.slice(5)}`; },
    () => `+91 ${mobile()}`, () => { const m = mobile(); return `+91-${m.slice(0, 5)}-${m.slice(5)}`; }, () => `0${mobile()}`, () => `91${mobile()}`, () => `1800 ${digits(3)} ${digits(4)}`,
    () => `${digits(1 + Math.floor(rnd() * 8))}${letters(2).toLowerCase()}@${pick(suffixes)}`, () => `${alnum(4)}.${alnum(5)}@${pick(['okicici', 'ybl', 'paytm', 'oksbi'])}`, () => `${digits(10)}@${pick(suffixes)}`,
    () => `${alnum(4)}.${alnum(3)}@gmail.com`, () => `${alnum(4)}_${alnum(3)}@${alnum(5)}.co.in`, () => `@${alnum(6)}_${digits(2)}`,
    () => `${letters(5)}${digits(4)}${letters(1)}`, () => `${digits(4)} ${digits(4)} ${digits(4)}`, () => `${digits(4)} ${digits(4)} ${digits(4)} ${digits(4)}`, () => `${digits(4)}-${digits(4)}-${digits(4)}-${digits(4)}`,
    () => digits(11 + Math.floor(rnd() * 8)), () => `XXXX${digits(4)}`, () => `xxxxxx${digits(3)}`
  ];
  const words = 'your account will be blocked today please verify now urgent bank customer care reply to this message immediately'.split(' ');
  for (let i = 0; i < 600; i++) {
    const segs = [], exp = [];
    for (let k = 0; k < 2 + Math.floor(rnd() * 4); k++) {
      for (let w = 0; w < 1 + Math.floor(rnd() * 3); w++) { const x = pick(words); segs.push(x); exp.push(x); }
      const item = pick(makers)(), punct = pick(['', '', '.', ',', '!', ')']);
      segs.push(item + punct); exp.push('<ITEM>' + punct);
    }
    const msg = segs.join(' '), r = scrub(msg);
    assert.deepEqual(r.residual, [], `validator still flags: ${msg} -> ${r.text}`);
    assert.equal(r.text.replace(KNOWN, '<ITEM>'), exp.join(' '), `surroundings changed: ${msg} -> ${r.text}`);
    assert.equal(scrub(r.text).text, r.text, 'not idempotent');
  }
});

test('one-time codes: digits right after the code word are masked, other numbers in the sentence are not', () => {
  assert.equal(scrub('OTP is 482913. Valid 10 minutes.').text, 'OTP is [OTP]. Valid 10 minutes.');
  assert.equal(scrub('Your one-time password: 7731 do not share').text, 'Your one-time password: [OTP] do not share');
  assert.equal(scrub('आपका OTP 123456 है').text, 'आपका OTP [OTP] है');
  for (const t of ['OTP expires in 10 minutes', 'Your OTP is valid for 300 seconds only', 'OTP will expire in 1200 seconds, request again', 'never share OTP, call 1930 within 120 minutes']) assert.equal(scrub(t).text, t);
});

test('an email or UPI id at the end of a sentence keeps the full stop', () => {
  assert.equal(scrub('write to help@bank-care.com.').text, 'write to [EMAIL].');
  assert.equal(scrub('pay to shop1@ybl.').text, 'pay to [UPI].');
});

test('digit classification table', () => {
  const cases = { '9876543210': 'PHONE', '+91 98765 43210': 'PHONE', '919876543210': 'PHONE', '09876543210': 'PHONE', '011-23456789': 'PHONE', '1800 123 4567': 'PHONE',
    '1234 5678 9012': 'ID_NUMBER', '4111 1111 1111 1111': 'CARD', '123456789012345': 'CARD', '12345678901': 'ACCOUNT', '1234567890123456789': 'ACCOUNT' };
  for (const [raw, kind] of Object.entries(cases)) assert.equal(classifyDigits(raw), kind, raw);
});

test('maskTerms: case-insensitive, regex characters are literal, tiny terms and bad placeholders are refused', () => {
  assert.deepEqual(maskTerms('Rahul Sharma ji, RAHUL SHARMA from Pune', ['rahul sharma'], 'NAME'), { text: '[NAME] ji, [NAME] from Pune', count: 2 });
  assert.equal(maskTerms('flat axb and a.b', ['a.b'], 'ADDRESS').text, 'flat axb and [ADDRESS]');
  assert.throws(() => maskTerms('x', ['a'], 'NAME'), RangeError);
  assert.throws(() => maskTerms('x', ['ab'], 'PHONE'), RangeError);
  assert.equal(maskTerms('nothing here', ['', '  '], 'NAME').count, 0);
});

test('suggestions: language and obfuscation (the labeler still decides)', () => {
  assert.equal(suggestLanguage('Your account is blocked'), 'en'); assert.equal(suggestLanguage('आपका खाता बंद हो जाएगा, तुरंत संपर्क करें'), 'hi');
  assert.equal(suggestLanguage('Aapka account band ho jayega, kripya turant call karo'), 'hinglish'); assert.equal(suggestLanguage('कृपया update your KYC'), 'hinglish');
  assert.equal(suggestObfuscation('your K Y C is p@nding'), true); assert.equal(suggestObfuscation('zero​width'), true);
  assert.equal(suggestObfuscation('Your account is blocked, call 1930.'), false);
});

/* ---------- row building ---------- */
const TODAY = '2026-10-03';
const base = { text: 'Your SBI KYC is pending, call [PHONE] now.', language: 'en', isScam: true, category: 'kyc_pan_block', source: 'sms', date: '2026-09-30', obfuscated: false };

test('buildRow: ids are sequential, gaps are never reused, and a valid row round-trips through the validator', () => {
  const a = buildRow(base, '', { today: TODAY });
  assert.deepEqual(a.errors, []); assert.equal(a.id, 'GH-0001');
  const csv = h.COLUMNS.join(',') + '\n' + a.line + '\n';
  const b = buildRow({ ...base, text: 'Electricity will be cut tonight, pay now at power-bill-help.com' , category: 'electricity_disconnect' }, csv, { today: TODAY });
  assert.deepEqual(b.errors, []); assert.equal(b.id, 'GH-0002');
  assert.equal(nextId([h.COLUMNS, ['GH-0007']]), 'GH-0008');
});

test('buildRow refuses duplicates, bad fields, a future date and an already-invalid file; genuine rows are forced to category safe', () => {
  const csv = h.COLUMNS.join(',') + '\n' + buildRow(base, '', { today: TODAY }).line + '\n';
  assert.match(buildRow({ ...base, text: 'Your SBI KYC is pending, call [UPI] now.' }, csv, { today: TODAY }).errors.join(' '), /duplicate/);
  assert.ok(buildRow({ ...base, text: 'another message long enough', category: 'nonsense' }, csv, { today: TODAY }).errors.length);
  assert.match(buildRow({ ...base, text: 'another message long enough', date: '2026-12-31' }, csv, { today: TODAY }).errors.join(' '), /not in the future/);
  assert.match(buildRow(base, 'wrong,header\n1,2\n', { today: TODAY }).errors[0], /already invalid/);
  const genuine = buildRow({ ...base, text: 'Your OTP for login is [OTP]. Do not share it.', isScam: false, category: 'kyc_pan_block' }, '', { today: TODAY });
  assert.deepEqual(genuine.errors, []); assert.equal(h.parseCsv(genuine.line)[0][4], 'safe');
});

/* ---------- CLI (piped answers) ---------- */
const cli = (answers, file) => spawnSync(process.execPath, [path.join(__dirname, '..', 'data_ops', 'add_message.js'), '--file', file], { input: answers, encoding: 'utf8' });
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fs-add-')), 'golden.csv');

test('CLI: adds a scrubbed, validated row, never echoes the original, and creates the file with a header', () => {
  const file = tmp();
  const r = cli('Call +91 98765 43210 about your SBI KYC. OTP is 482913. Rahul Sharma will verify.\n\nRahul Sharma\n\ny\nen\ny\nkyc_pan_block\nsms\n2026-09-30\nn\n', file);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes('98765') && !r.stdout.includes('482913') && !r.stdout.includes('Rahul'), 'the original must never be printed back');
  const rows = h.parseCsv(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(rows[0], h.COLUMNS); assert.equal(rows[1][1], 'Call [PHONE] about your SBI KYC. OTP is [OTP]. [NAME] will verify.'); assert.equal(rows[1][0], 'GH-0001');
  assert.deepEqual(h.validateRows(rows, { today: TODAY }).errors, []);
});

test('CLI: refuses and writes nothing for a non-real message, for unsafe leftovers, and for input that ends early', () => {
  const file = tmp();
  assert.equal(cli('Real looking text here for you\n\n\n\nn\n', file).status, 1);
  assert.equal(cli('Message with an unknown [SECRET] placeholder\n\n\n\ny\n', file).status, 1);   // validator flags it, scrubber cannot fix it
  assert.equal(cli('Half a message and then the input stops', file).status, 1);
  assert.ok(!fs.existsSync(file), 'no file may be created on an aborted run');
});

test('the validator flags text glued to a placeholder (a half-masked token), and the scrubber never produces one', () => {
  assert.ok(h.findPii('ref [HANDLE]_63 today').length); assert.ok(h.findPii('call [PHONE]12 now').length);
  assert.deepEqual(h.findPii('call [PHONE] now, or [UPI].'), []);
  assert.equal(scrub('dm @wy7udc_63 now').text, 'dm [HANDLE] now'); assert.equal(scrub('follow @some.one_99.').text, 'follow [HANDLE].');
});
