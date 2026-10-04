'use strict';
// The chat remembers its last verdict, so the question that comes next is answered about it; and the Hindi and Telugu wording works in the page, not only in Node.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const F = require('../lib/followup.js');
const M = require('../lib/msgcheck.js');
const { loadPage, ROOT } = require('./helpers/dom.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 9000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await sleep(25); } };
const say = (doc, text) => { doc.getElementById('cbInput').value = text; doc.getElementById('cbSend').click(); };
const log = doc => doc.getElementById('cbMessages').textContent;
// Sends a message and returns the transcript once the bot has finished: its lines arrive a moment apart, so wait until it has been quiet for a while.
const ask = async (p, text) => {
  const d = p.document, before = log(d); say(d, text); await until(() => log(d) !== before);
  let last = log(d), quietSince = Date.now();
  await until(() => { const now2 = log(d); if (now2 !== last || d.querySelector('[data-cb-typing]')) { last = now2; quietSince = Date.now(); } return Date.now() - quietSince > 1100; }, 20000);
  return log(d);
};
const now = Date.now();

test('follow-up questions are recognised in English, Hinglish and Hindi, and only when they are short questions of a known kind', () => {
  const want = { 'How do I block this number?': 'block', 'number kaise block kare': 'block', 'Is it safe?': 'safe', 'Should I click it?': 'safe', 'kya ye sach hai': 'safe', 'what should I do now': 'what', 'kya karu ab': 'what', 'where do I report this': 'report',
    'I already clicked the link': 'paid', 'maine OTP de diya': 'paid', 'how to get my money back': 'recover', 'paise wapas kaise milenge': 'recover', 'why do you think so': 'why', 'should I keep the screenshot': 'evidence', 'who sent this': 'who' };
  for (const [text, topic] of Object.entries(want)) assert.equal(F.topicOf(text), topic, text);
  for (const none of ['Hi', 'thanks', '', '   ', null, undefined, 'What is a digital arrest scam and how does it work in India today when they call you on video and say you are under arrest', 'tell me about UPI']) assert.equal(F.topicOf(none), null, String(none));
});

test('a verdict is the topic for an hour; the memory keeps only what was on screen, capped', () => {
  const last = F.remember({ kind: 'message', level: 'scam', family: 'kyc', headline: 'x'.repeat(500), evidence: [1, 2, 3, 4, 5].map(i => ({ quote: 'q'.repeat(200), label: 'l'.repeat(500), secret: 'NOT STORED' + i })) }, now);
  assert.equal(last.evidence.length, 3); assert.ok(last.headline.length <= 240 && last.evidence[0].quote.length <= 80 && last.evidence[0].label.length <= 220); assert.ok(!JSON.stringify(last).includes('NOT STORED'));
  assert.ok(F.isFresh(last, now + 59 * 60 * 1000)); assert.ok(!F.isFresh(last, now + 61 * 60 * 1000)); assert.ok(!F.isFresh(last, now - 1000), 'a clock that went backwards is not fresh'); assert.ok(!F.isFresh(null, now)); assert.ok(!F.isFresh({}, now));
  assert.equal(F.route('how do I block this?', last, M.FAMILIES, now + 61 * 60 * 1000), null); assert.equal(F.route('how do I block this?', null, M.FAMILIES, now), null);
});

test('"is it safe?" never gets a yes: a flagged message gets a no, anything else gets "I cannot call it safe"; every topic has an answer with steps that work', () => {
  const lastOf = level => ({ kind: 'message', level, family: level === 'nothing' ? null : 'kyc', headline: 'This looks like a fake KYC or account-block message.', evidence: [{ quote: 'kyc … update', label: 'It says KYC must be updated now.' }], at: now });
  for (const level of ['scam', 'suspicious']) assert.match(F.reply('safe', lastOf(level), M.FAMILIES).lines[0], /^No\. Treat it as unsafe/);
  for (const level of ['unverified', 'nothing']) { const r = F.reply('safe', lastOf(level), M.FAMILIES).lines.join(' '); assert.match(r, /cannot call it safe/); assert.doesNotMatch(r, /\b(?:it is|it's|is) safe\b/i); }
  for (const topic of F.TOPICS.map(t => t[0])) for (const level of ['scam', 'suspicious', 'unverified', 'nothing']) {
    const r = F.reply(topic, lastOf(level), M.FAMILIES); assert.ok(r.lines.length >= 1 && r.lines.every(l => typeof l === 'string' && l.length > 10), `${topic}/${level}`); assert.ok(r.options.length >= 1 && r.options.every(o => ['call1930', 'report', 'menu', 'loss', 'steps'].includes(o)));
  }
  assert.match(F.reply('block', lastOf('scam'), M.FAMILIES).lines.join(' '), /1930/); assert.match(F.reply('why', lastOf('scam'), M.FAMILIES).lines.join(' '), /"kyc … update"/);
  assert.match(F.reply('what', { ...lastOf('scam'), family: 'arrest' }, M.FAMILIES).lines.join(' '), /digital arrest|Hang up/i, 'the advice is the verdict\'s own for that kind of scam');
});

test('after a scam verdict, "How do I block this number?" is answered about that scam, and "Is it safe?" is a no', async () => {
  const p = await loadPage('assistant.html', { settle: 100 });
  try {
    await ask(p, 'Dear customer your SBI account will be blocked today. Update KYC immediately: http://sbi-kyc-update.tk/login');
    const blocked = await ask(p, 'How do I block this number?'); assert.match(blocked, /Blocking helps a little/); assert.match(blocked, /1930/); assert.doesNotMatch(blocked, /couldn't quite match/);
    const safe = await ask(p, 'Is it safe?'); assert.match(safe, /No\. Treat it as unsafe/);
    const why = await ask(p, 'why do you think so'); assert.match(why, /This is what I went on/);
    assert.equal(JSON.parse(p.window.sessionStorage.getItem('fs_cb_state')).last.level, 'scam', 'answering a question does not change what the chat remembers');
    assert.deepEqual(p.errors.filter(e => !/domain-name check/.test(e)), []);
  } finally { p.close(); }
});

test('after a message with no known pattern, "Is it safe?" says it cannot call it safe', async () => {
  const p = await loadPage('assistant.html', { settle: 100 });
  try {
    await ask(p, 'Your electricity bill of Rs 1450 is due on 12 October. You can pay it at the official portal or in the app.');
    const safe = await ask(p, 'is it safe?'); assert.match(safe, /cannot call it safe/); assert.doesNotMatch(safe, /No\. Treat it as unsafe/);
  } finally { p.close(); }
});

test('a new message is still scanned as a message, even right after a verdict; no memory means the old behaviour; an old memory is ignored', async () => {
  const p = await loadPage('assistant.html', { settle: 100 });
  try {
    await ask(p, 'Dear customer your SBI account will be blocked today. Update KYC immediately: http://sbi-kyc-update.tk/login');
    const fresh = await ask(p, 'Share your OTP now to block your account today'); assert.match(fresh, /OTP|warning signs|looks like/i); assert.doesNotMatch(fresh.split('Share your OTP now to block your account today')[1] || '', /Blocking helps a little/);
  } finally { p.close(); }
  const none = await loadPage('assistant.html', { settle: 100 });
  try { const r = await ask(none, 'Is it safe?'); assert.doesNotMatch(r, /No\. Treat it as unsafe|cannot call it safe/, 'nothing to be safe about yet'); } finally { none.close(); }
  const stale = await loadPage('assistant.html', { settle: 100, setup: w => w.sessionStorage.setItem('fs_cb_state', JSON.stringify({ flow: null, node: null, awaitingLink: false, voiceOut: false, voiceLang: 'en-IN', userName: null, log: [],
    last: { kind: 'message', level: 'scam', family: 'kyc', intent: 'Phishing', headline: 'old', evidence: [], at: Date.now() - 3 * 3600 * 1000 } })) });
  try { const r = await ask(stale, 'How do I block this number?'); assert.doesNotMatch(r, /Blocking helps a little/, 'a verdict from three hours ago is not the topic'); } finally { stale.close(); }
});

test('"I already clicked" after a verdict goes to the loss steps, and a link verdict is remembered too', async () => {
  const p = await loadPage('assistant.html', { settle: 100 });
  try {
    await ask(p, 'https://sbi-kyc-update.tk/login');
    assert.equal(JSON.parse(p.window.sessionStorage.getItem('fs_cb_state')).last.kind, 'url');
    const r = await ask(p, 'I already clicked the link'); assert.match(r, /first hour/i);
  } finally { p.close(); }
});

test('the review\'s own Hinglish message is caught in the page itself: the lexicon is loaded before the checker on every page', async () => {
  for (const page of ['index', 'tips', 'data', 'assistant', 'report', 'about']) {
    const html = fs.readFileSync(path.join(ROOT, page + '.html'), 'utf8'), h = html.indexOf('lib/hinglish.js'), m = html.indexOf('lib/msgcheck.js'), f = html.indexOf('lib/followup.js');
    assert.ok(h > 0 && m > h && f > m, `${page}: hinglish.js, then msgcheck.js, then followup.js`);
  }
  const p = await loadPage('assistant.html', { settle: 100 });
  try {
    assert.ok(p.window.FraudShieldHinglish && p.window.FraudShieldFollowUp, 'both modules are present in the browser');
    const r = await ask(p, 'Bhai tumhara account block ho gaya hai, KYC update karo is link pe.');
    assert.match(r, /warning signs of a fake KYC/); assert.match(r, /What gave it away/); assert.doesNotMatch(r.split('is link pe.')[1], /found no known scam pattern/);
  } finally { p.close(); }
});
