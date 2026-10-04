'use strict';
// The assistant's three long-running resources, held to account with fakes: the speech queue (never hand the engine more than one short chunk,
// never wait on an event that may not come), the text-reading worker (start once, reuse, end cleanly, never reuse a failed one) and the
// screen-reader log (never read by two voices at once).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const S = require('../lib/speech.js');
const O = require('../lib/ocrworker.js');
const { loadPage, ROOT } = require('./helpers/dom.js');

const tick = () => new Promise(r => setImmediate(r));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await sleep(20); } };

/* ---------- speech: the text ---------- */
test('speech text: emoji and web addresses are not read out, sentences split at . ! ? and the Hindi danda, and dots inside words are left alone', () => {
  assert.equal(S.cleanForSpeech('🚫 Scam! See https://evil.tk/x?y=1 now ✅'), 'Scam! See a link now');
  assert.equal(S.cleanForSpeech('• one\n• two'), 'one. two');
  assert.deepEqual(S.chunk('🚫 This looks like a scam link. Check cybercrime.gov.in or call 1930! Rs 1.5 lakh gone? '), ['This looks like a scam link.', 'Check cybercrime.gov.in or call 1930!', 'Rs 1.5 lakh gone?']);
  assert.deepEqual(S.chunk('आपका खाता बंद हो जाएगा। तुरंत KYC अपडेट करें।'), ['आपका खाता बंद हो जाएगा।', 'तुरंत KYC अपडेट करें।']);
  assert.deepEqual(S.chunk('Really?! Yes.'), ['Really?!', 'Yes.']); assert.deepEqual(S.chunk(''), []); assert.deepEqual(S.chunk(null), []); assert.deepEqual(S.chunk('🚫 ✅ ...'), []);
});

test('speech chunks: none is longer than the limit, long sentences are cut at a comma or a space, and across thousands of random texts no letter is lost, repeated or reordered', () => {
  let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296, pick = a => a[Math.floor(rnd() * a.length)];
  const words = ['scam', 'cybercrime.gov.in', '1930', 'Rs', '1.5', 'lakh', 'अपडेट', 'KYC', 'call', 'your', 'bank', 'OTP', 'a'.repeat(30), 'x'.repeat(200), '🚫', '"quoted"', '•'], ends = ['.', '!', '?', '।', ',', ';', ':', '', ' —'];
  for (let n = 0; n < 4000; n++) {
    let text = ''; for (let i = 0, k = 1 + Math.floor(rnd() * 60); i < k; i++) text += pick(words) + pick(ends) + (rnd() < 0.15 ? '\n' : ' ');
    const parts = S.chunk(text, 160), letters = s => (S.cleanForSpeech(s).match(/[\p{L}\p{N}\p{M}]/gu) || []).join('');   // a word longer than a chunk with no space has to be cut; every letter must survive, in order
    for (const p of parts) assert.ok(p.length <= 160 || !/\s/.test(p), `chunk of ${p.length}: ${p.slice(0, 40)}`);
    assert.equal(parts.map(letters).join(''), letters(text), 'nothing lost or reordered');
  }
});

/* ---------- speech: the queue ---------- */
function rig({ voice = { name: 'Veena', lang: 'en-IN', localService: true }, speaking = false } = {}) {
  const log = { spoken: [], cancels: 0 }, timers = [];
  const synth = { speaking, pending: false, speak(u) { log.spoken.push(u); }, cancel() { log.cancels++; this.speaking = false; } };
  class Utterance { constructor(t) { this.text = t; } }
  const setTimeoutF = (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; }, clearTimeoutF = t => { if (t) t.live = false; };
  const speaker = S.createSpeaker({ synth, Utterance, pickVoice: () => voice, setTimeout: setTimeoutF, clearTimeout: clearTimeoutF, rate: 0.95 });
  const fire = (u, ev) => u[ev === 'end' ? 'onend' : 'onerror']();
  const live = () => timers.filter(t => t.live);
  const run = t => { t.live = false; t.fn(); };
  return { speaker, synth, log, timers, fire, live, run };
}

test('the engine is given one chunk at a time, and the next only when the last has ended', () => {
  const r = rig(); assert.equal(r.speaker.say('First sentence. Second sentence. Third one!'), 3);
  assert.equal(r.log.spoken.length, 1, 'only the first chunk is with the engine'); assert.equal(r.log.spoken[0].text, 'First sentence.');
  r.fire(r.log.spoken[0], 'end'); assert.equal(r.log.spoken.length, 2); assert.equal(r.log.spoken[1].text, 'Second sentence.');
  r.fire(r.log.spoken[1], 'end'); r.fire(r.log.spoken[2], 'end'); assert.equal(r.log.spoken.length, 3); assert.equal(r.speaker.busy, false);
  assert.ok(r.log.spoken.every(u => u.voice.name === 'Veena' && u.lang === 'en-IN' && u.rate === 0.95));
});

test('lines arriving while it is speaking join the end of the queue; they never reach the engine early', () => {
  const r = rig(); r.speaker.say('One. Two.'); r.speaker.say('Three.'); r.speaker.say('Four.');
  assert.equal(r.log.spoken.length, 1); assert.equal(r.speaker.pending, 3);
  for (let i = 0; i < 4; i++) r.fire(r.log.spoken[i], 'end');
  assert.deepEqual(r.log.spoken.map(u => u.text), ['One.', 'Two.', 'Three.', 'Four.']);
});

test('the playing utterance is held by the speaker, so it cannot be garbage-collected before its end event', () => {
  const r = rig(); r.speaker.say('Hold me.'); assert.equal(r.speaker.current, r.log.spoken[0]); r.fire(r.log.spoken[0], 'end'); assert.equal(r.speaker.current, null);
});

test('an utterance that never reports back is cut off by the watchdog and the queue carries on; one that ends in time is not disturbed', () => {
  const r = rig(); r.speaker.say('This one hangs. This one is fine.');
  const dog = r.live()[0]; assert.ok(dog.ms >= 2500, 'it waits for the expected length plus a margin');
  r.run(dog); assert.equal(r.log.cancels, 1, 'the stuck chunk is cancelled'); assert.equal(r.log.spoken.length, 1, 'the next chunk waits a moment after the cancel');
  const after = r.live().find(t => t.ms === 40); assert.ok(after, 'speak() after cancel() is delayed so it is not dropped'); r.run(after); assert.equal(r.log.spoken.length, 2); assert.equal(r.log.spoken[1].text, 'This one is fine.');
  const before = r.log.cancels; r.fire(r.log.spoken[1], 'end'); r.live().forEach(t => r.run(t)); assert.equal(r.log.cancels, before, 'a chunk that ended in time is never cancelled');
});

test('an error event moves on exactly like an end event, and a late event from a stopped queue is ignored', () => {
  const r = rig(); r.speaker.say('A. B.'); r.fire(r.log.spoken[0], 'error'); assert.equal(r.log.spoken[1].text, 'B.');
  const old = r.log.spoken[1]; r.speaker.stop(); assert.equal(r.speaker.busy, false); r.speaker.say('New.'); const fresh = r.log.spoken[r.log.spoken.length - 1]; assert.equal(fresh.text, 'New.');
  const n = r.log.spoken.length; r.fire(old, 'end'); assert.equal(r.log.spoken.length, n, 'the old utterance finishing late does not advance the new queue'); assert.equal(r.speaker.current, fresh);
});

test('whenIdle fires after the last chunk, at once when nothing is playing, and when the queue is stopped', () => {
  const r = rig(); let a = 0, b = 0, c = 0; r.speaker.whenIdle(() => a++); assert.equal(a, 1);
  r.speaker.say('One. Two.'); r.speaker.whenIdle(() => b++); r.fire(r.log.spoken[0], 'end'); assert.equal(b, 0); r.fire(r.log.spoken[1], 'end'); assert.equal(b, 1);
  r.speaker.say('Three.'); r.speaker.whenIdle(() => c++); r.speaker.stop(); assert.equal(c, 1);
});

test('an engine found speaking with nothing of ours playing is cancelled first; with no on-device voice it stays silent and still settles', () => {
  const r = rig({ speaking: true }); r.speaker.say('Hello there.'); assert.equal(r.log.cancels, 1); r.run(r.live().find(t => t.ms === 40)); assert.equal(r.log.spoken.length, 1);
  const q = rig({ voice: null }); let idle = 0; q.speaker.say('Anything.'); q.speaker.whenIdle(() => idle++); assert.equal(q.log.spoken.length, 0, 'text is never sent to a network voice'); assert.equal(idle, 1); assert.equal(q.speaker.busy, false);
  assert.equal(r.speaker.say(''), 0); assert.equal(r.speaker.say('🚫'), 0);
});

/* ---------- the text-reading worker ---------- */
function ocrRig({ failFirst = false, idleMs = 120000 } = {}) {
  const log = { created: 0, terminated: 0, reads: [], concurrent: 0, maxConcurrent: 0, loads: 0 }, timers = [];
  const gate = { fn: null };
  const T = { createWorker: async (langs, oem, options) => {
    log.created++; log.lastOptions = { langs, oem, options }; const id = log.created;
    return { id, terminate: async () => { log.terminated++; },
      recognize: async img => { log.concurrent++; log.maxConcurrent = Math.max(log.maxConcurrent, log.concurrent); options.logger({ status: 'recognizing text', progress: 0.5, worker: id });
        try { if (gate.fn) await gate.fn(); if (failFirst && log.reads.length === 0) { log.reads.push('fail'); throw new Error('out of memory'); } log.reads.push(img); return { data: { text: 'read ' + img, worker: id } }; } finally { log.concurrent--; } } };
  } };
  const setT = (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; }, clearT = t => { if (t) t.live = false; };
  const ocr = O.createOcr({ load: async () => { log.loads++; return T; }, langs: 'eng+hin', idleMs, options: { workerPath: 'w.js', corePath: 'c/', langPath: 'l/' }, setTimeout: setT, clearTimeout: clearT });
  return { ocr, log, timers, gate, liveTimers: () => timers.filter(t => t.live) };
}

test('three pictures in a row start the engine once, in the right mode with the site-local files, and keep it hot', async () => {
  const r = ocrRig(); const a = await r.ocr.recognize('a'), b = await r.ocr.recognize('b'), c = await r.ocr.recognize('c');
  assert.equal(r.log.created, 1); assert.equal(r.ocr.starts, 1); assert.equal(r.log.terminated, 0, 'not terminated between pictures'); assert.equal(r.log.loads, 1);
  assert.deepEqual([a.data.worker, b.data.worker, c.data.worker], [1, 1, 1]); assert.equal(r.log.lastOptions.langs, 'eng+hin'); assert.equal(r.log.lastOptions.oem, O.LSTM_ONLY);
  assert.deepEqual([r.log.lastOptions.options.workerPath, r.log.lastOptions.options.corePath, r.log.lastOptions.options.langPath], ['w.js', 'c/', 'l/']); assert.equal(r.ocr.hot, true);
});

test('pictures are read one at a time through the single engine, never two at once', async () => {
  const r = ocrRig(); let release; r.gate.fn = () => new Promise(res => { release = res; });
  const p1 = r.ocr.recognize('a'), p2 = r.ocr.recognize('b'); await until(() => r.log.concurrent === 1); await sleep(30); assert.equal(r.log.concurrent, 1, 'the second waits');
  r.gate.fn = null; release(); await Promise.all([p1, p2]); assert.equal(r.log.maxConcurrent, 1); assert.deepEqual(r.log.reads, ['a', 'b']); assert.equal(r.log.created, 1);
});

test('progress goes to the picture being read and to nobody else, and a progress callback that throws cannot break a read', async () => {
  const r = ocrRig(), seen = []; await r.ocr.recognize('a', m => seen.push(['a', m.progress])); await r.ocr.recognize('b', () => { throw new Error('ui bug'); });
  const c = await r.ocr.recognize('c'); assert.deepEqual(seen, [['a', 0.5]]); assert.match(c.data.text, /read c/);
});

test('a read that fails ends that engine at once, and the next picture gets a fresh one', async () => {
  const r = ocrRig({ failFirst: true }); await assert.rejects(r.ocr.recognize('a'), /out of memory/);
  assert.equal(r.log.terminated, 1); assert.equal(r.ocr.hot, false); const ok = await r.ocr.recognize('b'); assert.equal(r.log.created, 2); assert.equal(ok.data.worker, 2);
});

test('an engine that fails to start can be retried, and an engine nobody uses is ended after the idle time', async () => {
  const log = { n: 0 }; const o = O.createOcr({ load: async () => { log.n++; if (log.n === 1) throw new Error('script missing'); return { createWorker: async () => ({ recognize: async () => ({ data: { text: 'ok' } }), terminate: async () => { log.t = (log.t || 0) + 1; } }) }; }, idleMs: 0 });
  await assert.rejects(o.recognize('a'), /script missing/); assert.equal(o.hot, false); assert.equal((await o.recognize('b')).data.text, 'ok');
  const r = ocrRig(); await r.ocr.recognize('a'); const idle = r.liveTimers(); assert.equal(idle.length, 1); assert.equal(idle[0].ms, 120000);
  idle[0].fn(); await tick(); await tick(); assert.equal(r.log.terminated, 1); assert.equal(r.ocr.hot, false); await r.ocr.recognize('b'); assert.equal(r.log.created, 2, 'used again after idling out: a new engine');
});

test('using the engine again restarts the idle clock; release() waits for a read in progress; warm() starts it early and it still idles out', async () => {
  const r = ocrRig(); await r.ocr.recognize('a'); const first = r.liveTimers()[0]; await r.ocr.recognize('b'); assert.equal(first.live, false, 'the old idle timer is cleared'); assert.equal(r.liveTimers().length, 1);
  const q = ocrRig(); let release; q.gate.fn = () => new Promise(res => { release = res; }); const read = q.ocr.recognize('a'); await until(() => q.log.concurrent === 1);
  const rel = q.ocr.release(); await sleep(20); assert.equal(q.log.terminated, 0, 'not killed mid-read'); q.gate.fn = null; release(); await read; await rel; assert.equal(q.log.terminated, 1);
  const w = ocrRig(); w.ocr.warm(); await until(() => w.ocr.hot && w.log.created === 1); await tick(); assert.equal(w.liveTimers().length, 1, 'an unused warm engine idles out'); await w.ocr.recognize('a'); assert.equal(w.log.created, 1, 'the first picture used the warm engine');
});

/* ---------- the page: wiring, and the screen-reader log ---------- */
const voices = [{ name: 'Veena', lang: 'en-IN', localService: true }];
const speechSetup = w => {
  w.__spoken = []; w.__cancels = 0;
  w.speechSynthesis = { getVoices: () => voices, speak(u) { w.__spoken.push(u); }, cancel() { w.__cancels++; }, onvoiceschanged: null, addEventListener() {}, speaking: false, pending: false };
};
const say = (doc, text) => { doc.getElementById('cbInput').value = text; doc.getElementById('cbSend').click(); };

test('screen reader and spoken replies never run together: turning spoken replies on silences the log, off brings it back, and a status line says which', async () => {
  const p = await loadPage('assistant.html', { settle: 100, setup: speechSetup });
  try {
    const d = p.document, log = d.getElementById('cbMessages'), btn = d.getElementById('cbVoiceToggle'), note = log.nextElementSibling;
    assert.equal(log.getAttribute('aria-live'), 'polite'); assert.equal(btn.getAttribute('aria-pressed'), 'false'); assert.equal(note.getAttribute('role'), 'status'); assert.ok(note.classList.contains('sr-only'));
    for (let i = 0; i < 6; i++) {
      btn.click(); const on = i % 2 === 0;
      assert.equal(btn.getAttribute('aria-pressed'), String(on)); assert.equal(log.getAttribute('aria-live'), on ? 'off' : 'polite', 'never both at once');
      assert.match(note.textContent, on ? /screen reader will not read them out a second time/ : /announced by your screen reader/);
    }
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('a remembered "spoken replies on" is honoured on load: the log starts silent to screen readers', async () => {
  const p = await loadPage('assistant.html', { settle: 100, setup: w => { speechSetup(w); w.sessionStorage.setItem('fs_cb_state', JSON.stringify({ flow: null, node: null, awaitingLink: false, voiceOut: true, voiceLang: 'en-IN', userName: null, log: [] })); } });
  try { assert.equal(p.document.getElementById('cbMessages').getAttribute('aria-live'), 'off'); assert.equal(p.document.getElementById('cbVoiceToggle').getAttribute('aria-pressed'), 'true'); } finally { p.close(); }
});

test('where the browser cannot speak at all, the button is hidden, spoken replies are off, and the log stays announced', async () => {
  const p = await loadPage('assistant.html', { settle: 100, setup: w => { w.sessionStorage.setItem('fs_cb_state', JSON.stringify({ flow: null, node: null, awaitingLink: false, voiceOut: true, voiceLang: 'en-IN', userName: null, log: [] })); Object.defineProperty(w, 'speechSynthesis', { value: undefined, configurable: true }); } });
  try { assert.equal(p.document.getElementById('cbVoiceToggle').hidden, true); assert.equal(p.document.getElementById('cbMessages').getAttribute('aria-live'), 'polite'); } finally { p.close(); }
});

test('spoken replies go through the queue: several bot lines reach the engine one chunk at a time, and switching off stops the speaker', async () => {
  const p = await loadPage('assistant.html', { settle: 100, setup: speechSetup });
  try {
    const d = p.document; d.getElementById('cbVoiceToggle').click();
    say(d, 'https://sbi-kyc-update.tk/login'); await until(() => /Never enter your OTP/.test(d.getElementById('cbMessages').textContent), 9000);
    assert.equal(p.window.__spoken.length, 1, 'many lines and many sentences, one chunk with the engine'); assert.ok(p.window.__spoken[0].text.length <= 160); assert.ok(!/\p{Extended_Pictographic}|https?:/u.test(p.window.__spoken[0].text), 'no emoji or web address is read out');
    const before = p.window.__cancels; d.getElementById('cbVoiceToggle').click(); assert.ok(p.window.__cancels > before, 'turning it off cancels what is playing');
  } finally { p.close(); }
});

test('the text reader is reused across pictures, and its progress is announced once, not on every percent', async () => {
  const p = await loadPage('assistant.html', { settle: 100, setup: w => { speechSetup(w); w.__made = 0; } });
  try {
    const d = p.document; let progressNode = null, opts = null, release;
    p.window.FraudShieldQR.scan = async () => null; p.window.FraudShieldQR.inspect = async () => ({ text: null, structure: { qr: false, certainty: null } });
    p.window.FraudShieldImagePrep.prepare = async () => new p.window.Blob([new Uint8Array(4)]);
    p.window.URL.createObjectURL = () => 'blob:t'; p.window.URL.revokeObjectURL = () => {};
    p.window.Tesseract = { createWorker: async (l, o, options) => { p.window.__made++; opts = options; return { terminate: async () => {}, recognize: async () => { progressNode = d.querySelector('.cb-msg--ocr'); options.logger({ status: 'recognizing text', progress: 0.4 }); await new Promise(r => { release = r; }); return { data: { text: 'Share your OTP now to claim your prize at http://x-claim.tk' } }; } }; } };
    const input = d.getElementById('cbFile'), attach = () => { Object.defineProperty(input, 'files', { value: [new p.window.File([new Uint8Array(8)], 'a.png', { type: 'image/png' })], configurable: true }); input.dispatchEvent(new p.window.Event('change')); };
    attach(); await until(() => progressNode && release); assert.equal(progressNode.getAttribute('aria-hidden'), 'true', 'the changing percentage is hidden from the screen reader after it first appears');
    assert.match(progressNode.textContent, /Reading image — 40%/); release(); await until(() => /Here's what I read/.test(d.getElementById('cbMessages').textContent), 9000);
    await until(() => !d.querySelector('.cb-msg--ocr')); progressNode = null; release = null; await sleep(1500);
    attach(); await until(() => release); release(); await until(() => (d.getElementById('cbMessages').textContent.match(/Here's what I read/g) || []).length === 2, 12000);
    assert.equal(p.window.__made, 1, 'two pictures, one engine'); assert.equal(opts.workerPath.endsWith('vendor/tesseract/worker.min.js'), true);
  } finally { p.close(); }
});

test('the attach button warms the reader while the picture is being chosen; closing the chat and hiding the page end the speaker and the reader', () => {
  const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  assert.ok(/attachBtn\.addEventListener\('click', \(\) => \{ if \(ocr\) ocr\.warm\(\)/.test(src));
  assert.ok(/function closePanel\(\) \{[\s\S]{0,400}speaker\.stop\(\)[\s\S]{0,200}ocr\.release\(\)/.test(src), 'closing the chat');
  assert.ok(/addEventListener\('pagehide', \(\) => \{ if \(ocr\) ocr\.release\(\); if \(speaker\) speaker\.stop\(\); \}\)/.test(src), 'hiding the page');
  assert.ok(!/speechSynthesis\.speak\(/.test(src.replace(/\/\/[^\n]*/g, '')), 'nothing bypasses the queue');
  assert.ok(!/\.pause\(\)|\.resume\(\)/.test(fs.readFileSync(path.join(ROOT, 'lib/speech.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')), 'no pause/resume timer: Android Chrome treats pause as cancel');
});
