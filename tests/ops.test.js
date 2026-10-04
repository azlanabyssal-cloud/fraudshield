'use strict';
// Observability that cannot leak: events are copies of named, enumerated fields; the summary says how the tool is doing; the page shows it and erases it on request.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const O = require('../lib/ops.js');
const L = require('../lib/linkcheck.js');
const M = require('../lib/msgcheck.js');
const { loadPage, ROOT } = require('./helpers/dom.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 9000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await sleep(25); } };
const T = Date.parse('2026-10-04T10:07:31Z');
const ALLOWED_KEYS = ['t', 'kind', 'level', 'family', 'rules', 'ms', 'nameModel', 'topic', 'code', 'hot'];
const memStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };

test('an event keeps only named fields with valid values, rounds the time to the minute, and drops everything else', () => {
  const e = O.clean({ kind: 'message', level: 'scam', family: 'kyc', rules: ['kyc', 'threat'], ms: 0.123456, nameModel: 'applied', text: 'my OTP is 123456', url: 'https://x', phone: '9876543210', hot: true, extra: { deep: 1 } }, T);
  assert.deepEqual(e, { t: Math.floor(T / 60000) * 60000, kind: 'message', level: 'scam', family: 'kyc', rules: ['kyc', 'threat'], ms: 0.12, nameModel: 'applied', hot: true });
  assert.equal(e.t % 60000, 0);
  for (const bad of [null, undefined, 5, 'x', [], {}, { kind: 'nope' }, { kind: 'MESSAGE' }, { level: 'scam' }]) assert.equal(O.clean(bad, T), null, JSON.stringify(bad));
  const odd = O.clean({ kind: 'link', level: 'catastrophic', family: 'Has Spaces', rules: ['ok-rule', 'UPPER', 'has space', 42, null, 'x'.repeat(40)], ms: -3, nameModel: 'maybe', topic: 7, code: '<script>' }, T);
  assert.deepEqual(odd, { t: odd.t, kind: 'link', rules: ['ok-rule'] }, 'invalid levels, slugs, numbers and states are dropped, not stored');
  assert.equal(O.clean({ kind: 'message', ms: NaN }, T).ms, undefined); assert.equal(O.clean({ kind: 'message', ms: Infinity }, T).ms, undefined); assert.equal(O.clean({ kind: 'message', ms: 9e9 }, T).ms, 600000);
  assert.equal(O.clean({ kind: 'message', rules: Array.from({ length: 40 }, (_, i) => 'r' + i) }, T).rules.length, 12, 'capped');
});

test('where the tool knows its own vocabulary, anything outside it is recorded as "other": a typed slug is still free text', () => {
  const known = { family: ['kyc'], rules: ['kyc', 'threat'], topic: ['block'], code: ['ocr-failed'] };
  const e = O.clean({ kind: 'message', family: 'my-password-is-hunter2', rules: ['kyc', 'card-number-4111', 'threat'], topic: 'secret-topic', code: 'whatever' }, T, known);
  assert.deepEqual([e.family, e.rules, e.topic, e.code], ['other', ['kyc', 'other', 'threat'], 'other', 'other']);
  assert.deepEqual(O.clean({ kind: 'message', family: 'kyc' }, T, known).family, 'kyc');
});

test('hostile input, 5,000 times over: nothing but allowed keys and allowed values ever reaches the buffer, the summary or the export', () => {
  let seed = 3; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296, pick = a => a[Math.floor(rnd() * a.length)];
  const junk = ['My OTP is 482913', 'call 9876543210', 'https://sbi-kyc-update.tk/login', 'a@b.com', 'Bhai tumhara account block ho gaya', 'x'.repeat(500), '', '<img src=x onerror=1>', "'; DROP TABLE", '‮', 'upi://pay?pa=a@b', 'kyc', 'scam', 123, null, true, {}, [], ['kyc', 'TEXT: secret']];
  const keys = ['kind', 'level', 'family', 'rules', 'ms', 'nameModel', 'topic', 'code', 'hot', 'text', 'url', 'message', 'quote', 'evidence', 'number', 'file', 'name'];
  const known = { family: ['kyc', 'otp'], rules: ['kyc', 'threat', 'link-scam'], topic: ['block', 'safe'], code: ['ocr-failed', 'other'] }, ops = O.createOps({ now: () => T, known, capacity: 100 });
  for (let i = 0; i < 5000; i++) { const ev = {}; for (let k = 0, n = 1 + Math.floor(rnd() * 8); k < n; k++) ev[pick(keys)] = pick(junk.concat(O.KINDS, O.LEVELS, 12.5, [pick(junk)])); ops.record(ev); }
  assert.ok(ops.size <= 100 && ops.size > 0);
  for (const e of ops.events) {
    for (const k of Object.keys(e)) assert.ok(ALLOWED_KEYS.includes(k), 'key ' + k);
    assert.ok(O.KINDS.includes(e.kind)); if (e.level) assert.ok(O.LEVELS.includes(e.level)); if (e.family) assert.ok([...known.family, 'other'].includes(e.family)); for (const r of e.rules || []) assert.ok([...known.rules, 'other'].includes(r)); if (e.topic) assert.ok([...known.topic, 'other'].includes(e.topic)); if (e.code) assert.ok([...known.code, 'other'].includes(e.code));
    if (e.ms !== undefined) assert.ok(typeof e.ms === 'number' && e.ms >= 0);
  }
  const out = JSON.stringify(ops.summary()) + JSON.stringify(ops.events); for (const needle of ['482913', '9876543210', 'sbi-kyc', 'a@b.com', 'tumhara', 'DROP TABLE', '<img', 'upi://', 'secret']) assert.ok(!out.includes(needle), 'leaked: ' + needle);
});

test('the buffer is a ring (oldest events fall off), survives a reload through storage, ignores damaged or foreign storage, and a storage that throws does not break recording', () => {
  const st = memStore(), a = O.createOps({ now: () => T, storage: st, capacity: 5 });
  for (let i = 0; i < 8; i++) a.record({ kind: 'message', level: 'scam', ms: i });
  assert.deepEqual(a.events.map(e => e.ms), [3, 4, 5, 6, 7], 'oldest dropped');
  const b = O.createOps({ now: () => T, storage: st, capacity: 5 }); assert.equal(b.size, 5, 'restored after a reload'); assert.equal(b.summary().byLevel.scam, 5);
  for (const bad of ['not json', '{"schema":99,"events":[]}', '{"schema":1,"events":"x"}', 'null', '{"schema":1,"events":[{"kind":"nope"},{"kind":"message","text":"leak"}]}']) { const s2 = memStore(); s2.setItem('fs_ops_v1', bad); const c = O.createOps({ now: () => T, storage: s2 }); assert.ok(c.size <= 1); assert.ok(!JSON.stringify(c.events).includes('leak')); }
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); } };
  const d = O.createOps({ now: () => T, storage: throwing }); assert.doesNotThrow(() => d.record({ kind: 'link', level: 'official' })); assert.equal(d.size, 1); assert.doesNotThrow(() => d.clear()); assert.equal(d.size, 0);
  a.clear(); assert.equal(a.size, 0); assert.equal(st.getItem('fs_ops_v1'), null, 'clear removes what was stored');
});

test('the summary counts correctly: levels, families, top rules (sorted, capped at ten), follow-ups, errors, name model, reader warmth, and the flagged share', () => {
  const ops = O.createOps({ now: () => T });
  for (const [level, family, rules] of [['scam', 'kyc', ['kyc', 'threat']], ['scam', 'kyc', ['kyc']], ['suspicious', 'otp', ['ask-secret']], ['nothing', null, []]]) ops.record({ kind: 'message', level, family, rules, ms: 0.5 });
  ops.record({ kind: 'link', level: 'unverified', nameModel: 'applied', ms: 0.2 }); ops.record({ kind: 'link', level: 'unverified', nameModel: 'not-loaded', ms: 0.2 }); ops.record({ kind: 'qr', level: 'unverified' });
  ops.record({ kind: 'ocr', ms: 400, hot: false }); ops.record({ kind: 'ocr', ms: 100, hot: true }); ops.record({ kind: 'ocr', ms: 120, hot: true });
  ops.record({ kind: 'followup', topic: 'block' }); ops.record({ kind: 'followup', topic: 'block' }); ops.record({ kind: 'followup', topic: 'safe' }); ops.record({ kind: 'error', code: 'ocr-failed' }); ops.record({ kind: 'model', code: 'model-failed' });
  const s = ops.summary({ model: 'ready' });
  assert.deepEqual(s.byLevel, { scam: 2, suspicious: 1, nothing: 1, unverified: 3 }); assert.deepEqual(s.byFamily, { kyc: 2, otp: 1 }); assert.equal(s.verdicts, 7); assert.equal(s.flaggedShare, 0.429);
  assert.deepEqual(s.topRules[0], { rule: 'kyc', count: 2 }); assert.deepEqual(s.followUps, { block: 2, safe: 1 }); assert.deepEqual(s.errors, { 'ocr-failed': 1, 'model-failed': 1 }); assert.deepEqual(s.nameModel, { applied: 1, 'not-loaded': 1 });
  assert.deepEqual(s.ocr, { runs: 3, hotShare: 0.667, p50Ms: 120 }); assert.equal(s.model, 'ready'); assert.equal(s.schema, 1); assert.match(s.note, /No message, link, number or file name/);
  const many = O.createOps({ now: () => T }); for (let i = 0; i < 15; i++) for (let j = 0; j <= i; j++) many.record({ kind: 'message', level: 'scam', rules: ['r' + String(i).padStart(2, '0')] });
  const top = many.summary().topRules; assert.equal(top.length, 10); assert.equal(top[0].rule, 'r14'); assert.ok(top.every((r, i) => i === 0 || top[i - 1].count >= r.count));
  assert.deepEqual(O.createOps({ now: () => T }).summary().byLevel, {}); assert.equal(O.createOps({ now: () => T }).summary().flaggedShare, null);
});

test('the service level: not judged on too few checks, met when the 95th percentile is within 50 ms, breached when it is not', () => {
  const run = values => { const o = O.createOps({ now: () => T }); values.forEach(ms => o.record({ kind: 'message', level: 'nothing', ms })); return o.summary(); };
  assert.equal(run([1, 2, 3]).slo.status, 'not-enough-data'); assert.equal(run([]).slo.status, 'not-enough-data');
  const fine = run(Array.from({ length: 100 }, (_, i) => 0.1 + i / 100)); assert.equal(fine.slo.status, 'met'); assert.ok(fine.latencyMs.p95 <= 1.1 && fine.latencyMs.max <= 1.1);
  const slow = run(Array.from({ length: 100 }, (_, i) => (i < 90 ? 5 : 80))); assert.equal(slow.slo.status, 'breached'); assert.equal(slow.latencyMs.p95, 80);
  const edge = run([...Array(96).fill(10), ...Array(4).fill(500)]); assert.equal(edge.slo.status, 'met', 'outliers within the top 5% do not breach a p95 target'); assert.equal(edge.latencyMs.max, 500);
  assert.equal(run([...Array(94).fill(10), ...Array(6).fill(500)]).slo.status, 'breached', 'six in a hundred is more than 5%');
});

test('every code the link and payment analyzers can emit is in the list the tool records against, so none is ever lost to "other"', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/linkcheck.js'), 'utf8'), found = new Set();
  for (const m of src.matchAll(/(?:flag\(|codes\.push\()\s*'([a-z-]+)'/g)) if (!m[1].endsWith('-')) found.add(m[1]);   // 'duplicate-' + key is built at run time; its two forms are listed
  for (const m of src.matchAll(/codes:\s*\[([^\]]*)\]/g)) for (const c of m[1].matchAll(/'([a-z-]+)'/g)) if (!c[1].endsWith('-')) found.add(c[1]);
  assert.ok(found.size >= 30, found.size + ' codes found in the source');
  for (const c of found) assert.ok(O.LINK_CODES.includes(c), `${c} is emitted but not in LINK_CODES`);
  const probes = ['https://sbi-kyc-update.tk/login', 'https://evil-shop.com/sbi/kyc-update', 'https://www.google.com/url?q=https://sbi-kyc-update.tk/', 'https://sbi.co.in\\@evil.com', 'upi://pay?pa=a@ybl&pa=b@ybl&am=1&am=2', 'upi://pay?pa=sbi.support.helpline@ybl&pn=SBI%20Support', 'paytmmp://pay?pa=refund@ybl', 'tel:+911234567890', 'smsto:123:hello', 'mailto:a@b.com', 'geo:1,2', 'WIFI:S:x;T:WPA;P:y;;', 'BEGIN:VCARD', 'javascript:alert(1)', 'bit.ly/3x', 'https://192.168.1.1/', 'ftp://x.y', '', 'hello world', '9876543210'];
  for (const p of probes) { const r = L.analyzePayload(p); for (const c of r.codes || []) assert.ok(O.LINK_CODES.includes(c) || !/^[a-z][a-z0-9-]{0,31}$/.test(c), `${c} from ${p}`); }
  const ids = M.RULES.map(r => r.id); assert.ok(ids.length >= 25 && ids.every(id => /^[a-z][a-z0-9-]{0,31}$/.test(id)), 'every message rule id is a valid slug');
});

/* ---------- on the page ---------- */
const say = (d, text) => { d.getElementById('cbInput').value = text; d.getElementById('cbSend').click(); };
async function quiet(d) { const log = () => d.getElementById('cbMessages').textContent; let last = log(), since = Date.now(); await until(() => { const n = log(); if (n !== last || d.querySelector('[data-cb-typing]')) { last = n; since = Date.now(); } return Date.now() - since > 1100; }, 25000); }
const ask = async (p, text) => { say(p.document, text); await sleep(150); await quiet(p.document); };

test('on the page, a verdict leaves an event with the facts and none of the text; the same holds for what is stored and what is copied', async () => {
  const p = await loadPage('assistant.html', { settle: 100 });
  try {
    const ops = p.window.FraudShieldOpsInstance; assert.ok(ops, 'the tool has an event buffer');
    await ask(p, 'ZXQPII98765 Dear customer your SBI account will be blocked today. Update KYC immediately: http://sbi-kyc-update.tk/login');
    const e = ops.events.find(x => x.kind === 'message'); assert.ok(e, 'a message event'); assert.equal(e.level, 'scam'); assert.equal(e.family, 'kyc'); assert.ok(e.rules.includes('kyc')); assert.ok(typeof e.ms === 'number' && e.ms >= 0 && e.ms < 50, 'latency measured: ' + e.ms);
    await ask(p, 'https://sbi-kyc-update.tk/login');
    const l = ops.events.find(x => x.kind === 'link'); assert.ok(l && l.level === 'scam' && l.rules.length >= 1 && ['applied', 'not-loaded', 'not-applicable'].includes(l.nameModel));
    await ask(p, 'How do I block this number?'); assert.ok(ops.events.some(x => x.kind === 'followup' && x.topic === 'block'));
    const stored = p.window.sessionStorage.getItem('fs_ops_v1') || '', everything = stored + JSON.stringify(ops.summary());
    for (const needle of ['ZXQPII98765', 'sbi-kyc-update', 'Dear customer', 'login']) assert.ok(!everything.includes(needle), 'leaked: ' + needle);
    assert.deepEqual(p.errors.filter(x => !/domain-name check/.test(x)), []);
  } finally { p.close(); }
});

test('the diagnostics panel on the assistant page shows the numbers, meets its own speed target, copies an anonymous summary, and erases everything on request', async () => {
  const p = await loadPage('assistant.html', { settle: 100, setup: w => { w.__copied = null; Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: t => { w.__copied = t; return Promise.resolve(); } }, configurable: true }); } });
  try {
    const d = p.document, panel = d.querySelector('.diag'); assert.ok(panel && panel.querySelector('details') && !panel.querySelector('details').open, 'a collapsed panel exists');
    for (let i = 0; i < 6; i++) await ask(p, i % 2 ? 'Your Zomato order will arrive in 20 minutes. The delivery partner will call you at the gate.' : 'Dear customer your SBI account will be blocked today. Update KYC immediately: http://sbi-kyc-update.tk/login');
    const details = panel.querySelector('details'); details.open = true; details.dispatchEvent(new p.window.Event('toggle'));
    const text = panel.textContent; assert.match(text, /Checks this session\s*6/); assert.match(text, /scam 3|scam\s*3/); assert.match(text, /Speed target\s*met/); assert.match(text, /Domain-name check/); assert.match(text, /never sent anywhere/);
    [...panel.querySelectorAll('button')].find(b => /Copy/.test(b.textContent)).click(); await until(() => p.window.__copied);
    const copied = JSON.parse(p.window.__copied); assert.equal(copied.schema, 1); assert.equal(copied.verdicts, 6); assert.equal(copied.slo.status, 'met'); assert.ok(!p.window.__copied.includes('sbi-kyc-update') && !p.window.__copied.includes('Zomato'));
    assert.ok(p.window.sessionStorage.getItem('fs_cb_state') && p.window.sessionStorage.getItem('fs_ops_v1')); p.window.localStorage.setItem('fs_voice_consent_v1', 'cloud');
    [...panel.querySelectorAll('button')].find(b => /Erase/.test(b.textContent)).click();
    assert.equal(p.window.sessionStorage.getItem('fs_cb_state'), null); assert.equal(p.window.sessionStorage.getItem('fs_ops_v1'), null); assert.equal(p.window.localStorage.getItem('fs_voice_consent_v1'), null); assert.equal(p.window.FraudShieldOpsInstance.size, 0);
    assert.match(panel.textContent, /Erased/);
  } finally { p.close(); }
});

test('observability can never break a verdict: if recording throws, the answer still arrives', async () => {
  const p = await loadPage('assistant.html', { settle: 100 });
  try { p.window.FraudShieldOpsInstance.record = () => { throw new Error('buffer exploded'); }; await ask(p, 'Dear customer your SBI account will be blocked today. Update KYC immediately: http://sbi-kyc-update.tk/login'); assert.match(p.document.getElementById('cbMessages').textContent, /looks like a fake KYC|warning signs/); } finally { p.close(); }
});

test('the first verdict is not the slow one: while the page is idle the lexicon is compiled and the checkers are exercised', async () => {
  const p = await loadPage('assistant.html', { settle: 100 });
  try {
    const H = p.window.FraudShieldHinglish; await until(() => H.compiledCount() === Object.keys(H.LEX).length, 6000);
    assert.equal(H.compiledCount(), Object.keys(H.LEX).length, 'every list was compiled before anyone asked');
    assert.ok(!p.window.FraudShieldOpsInstance.events.some(e => e.kind === 'message' || e.kind === 'link'), 'and the warm-up left no verdict events: it is not a verdict');
    assert.deepEqual(p.errors.filter(x => !/domain-name check/.test(x)), []);
  } finally { p.close(); }
});
