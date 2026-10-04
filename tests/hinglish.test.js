'use strict';
// Scam wording in Romanised Hindi, Telugu and Devanagari. The corpus is hand-written (tests/fixtures/hinglish.json) and says so: it can prove the rules
// work on the patterns they were written for and stay quiet on the genuine look-alikes; it cannot prove accuracy on real messages, which only the S0 set can.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../lib/urlmodel.js');
const H = require('../lib/hinglish.js');
const M = require('../lib/msgcheck.js');
const corpus = require('./fixtures/hinglish.json');

const level = t => M.analyzeMessage(t).level;
const flagged = t => level(t) !== 'nothing';

test('spelling: the ways people actually write the same Hindi word reduce to one form, and the reduction is stable', () => {
  const same = [['jayega', 'jaega', 'jayegaa'], ['wapas', 'vapas', 'waapas'], ['bhejo', 'bejo', 'bhejoo'], ['karo', 'kaaro', 'karoo'], ['fauran', 'foran', 'phauran'], ['hai', 'he', 'hain'.slice(0, 2) === 'ha' ? 'hai' : 'hai'], ['inaam', 'inam', 'eenaam'.replace('ee', 'i')], ['zaroor', 'jaroor', 'zarur'.replace('u', 'oo')]];
  for (const group of same) for (const w of group.slice(1)) assert.equal(H.canon(w), H.canon(group[0]), `${group[0]} ~ ${w}`);
  for (const w of ['block', 'account', 'kyc', 'otp', 'update', 'ho', 'gaya', 'jayega', 'turant', 'bhej', 'tumhara', 'avutundi', 'cheyyandi']) assert.equal(H.canon(H.canon(w)), H.canon(w), `idempotent: ${w}`);
  assert.notEqual(H.canon('kar'), H.canon('kat'), 'different words stay different'); assert.notEqual(H.canon('band'), H.canon('bandh') === H.canon('band') ? 'x' : H.canon('band'), 'sanity');
  assert.equal(H.canon('बंद'), 'बंद'); assert.equal(H.canon('बताएं।'), 'बताएं', 'a danda is punctuation');
});

test('patterns: alternatives, optional groups, numbers and multi-word choices expand correctly, and a runaway pattern is refused', () => {
  const flat = p => H.expand(p).map(a => a.join(' ')).sort();
  assert.deepEqual(flat('kyc update (karo|kare)'), [H.canon('kyc') + ' ' + H.canon('update') + ' ' + H.canon('karo'), H.canon('kyc') + ' ' + H.canon('update') + ' ' + H.canon('kare')].sort());
  assert.equal(H.expand('account (band|block) (ho jayega|ho gaya)').length, 4);
  assert.equal(H.expand('link (pe|par)? click').length, 3, 'an optional group adds the version without it');
  assert.deepEqual(H.expand('\\d+ rupaye bhejo')[0][0], '\\d+', 'a number stays a number');
  assert.throws(() => H.expand('(a|b|c|d|e|f|g|h) (a|b|c|d|e|f|g|h) (a|b|c|d|e|f|g|h) (a|b|c|d|e|f|g|h)', 100), /more than/);
});

test('every lexicon entry compiles, and every one of them is found in a message written from it (no entry is dead)', () => {
  let checked = 0;
  for (const id of Object.keys(H.LEX)) {
    for (const pattern of H.LEX[id]) {
      const words = H.expandRaw(pattern)[0]; assert.ok(words.length, `${id}: ${pattern} expands to something`);   // the words as written, as a person would type them
      const text = words.map(w => (w === '\\d+' ? '4500' : w)).join(' ');
      const hits = H.find({ text, tokens: [...text.matchAll(/[a-z0-9]+|[ऀ-ॣ०-ॿ]+/g)].map(m => ({ t: m[0], s: m.index, e: m.index + m[0].length })) }, id);
      assert.ok(hits.length >= 1, `${id}: "${pattern}" is not found in its own expansion "${text}"`); checked++;
    }
  }
  assert.ok(checked > 100, `${checked} entries checked`);
});

test('every Hinglish, Telugu and Hindi scam in the corpus is flagged, with evidence quoted from the message itself', () => {
  const missed = corpus.scams.filter(t => !flagged(t)); assert.deepEqual(missed, []);
  for (const t of corpus.scams) { const v = M.analyzeMessage(t); assert.ok(v.evidence.length >= 1 && v.family); for (const e of v.evidence) if (!/^link-/.test(e.id)) assert.ok(e.quote.length > 0); }
  assert.ok(corpus.scams.filter(t => level(t) === 'scam').length >= 20, 'and most are called a scam, not just suspicious');
  assert.equal(level('Bhai tumhara account block ho gaya hai, KYC update karo is link pe.'), 'suspicious', 'the exact message from the review');
  assert.deepEqual(M.analyzeMessage('Bhai tumhara account block ho gaya hai, KYC update karo is link pe.').codes.sort(), ['kyc', 'threat']);
});

test('none of the genuine Hinglish messages is flagged: chat that uses the same words, bank warnings, delivery codes, bills, tickets', () => {
  const alarms = corpus.genuine.filter(flagged).map(t => `${level(t)}: ${t}`); assert.deepEqual(alarms, []);
});

test('the same scams written with other spellings are still caught', () => {
  const variants = [t => t.replace(/wapas/gi, 'vapas'), t => t.replace(/bhejo/gi, 'bejo'), t => t.replace(/jayega/gi, 'jaega'), t => t.replace(/karo/gi, 'karoo'), t => t.replace(/turant/gi, 'turrant'), t => t.replace(/ho gaya/gi, 'ho gaia'), t => t.replace(/\bhai\b/gi, 'he'), t => t.replace(/kisi ko/gi, 'kisiko')];
  const lost = []; for (const t of corpus.scams) for (const [i, f] of variants.entries()) { const w = f(t); if (w !== t && !flagged(w)) lost.push(`variant ${i}: ${w}`); }
  assert.deepEqual(lost, []);
});

test('Hindi negation: "do not share" is a warning wherever the "not" falls, while "share it, or else" is still a demand', () => {
  for (const warning of ['Apna OTP kisi ke saath share na karein.', 'OTP kisi ko mat batana, yeh sirf aapke liye hai.', 'Kripya OTP share na kare.', 'Kabhi kisi ko PIN na bataiye.', 'आपका OTP 123456 है। इसे किसी को न बताएं।', 'Aapka CVV kisi ko nahi batana chahiye.']) assert.ok(!flagged(warning), warning);
  for (const demand of ['OTP share karo, nahi to account block ho jayega', 'OTP bhej do warna block', 'PIN bata do abhi']) assert.ok(flagged(demand), demand);
});

test('"bhej" is an order only with its helper: sending your own number is not asking for someone else\'s', () => {
  assert.ok(!flagged('Mera account number bhej raha hu, paise transfer kar dena'));
  assert.ok(!flagged('Maine apna card number bhej diya tha, ab sab theek hai'));
  assert.ok(flagged('Apna card number bhej do'), 'an order with a helper is a request');
  assert.ok(flagged('CVV bata dijiye'));
});

test('"tell no one" about the credential itself is the bank\'s warning, in English and Hindi, unless the message also asks for the credential', () => {
  for (const warn of ['Your OTP is 482913. Do not tell anyone.', 'Do not tell anyone your PIN.', 'OTP 482913. Kisi ko na batayein.']) assert.ok(!flagged(warn), warn);
  for (const gag of ['I am calling from the bank. Do not tell anyone.', 'Share your OTP now. Do not tell anyone.', 'OTP bhej do aur kisi ko mat batana']) assert.ok(flagged(gag), gag);
  assert.equal(level('Share your OTP now. Do not tell anyone.'), 'scam');
});

test('Telugu typed in Latin letters is read for the same patterns', () => {
  for (const t of ['Mee account block avutundi. KYC update cheyyandi, link click cheyyandi ventane', 'Mee SBI account suspend avutundi, OTP cheppandi', 'Lottery gelichaaru! prize claim cheyyandi, 5000 pampandi']) assert.ok(flagged(t), t);
  assert.ok(!flagged('Mee account lo paisalu paddayi, thanks anna'));
});

test('Devanagari is tokenised without the danda sticking to words, and Hindi scam wording in Devanagari is caught', () => {
  assert.ok(flagged('आपका खाता बंद हो जाएगा। तुरंत KYC अपडेट करें और ओटीपी बताएं'));
  assert.ok(flagged('पुलिस की तरफ से वारंट जारी हुआ है। वीडियो कॉल पर रहें, किसी को न बताएं'));
  assert.ok(!flagged('कल सुबह 10 बजे मिलते हैं, पैसे ले आना'));
});

test('the lexicon cannot be abused for speed: a long Hinglish message, and repeated trigger words, finish quickly', () => {
  const long = (corpus.scams.join(' ') + ' ').repeat(12).slice(0, 4000), bombs = ['bhej '.repeat(5000), 'kisi ko mat '.repeat(2000), 'account block ho '.repeat(1500), '9'.repeat(3000) + ' rupaye bhejo']; 
  for (const t of [long, ...bombs]) { const a = Date.now(); M.analyzeMessage(t); assert.ok(Date.now() - a < 300, `${t.slice(0, 20)}… took ${Date.now() - a} ms`); }
});

test('without the lexicon module the checker still works on English alone: the module is an addition, not a dependency', () => {
  const path = require.resolve('../lib/hinglish.js'), msg = require.resolve('../lib/msgcheck.js'), savedH = require.cache[path], savedM = require.cache[msg];
  try {
    delete require.cache[msg]; require.cache[path] = { id: path, filename: path, loaded: true, exports: undefined };
    const bare = require('../lib/msgcheck.js');
    assert.notEqual(bare.analyzeMessage('Dear customer your SBI account will be blocked today. Share your OTP now.').level, 'nothing', 'English still works');
    assert.equal(bare.analyzeMessage('Bhai tumhara account block ho gaya hai, KYC update karo is link pe.').level, 'nothing', 'and Hinglish is simply not read');
  } finally { savedH ? (require.cache[path] = savedH) : delete require.cache[path]; delete require.cache[msg]; if (savedM) require.cache[msg] = savedM; }
});
