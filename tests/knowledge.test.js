'use strict';
// What the assistant knows (lib/knowledge.js) and when it stops listening for the rest of a sentence (lib/utterance.js).
// The question sets in tests/fixtures/chat_questions.json are written by the author, so they measure coverage and false answers on realistic phrasings, not accuracy on strangers; see BENCHMARKS.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const K = require('../lib/knowledge.js');
const U = require('../lib/utterance.js');
const { CHAT_INTENT_KEYWORDS } = require('../lib/core.js');
const M = require('../lib/msgcheck.js');
const Q = require('./fixtures/chat_questions.json');
const ROOT = path.join(__dirname, '..');

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

test('every entry is complete: unique id, known topic, a question button, patterns, a written answer, and follow-ups and flows that exist', () => {
  const ids = K.ENTRIES.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  assert.ok(ids.length >= 40);
  for (const e of K.ENTRIES) {
    assert.match(e.id, /^[a-z][a-z_]+$/, e.id);
    assert.ok(['tool', 'scam', 'official'].includes(e.topic), e.id);
    assert.ok(/\?$/.test(e.q) && e.q.length < 70, `${e.id}: the button asks a short question`);
    assert.ok(Array.isArray(e.m) && e.m.length >= 1 && e.m.every(p => Array.isArray(p) && p.length >= 1 && p.every(g => typeof g === 'string' && g.length > 0)), `${e.id}: patterns`);
    assert.ok(Array.isArray(e.a) && e.a.length >= 1 && e.a.length <= 3 && e.a.every(l => typeof l === 'string' && l.length > 20 && l.length < 700), `${e.id}: answer lines`);
    for (const r of e.rel || []) assert.ok(K.byId(r) && r !== e.id, `${e.id}: related ${r} exists`);
    if (e.flow) assert.ok(Object.prototype.hasOwnProperty.call(CHAT_INTENT_KEYWORDS, e.flow), `${e.id}: flow ${e.flow} is a real guided flow`);
    assert.ok(fs.existsSync(path.join(ROOT, e.src)), `${e.id}: its source ${e.src} exists`);
  }
});

test('links go somewhere real: a phone number of the national helplines, a page of this site that exists, or this project on GitHub', () => {
  for (const e of K.ENTRIES) for (const l of e.links || []) {
    assert.ok(l.label && l.label.length < 60, `${e.id}: ${l.label}`);
    if (/^tel:/.test(l.href)) assert.ok(['tel:1930', 'tel:112'].includes(l.href), `${e.id}: ${l.href}`);
    else if (/^https:/.test(l.href)) assert.ok(l.href.startsWith(K.REPO), `${e.id}: ${l.href}`);
    else assert.ok(fs.existsSync(path.join(ROOT, l.href)), `${e.id}: ${l.href} exists`);
  }
});

test('the answers keep the tool\'s promises: no accuracy figure, no "safe" verdict, no "guarantee", no claim the privacy page does not make, and the helplines are the real ones', () => {
  const all = K.ENTRIES.map(e => e.a.join(' '));
  for (const [i, a] of all.entries()) {
    assert.doesNotMatch(a, /\b\d{2,3}\s?%/, `${K.ENTRIES[i].id}: no percentage`);
    assert.doesNotMatch(a, /\b(?:100|99)\b/, K.ENTRIES[i].id);
    assert.doesNotMatch(a, /\bwe\b|\bour (?:team|servers?)\b/i, `${K.ENTRIES[i].id}: one person built it, so not "we"`);
    for (const n of a.match(/\b\d{3,4}\b/g) || []) assert.ok(['1930', '112'].includes(n), `${K.ENTRIES[i].id}: number ${n}`);
  }
  const accuracy = K.byId('accuracy').a.join(' ');
  assert.match(accuracy, /cannot give an accuracy figure/); assert.match(accuracy, /never say a message is safe/);
  assert.match(K.byId('privacy').a.join(' '), /refuses to send it to any other server/);
  assert.match(K.byId('why_not_safe').a.join(' '), /not the same as "it is genuine"/);
  assert.match(K.byId('government').a.join(' '), /^No\./);
  assert.match(K.byId('money_back').a.join(' '), /cannot promise/);
  assert.match(K.byId('one_nine_three_zero').a.join(' '), /National Cyber Crime Helpline/);
  assert.match(K.byId('emergency').a.join(' '), /112/);
});

test('every question button asks something that the assistant then answers with that same entry, so no suggestion is a dead end', () => {
  for (const e of K.ENTRIES) { const r = K.route(e.q); assert.ok(r, `${e.id}: "${e.q}" is answered`); assert.equal(r.entry.id, e.id, `"${e.q}" -> ${r.entry.id}`); }
});

function score(set) {
  const res = { n: set.length, ok: 0, wrong: [], miss: [], falseAnswers: [], negatives: 0 };
  for (const { q, id } of set) {
    const r = K.route(q), got = r ? r.entry.id : null;
    if (!id) res.negatives++;
    if (got === id) res.ok++; else if (!id) res.falseAnswers.push(`${q} -> ${got}`); else if (!got) res.miss.push(q); else res.wrong.push(`${q} -> ${got} (wanted ${id})`);
  }
  return res;
}
test('coverage on the three labelled question sets: a floor that cannot slip, and not one false answer to a question the tool should not answer', () => {
  // probe: what a hostile run against the live page turned up (written after the failures); dev: used while writing; heldout: first run 153/192 before any change; fresh: first run 161/185 before any change. The floors below are after tuning, so they guard regressions; they are not generalisation figures.
  const floors = { dev: { ok: 196, wrong: 0 }, heldout: { ok: 185, wrong: 1 }, fresh: { ok: 183, wrong: 0 }, probe: { ok: 22, wrong: 0 } };
  for (const name of ['dev', 'heldout', 'fresh', 'probe']) {
    const r = score(Q[name]);
    assert.ok(r.ok >= floors[name].ok, `${name}: ${r.ok}/${r.n} correct (floor ${floors[name].ok}); wrong: ${r.wrong.join(' | ')}; unanswered: ${r.miss.join(' | ')}`);
    assert.ok(r.wrong.length <= floors[name].wrong, `${name}: wrong answers ${r.wrong.join(' | ')}`);
    assert.deepEqual(r.falseAnswers, [], `${name}: answered what it should not`);
    if (name === 'heldout' || name === 'fresh') assert.ok(r.negatives >= 20, `${name}: has out-of-scope questions`);
  }
  const all = [...Q.dev, ...Q.heldout, ...Q.fresh, ...Q.probe]; assert.equal(new Set(all.map(x => x.q.toLowerCase())).size, all.length, 'no question appears in two sets');
});

test('the labelled sets cover every entry, and no set is only easy questions: Hindi, Hinglish and Devanagari are in there', () => {
  const covered = new Set([...Q.dev, ...Q.heldout, ...Q.fresh, ...Q.probe].map(x => x.id).filter(Boolean));
  for (const e of K.ENTRIES) assert.ok(covered.has(e.id), `${e.id} has labelled questions`);
  const text = [...Q.dev, ...Q.heldout, ...Q.fresh, ...Q.probe].map(x => x.q).join(' ');
  assert.match(text, /\bkya\b/); assert.match(text, /[ऀ-ॿ]/); assert.match(text, /\bkaise\b/);
});

test('a pasted message is not a question: statements that mention the official routes are left to the message checker', () => {
  const pasted = ['Your electricity bill of Rs 1450 is due on 12 October. You can pay it at the official portal or in the app.',
    'Rs 2,000.00 debited from A/c XX1234 on 03-Oct-26 to VPA shop@oksbi. If not you, call 1930 or your bank.',
    'Dear customer, your parcel is held at customs. Pay the fee on the official courier website to release the parcel today.',
    'Your OTP for the transaction is 482913. Do not share this code with anyone. The bank will never ask for it.',
    'Congratulations, your number has been selected in the lucky draw. Claim your prize now by calling the official helpline.'];
  for (const t of pasted) { assert.equal(K.askable(t), false, t); assert.equal(K.route(t), null, t); }
  for (const t of ['I got a call from my bank asking for the OTP', 'my sim stopped working', 'they asked me to install anydesk']) assert.equal(K.askable(t), true, t);
  for (const t of ['1930', 'otp scam', 'phishing', 'is it free', 'kya yeh free hai']) assert.equal(K.askable(t), true, t);
  for (const t of ['fedex parcel scam how does it work', 'kyc update scam how does it work', 'will i get my money back', 'data safe hai kya', 'is it safe?', 'umm so what is this app for']) assert.equal(K.isQuestion(t), true, t);
  for (const t of ['Your bill is due and you can pay it online', 'call 1930 if you did not make this payment']) assert.equal(K.isQuestion(t), false, t);
  // and the message checker's own sample scams never reach it as questions
  for (const s of M.SAMPLES || []) assert.equal(K.route(s.text || String(s)), null);
});

test('a text longer than a question is never answered, however many known words it contains', () => {
  const long = 'what is phishing and how does it work and who made this and is it free and can it work offline and is my data safe and how accurate are you'; 
  assert.ok(K.tokens(long).length > K.MAX_TOKENS); assert.equal(K.route(long), null);
  assert.equal(K.route('phishing '.repeat(300)), null); assert.equal(K.route(''), null); assert.equal(K.route('   '), null); assert.equal(K.route(null), null); assert.equal(K.route(undefined), null); assert.equal(K.route('?!?!'), null);
});

test('spelling does not decide: Hinglish typed any way, texting forms, case, punctuation and Devanagari reach the same answer', () => {
  const same = [['kya yeh free hai', 'kia ye free hai', 'KYA YEH FREE HAI??', 'kya ye free hai'], ['what is the purpose of this website', 'wat is the purpose of this website', 'WHAT is the PURPOSE of this website?!'], ['can u tell me who made this', 'can you tell me who made this'], ['paise wapas milenge kya', 'pese vapas milenge kya', 'paisa wapas milega kya']];
  for (const group of same) { const ids = group.map(q => (K.route(q) || {}).entry && K.route(q).entry.id); assert.ok(ids[0], group[0]); assert.deepEqual([...new Set(ids)], [ids[0]], group.join(' / ')); }
  assert.equal(K.route('इसे किसने बनाया').entry.id, 'who_made');
  assert.equal(K.route('मकसद क्या है इसका').entry.id, 'purpose');
});

test('short words are matched exactly, so "toll" is not "tool" and "ai" is not "e"; and a word of a pattern cannot be reused by another group of the same pattern', () => {
  assert.notEqual((K.route('can i trust the toll free number from search') || { entry: {} }).entry.id, 'accuracy');
  assert.equal(K.route('is the helpline number i found online real').entry.id, 'fake_support');
  assert.equal(K.route('what is the main purpose of fraudshield').entry.id, 'purpose', 'one word may not satisfy two groups');
  const t = K.explain('what is the main purpose of fraudshield', 'purpose'); assert.ok(t.length >= 1 && t.every(x => x.score > 0 && x.words.length >= 1));
});

test('a rare word outweighs common ones, and a question made only of common words is not answered', () => {
  assert.equal(K.route('is teamviewer safe to install for a bank call').entry.id, 'remote_access', 'teamviewer outweighs bank and call');
  for (const q of ['what is the', 'how do i', 'is it', 'can you', 'what what what', 'and or but', 'the the the the']) assert.equal(K.route(q), null, q);
});

test('out-of-scope questions get nothing, and "nothing" comes with suggestions that are real questions the tool answers', () => {
  for (const q of ['what is the capital of france', 'tell me a joke', 'how do i reset my instagram password', 'tell me about the history of india', 'what is the price of bitcoin', 'what is machine learning', 'hi', 'thanks', 'how are you', 'good morning', 'what is your name', 'ok']) assert.equal(K.route(q), null, q);
  for (const q of ['what is the capital of france', 'asdf qwer', 'phishing but not really', '', 'otp', 'kyc money']) {
    const s = K.suggest(q, 3); assert.equal(s.length, 3, q); assert.equal(new Set(s.map(e => e.id)).size, 3, q);
    for (const e of s) assert.equal(K.route(e.q).entry.id, e.id, `${q}: suggestion "${e.q}" is answerable`);
  }
  assert.deepEqual(K.suggest('zzzz', 3).map(e => e.id), K.STARTERS, 'gibberish gets the starter set');
  assert.ok(K.suggest('otp kyc money', 3).some(e => /otp|kyc/i.test(e.id)), 'a partial match suggests the nearest topics first');
});

test('routing is a pure function: the same text gives the same entry, and hostile input never throws', () => {
  const rnd = mulberry32(20261005), vocab = K.ENTRIES.flatMap(e => e.m.flat().flatMap(g => g.split('|'))).map(a => a.replace(/\*$/, '').replace(/_/g, ' ')).filter(Boolean);
  const junk = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'prototype', '\u0000', '‮', 'क्', '😀', 'ﬁ', 'ǅ', '\ud800', '..', '--', '.-.', 'a.b.c', "o'neil", 'ÀÉÎ', '١٢٣', 'x'.repeat(5000)];
  const seen = new Map();
  for (let i = 0; i < 3000; i++) {
    const n = 1 + Math.floor(rnd() * 30), parts = [];
    for (let j = 0; j < n; j++) parts.push(rnd() < 0.2 ? junk[Math.floor(rnd() * junk.length)] : vocab[Math.floor(rnd() * vocab.length)]);
    const text = parts.join(rnd() < 0.5 ? ' ' : '  ?, ');
    const a = K.route(text), b = K.route(text);
    assert.equal(a ? a.entry.id : null, b ? b.entry.id : null);
    if (a) { assert.ok(K.byId(a.entry.id) && Number.isFinite(a.score) && a.score > 0); assert.ok(a.alternatives.length <= 3 && a.alternatives.every(e => e.id !== a.entry.id)); }
    K.suggest(text, 3); K.isQuestion(text); K.askable(text); seen.set(a ? a.entry.id : null, 1);
  }
  assert.ok(seen.size > 10, 'the fuzz reached many different entries as well as nothing');
  for (const word of junk.slice(0, 7)) { K.route(word); K.route('what is ' + word); K.route(word + ' is free'); }
  const t0 = Date.now(); K.route('what is '.repeat(100000)); assert.ok(Date.now() - t0 < 500, 'a very long text is rejected quickly');
});

test('a cut-off sentence is recognised and a finished one is not', () => {
  const cut = ['What is the main purpose of', 'I got a call from', 'what is the main purpose of the', 'is it free for', 'what is the', 'tell me about', 'is it free for', 'I got a call and,', 'what is this...', 'mera data aur', 'मेरा पैसा का', 'um', 'what', 'how do i report a scam and', 'is my data safe with'];
  const whole = ['What is the main purpose of FraudShield', 'what is this', 'is my data safe', 'mera data safe hai kya', 'otp kisi ko na batana', 'how do i report a scam', 'what is 1930', 'who made this', 'is it free', 'kya yeh free hai', 'money left my account', 'hello', 'thanks', 'मेरा पैसा गया', 'can you help me', 'is it a bot', 'what do you do', 'what is this for', 'what is it about', 'who made this for', 'what do you use it for', 'what is the app for', 'what should i do', 'what can i do', 'is it safe or not', 'you never say its genuine why', 'what to do'];
  for (const t of cut) assert.equal(U.isIncomplete(t), true, t);
  for (const t of whole) assert.equal(U.isIncomplete(t), false, t);
  for (const t of ['', '   ', null, undefined, 42, {}, [], '\u0000', '😀', '...']) { const r = U.isIncomplete(t); assert.equal(typeof r, 'boolean'); }
  assert.equal(U.isIncomplete('...'), true);
  assert.ok(U.TRAILING.size > 60);
  for (const w of ['this', 'it', 'that', 'you', 'me', 'kya', 'hai', 'do', 'not', 'why']) assert.equal(U.TRAILING.has(w), false, `"${w}" can end a sentence`);
});
