'use strict';
// The three failure modes a security tool must not hide: a model that did not load, a camera frame too big for the phone, and a page that can talk to anyone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { loadPage, ROOT } = require('./helpers/dom.js');

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await sleep(25); } };
const transcript = doc => doc.getElementById('cbMessages').textContent;
const say = (doc, text) => { doc.getElementById('cbInput').value = text; doc.getElementById('cbSend').click(); };
const shipped = read('data/urlmodel.json');
const reply = (body, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => JSON.parse(body) });
const boot = (fetchImpl, extra = {}) => loadPage('assistant.html', { settle: 100, setup: w => { w.FraudShieldModelRetryMs = [5, 5, 5]; w.fetch = fetchImpl; Object.assign(w, extra); } });
const calm = p => p.errors.filter(e => !/domain-name check could not be loaded/.test(e));

test('model download fails every time: the page says so on the document, in the console and in the verdict, after retrying', async () => {
  let calls = 0; const p = await boot(async () => { calls++; throw new Error('network down'); });
  try {
    await until(() => p.window.FraudShieldModelState.status === 'failed');
    assert.equal(calls, 4, 'one try and three retries'); assert.equal(p.document.documentElement.getAttribute('data-name-model'), 'failed');
    assert.ok(p.errors.some(e => /domain-name check could not be loaded \(network down\)/.test(e)), 'it is loud in the console');
    say(p.document, 'https://random-shop.example.com/'); await until(() => /Never enter your OTP/.test(transcript(p.document)));
    assert.match(transcript(p.document), /the domain-name check could not load on this device, so this result uses the written rules only/);
    assert.doesNotMatch(transcript(p.document), /\bsafe\b/i, 'and even degraded, nothing is ever called safe');
    assert.deepEqual(calm(p), []);
  } finally { p.close(); }
});

test('a server error, a truncated file and a structurally damaged file are all refused, and none of them installs a half-model', async () => {
  const cases = { 'HTTP 503': async () => reply('{}', false), 'invalid JSON': async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } }),
    'missing weights': async () => { const m = JSON.parse(shipped); m.ngram.q = m.ngram.q.slice(0, 10); return reply(JSON.stringify(m)); }, 'NaN weight': async () => { const m = JSON.parse(shipped); m.eng[0] = null; return reply(JSON.stringify(m)); } };
  for (const [name, impl] of Object.entries(cases)) {
    const p = await boot(impl);
    try {
      await until(() => p.window.FraudShieldModelState.status === 'failed');
      assert.equal(p.window.FraudShieldUrlModel.current(), null, name + ': nothing was installed');
      assert.equal(p.window.FraudShieldLink.analyzeUrl('https://random-shop.example.com/').nameModel, 'not-loaded', name);
    } finally { p.close(); }
  }
});

test('a good download installs, says ready, and the verdict carries no warning; retry() recovers after a failure', async () => {
  let up = false; const p = await boot(async () => { if (!up) throw new Error('flaky 3G'); return reply(shipped); });
  try {
    await until(() => p.window.FraudShieldModelState.status === 'failed'); up = true; p.window.FraudShieldModelState.retry();
    await until(() => p.window.FraudShieldModelState.status === 'ready');
    assert.equal(p.document.documentElement.getAttribute('data-name-model'), 'ready'); assert.ok(p.window.FraudShieldUrlModel.current());
    say(p.document, 'https://random-shop.example.com/'); await until(() => /Never enter your OTP/.test(transcript(p.document)));
    assert.doesNotMatch(transcript(p.document), /domain-name check/);
  } finally { p.close(); }
});

test('a model that arrives late (slow network) is announced as loading, and the very same link is judged again once it is ready', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const p = await boot(async () => { await gate; return reply(shipped); });
  try {
    say(p.document, 'https://random-shop.example.com/'); await until(() => /Never enter your OTP/.test(transcript(p.document)));
    assert.match(transcript(p.document), /domain-name check is still loading/); release(); await until(() => p.window.FraudShieldModelState.status === 'ready');
  } finally { p.close(); }
});

/* ---------- the picture path ---------- */
const attach = (win, size = 32, type = 'image/png') => {
  const input = win.document.getElementById('cbFile');
  win.URL.createObjectURL = () => 'blob:t'; win.URL.revokeObjectURL = () => {};
  Object.defineProperty(input, 'files', { value: [new win.File([new Uint8Array(size)], 'p.png', { type })], configurable: true });
  input.dispatchEvent(new win.Event('change'));
};

test('a damaged or monstrous picture gets a plain answer and the reader is never started', async () => {
  for (const [code, re] of [['unreadable', /could not open that picture/], ['too-large', /over 150 megapixels/]]) {
    const p = await boot(async () => reply(shipped));
    try {
      let reader = 0; p.window.Tesseract = { createWorker: async () => ({ terminate: async () => {}, recognize: async () => { reader++; return { data: { text: '' } }; } }) };
      p.window.FraudShieldImagePrep.prepare = async () => { const e = new Error(code); e.code = code; throw e; };
      attach(p.window); await until(() => re.test(transcript(p.document))); assert.equal(reader, 0);
      p.window.FraudShieldImagePrep.prepare = async () => new p.window.Blob([new Uint8Array(4)]); p.window.FraudShieldQR.scan = async () => null; p.window.Tesseract = { createWorker: async () => ({ terminate: async () => {}, recognize: async () => ({ data: { text: '' } }) }) };
      attach(p.window); await until(() => /couldn't read clear text/.test(transcript(p.document)));   // the lock was released: the next picture is accepted
    } finally { p.close(); }
  }
});

test('one picture at a time, and a file over 25 MB is declined before anything is read', async () => {
  const p = await boot(async () => reply(shipped));
  try {
    let release; const gate = new Promise(r => { release = r; }); let prepares = 0;
    p.window.FraudShieldImagePrep.prepare = async () => { prepares++; await gate; return new p.window.Blob([new Uint8Array(4)]); };
    p.window.FraudShieldQR.scan = async () => null; p.window.Tesseract = { createWorker: async () => ({ terminate: async () => {}, recognize: async () => ({ data: { text: '' } }) }) };
    attach(p.window); attach(p.window);
    await until(() => /One picture at a time/.test(transcript(p.document))); assert.equal(prepares, 1); release();
    await until(() => /couldn't read clear text/.test(transcript(p.document)));
    attach(p.window, 26 * 1024 * 1024); await until(() => /over 25 MB/.test(transcript(p.document))); assert.equal(prepares, 1, 'the oversize file was never prepared');
  } finally { p.close(); }
});

test('the reader failing says what to do and logs why; it no longer claims an internet connection is needed (the reader is served from this site)', async () => {
  const p = await boot(async () => reply(shipped));
  try {
    p.window.FraudShieldImagePrep.prepare = async () => new p.window.Blob([new Uint8Array(4)]); p.window.FraudShieldQR.scan = async () => null;
    p.window.Tesseract = { createWorker: async () => ({ terminate: async () => {}, recognize: async () => { throw new Error('out of memory'); } }) };
    attach(p.window); await until(() => /image reader could not run on this device/.test(transcript(p.document)));
    assert.doesNotMatch(transcript(p.document), /internet connection/); assert.ok(p.errors.some(e => /text reader failed \(out of memory\)/.test(e)));
  } finally { p.close(); }
});
