'use strict';
// A QR code that is there but cannot be read stops the assistant. It must not fall back to reading the words around the code, give a verdict from them, or call anything safe.
const test = require('node:test');
const assert = require('node:assert/strict');
const QR = require('../lib/qr.js');
const { loadPage } = require('./helpers/dom.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 12000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await sleep(25); } };
const log = d => d.getElementById('cbMessages').textContent;
async function settle(d) { let last = log(d), since = Date.now(); await until(() => { const now = log(d); if (now !== last || d.querySelector('[data-cb-typing]')) { last = now; since = Date.now(); } return Date.now() - since > 1100; }, 25000); }
const attach = (w, name = 'qr.png') => { const input = w.document.getElementById('cbFile'); w.URL.createObjectURL = () => 'blob:t'; w.URL.revokeObjectURL = () => {}; Object.defineProperty(input, 'files', { value: [new w.File([new Uint8Array(16)], name, { type: 'image/png' })], configurable: true }); input.dispatchEvent(new w.Event('change')); };
// the modules exist only after the page's scripts have run, so the stand-ins go in afterwards
const page = async (inspect, worker) => { const p = await loadPage('assistant.html', { settle: 100 }); configure(p.window, inspect, worker); return p; };
const configure = (w, inspect, worker) => {
  w.FraudShieldImagePrep.prepare = async () => new w.Blob([new Uint8Array(8)], { type: 'image/jpeg' }); w.FraudShieldQR.inspect = inspect;
  w.__workers = 0; w.Tesseract = { createWorker: async () => { w.__workers++; return { terminate: async () => {}, recognize: async () => (worker ? worker() : { data: { text: 'Scan to pay Rs 5000 to refund desk' } }) }; } };
};

test('a QR code that is present but unreadable halts the assistant: a warning, the reasons, a way forward, and the text reader is never started', async () => {
  const p = await page(async () => ({ text: null, structure: { qr: true, certainty: 'full' } }));
  try {
    const d = p.document; attach(p.window); await until(() => /cannot read it/.test(log(d))); await settle(d);
    const t = log(d);
    assert.match(t, /I can see a QR code in this picture, but I cannot read it/); assert.match(t, /covered by a logo or sticker/); assert.match(t, /Do not scan it/); assert.match(t, /will not guess from the words around it/); assert.match(t, /ask for the UPI ID or the payment link in writing/);
    assert.equal(p.window.__workers, 0, 'the text reader was never started'); assert.doesNotMatch(t, /Here's what I read|no known scam pattern|looks like a scam|\bis safe\b/i);
    assert.ok([...d.querySelectorAll('.cb-chip')].some(c => /Try another picture/.test(c.textContent)), 'and a way to try again');
    const mem = JSON.parse(p.window.sessionStorage.getItem('fs_cb_state')).last; assert.equal(mem.kind, 'qr'); assert.equal(mem.level, 'unverified');
    d.getElementById('cbInput').value = 'is it safe?'; d.getElementById('cbSend').click(); await until(() => /cannot call it safe/.test(log(d)));
    assert.doesNotMatch(log(d).split('is it safe?')[1], /No\. Treat it as unsafe|is safe/, 'and asking afterwards never gets a yes');
    assert.deepEqual(p.errors.filter(e => !/domain-name check/.test(e)), []);
  } finally { p.close(); }
});

test('a partly visible code gets its own honest wording, and still stops', async () => {
  const p = await page(async () => ({ text: null, structure: { qr: true, certainty: 'partial' } }));
  try { attach(p.window); await until(() => /part of what looks like a QR code/.test(log(p.document))); assert.equal(p.window.__workers, 0); } finally { p.close(); }
});

test('with no code in the picture the text reader still runs, and says that it found no QR code; a readable code is analysed as before', async () => {
  const none = await page(async () => ({ text: null, structure: { qr: false, certainty: null } }), () => ({ data: { text: 'Your electricity bill of Rs 1450 is due on 12 October. Pay at the official portal.' } }));
  try { attach(none.window); await until(() => /what I read from the image/.test(log(none.document))); await settle(none.document); assert.match(log(none.document), /\(no QR code found in it\)/); assert.equal(none.window.__workers, 1); } finally { none.close(); }
  const ok = await page(async () => ({ text: 'upi://pay?pa=refund@ybl&pn=Refund%20Desk&tn=claim%20refund&am=4999', structure: { qr: true, certainty: 'full' } }));
  try { attach(ok.window); await until(() => /looks like a scam/.test(log(ok.document))); assert.equal(ok.window.__workers, 0, 'a readable code ends the search'); } finally { ok.close(); }
});

test('if the QR step itself fails, the picture is not lost: the text reader takes over and nothing throws', async () => {
  const p = await page(async () => { throw new Error('decoder blew up'); }, () => ({ data: { text: 'Pay Rs 500 now at http://paytm-kyc-update.in/verify to claim your prize' } }));
  try { attach(p.window); await until(() => /what I read from the image/.test(log(p.document))); assert.equal(p.window.__workers, 1); } finally { p.close(); }
});

test('QR.inspect never rejects: with nothing to decode it answers "no code seen"', async () => {
  const r = await QR.inspect({}, {}); assert.deepEqual(r, { text: null, structure: { qr: false, certainty: null } });
  assert.equal(typeof QR.inspectRGBA, 'function');
});
