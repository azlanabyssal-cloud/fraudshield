'use strict';
// Runs every real page and its real scripts in a DOM and fails on any uncaught error.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { loadPage, ROOT } = require('./helpers/dom.js');
const { PAGES } = require('../scripts/scan_numbers.js');

const stats = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/stats.json'), 'utf8'));
const pages = PAGES.filter(p => fs.existsSync(path.join(ROOT, p)));

for (const page of pages) {
  test(`${page} loads and runs with no uncaught errors`, async () => {
    const p = await loadPage(page);
    try {
      assert.deepEqual(p.errors, [], p.errors.join('\n---\n'));
      assert.ok(p.document.querySelector('nav#navbar'), 'nav is present');
      assert.ok(p.document.querySelector('footer'), 'footer is present');
      assert.equal(p.document.querySelectorAll('h1').length, 1, 'exactly one h1');
    } finally { p.close(); }
  });
}

test('the hamburger opens and closes the mobile menu', async () => {
  const p = await loadPage('tips.html');
  try {
    const btn = p.document.getElementById('hamburger'), menu = p.document.getElementById('mobileNav');
    assert.ok(btn && menu); const before = menu.classList.contains('open');
    btn.click(); assert.notEqual(menu.classList.contains('open'), before, 'first click toggles');
    btn.click(); assert.equal(menu.classList.contains('open'), before, 'second click restores');
  } finally { p.close(); }
});

test('the hero scene mounts: bubbles, an x-ray copy with red flags, a lens, and no photo', async () => {
  const p = await loadPage('index.html');
  try {
    const host = p.document.getElementById('heroScene');
    const base = host.querySelectorAll('.hs__field:not(.hs__field--xray) .hs__msg'), xray = host.querySelectorAll('.hs__field--xray .hs__msg');
    assert.ok(base.length >= 3 && base.length === xray.length, 'base and x-ray layers match');
    assert.ok(host.querySelectorAll('.hs__field--xray mark.hs__flag[data-label]').length >= 3, 'red flags are labelled');
    assert.ok(host.querySelector('.hs__lens'), 'lens exists'); assert.equal(host.getAttribute('aria-hidden'), 'true'); assert.equal(host.querySelectorAll('img').length, 0);
    assert.ok(host.style.getPropertyValue('--lr'), 'lens radius was set');
  } finally { p.close(); }
});

test('the data page hands each chart exactly the numbers in the data file', async () => {
  const p = await loadPage('data.html', { setup: w => { w.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe(el) { Promise.resolve().then(() => this.cb([{ target: el, isIntersecting: true, boundingClientRect: { bottom: 1 } }])); } unobserve() {} disconnect() {} }; } });
  try {
    assert.deepEqual(p.errors, [], p.errors.join('\n'));
    const plain = x => JSON.parse(JSON.stringify(x));   // arrays made inside jsdom belong to another realm
    const byId = Object.fromEntries(p.record.charts.map(c => [c.id, plain(c.config)]));
    const want = (key) => stats.series[key].points.map(pt => stats.stats[pt.stat].value);
    assert.deepEqual(byId.casesChart.data.datasets[0].data, want('ncrb_cases'));
    assert.deepEqual(byId.typeChart.data.datasets[0].data, want('loss_shares_2025'));
    assert.deepEqual(byId.stateChart.data.datasets[0].data, want('states_2024'));
    assert.deepEqual(byId.moneyChart.data.datasets[0].data, want('losses'));
    assert.deepEqual(byId.casesChart.data.labels, ['2021', '2022', '2023', '2024']);
    assert.equal(Object.keys(byId).length, 4);
  } finally { p.close(); }
});

test('the average-loss counter ticks with Indian formatting and the rate from the data file', async () => {
  const p = await loadPage('index.html', { settle: 1300 });
  try {
    const el = p.document.getElementById('costSince');
    assert.equal(Number(el.getAttribute('data-target')), stats.stats.loss_per_second_2025.value);
    assert.match(el.textContent, /^₹[\d,]+$|^₹\d+\.\d{2} (Lakh|Cr)$/, el.textContent);
    assert.ok(!/\d\.\d,000/.test(el.textContent), 'the old "79.7,000" formatting bug must not return');
  } finally { p.close(); }
});

/* ---------- the assistant, driven through its real UI ---------- */
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 60)); } return fn(); };
const say = (doc, text) => { doc.getElementById('cbInput').value = text; doc.getElementById('cbSend').click(); };
const transcript = doc => doc.getElementById('cbMessages').textContent;
const finished = doc => /Never enter your OTP/.test(transcript(doc));   // the closing line of every link verdict; the bot types its lines one at a time
const attach = (win, name = 'photo.png') => {
  const input = win.document.getElementById('cbFile');
  Object.defineProperty(input, 'files', { value: [new win.File([new Uint8Array(32)], name, { type: 'image/png' })], configurable: true });
  win.URL.createObjectURL = () => 'blob:fraudshield-test'; win.URL.revokeObjectURL = () => {};
  input.dispatchEvent(new win.Event('change'));
};

test('a pasted scam link with a few words around it gets a scam verdict, a 1930 button, and never the word "safe"', async () => {
  const p = await loadPage('assistant.html');
  try {
    say(p.document, 'check this http://rto-challan-pay.top/echallan.apk');
    await until(() => /Walk me through/.test(transcript(p.document)));
    const text = transcript(p.document);
    assert.match(text, /🚫 This looks like a fake app or remote-access scam/); assert.match(text, /app file|\.apk/);
    assert.ok(p.document.querySelector('#cbMessages a[href="tel:1930"]'), 'the 1930 button is offered');
    assert.doesNotMatch(text, /\bsafe\b/i);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('an official address is called official, with the reminder that a real address does not vouch for the message', async () => {
  const p = await loadPage('assistant.html');
  try {
    say(p.document, 'https://sbi.bank.in/');
    await until(() => finished(p.document));
    const text = transcript(p.document);
    assert.match(text, /✅ This ends in \.bank\.in/); assert.match(text, /Never enter your OTP/); assert.doesNotMatch(text, /\bsafe\b/i);
  } finally { p.close(); }
});

test('an image is checked for a QR code first: a refund QR is called a scam and the on-screen text is not needed', async () => {
  const p = await loadPage('assistant.html');
  try {
    let ocrCalled = false;
    p.window.FraudShieldQR.scan = async () => 'upi://pay?pa=refund@ybl&pn=Refund%20Desk&tn=claim%20refund&am=4999';
    p.window.Tesseract = { recognize: async () => { ocrCalled = true; return { data: { text: '' } }; } };
    attach(p.window);
    await until(() => finished(p.document), 9000);
    const text = transcript(p.document);
    assert.match(text, /I found a QR code in that image/); assert.match(text, /only ever sends money out/); assert.match(text, /🚫 This QR code looks like a scam/);
    assert.equal(ocrCalled, false, 'a decoded QR code ends the search; OCR is not run');
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('an image with no QR code falls back to reading its text, and a link in that text is still checked', async () => {
  const p = await loadPage('assistant.html');
  try {
    p.window.FraudShieldQR.scan = async () => null;
    p.window.Tesseract = { recognize: async () => ({ data: { text: 'Dear customer your KYC is expired. Update now at http://sbi-kyc-update.tk to avoid block' } }) };
    attach(p.window);
    await until(() => /Walk me through/.test(transcript(p.document)), 9000);
    const text = transcript(p.document);
    assert.match(text, /Here's what I read from the image/); assert.match(text, /🚫 This looks like a fake KYC/); assert.match(text, /sbi-kyc-update\.tk/);
  } finally { p.close(); }
});

test('a QR scan that throws does not strand the user: the text reader takes over', async () => {
  const p = await loadPage('assistant.html');
  try {
    p.window.FraudShieldQR.scan = () => Promise.reject(new Error('decoder failed to load'));
    p.window.Tesseract = { recognize: async () => ({ data: { text: 'Pay Rs 500 to claim your prize now at http://paytm-kyc-update.in/verify' } }) };
    attach(p.window);
    await until(() => /Here's what I read/.test(transcript(p.document)), 9000);
    assert.match(transcript(p.document), /Here's what I read from the image/);
  } finally { p.close(); }
});

/* ---------- motion, wired into the real pages ---------- */
test('the hero lens is steered by the physics engine, and the scene leans with it (parallax variables are written and bounded)', async () => {
  const p = await loadPage('index.html', { settle: 900 });
  try {
    const scene = p.document.getElementById('heroScene');
    const px = parseFloat(scene.style.getPropertyValue('--px')), py = parseFloat(scene.style.getPropertyValue('--py'));
    assert.ok(Number.isFinite(px) && Number.isFinite(py), 'parallax variables exist');
    assert.ok(Math.abs(px) <= 0.5 && Math.abs(py) <= 0.5, `inside the hero: ${px}, ${py}`);
    assert.ok(Number.isFinite(parseFloat(scene.style.getPropertyValue('--lx'))));
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('a stat counter runs from 0 to the sourced value along the engine and ends exactly on it', async () => {
  const p = await loadPage('index.html', { settle: 300 });
  try {
    const el = p.document.querySelector('#stat-counters .counter-number'), target = Number(el.dataset.target), obs = p.record.observers.find(o => o.last === el) || p.record.observers[0];
    const sourced = el.textContent, shown = () => Number(el.textContent.replace(/[^\d.]/g, '')) || 0;   // the page ships with the sourced text already in place
    obs.cb([{ isIntersecting: true, target: el }]);
    await new Promise(r => setTimeout(r, 350));
    const mid = shown(); assert.ok(mid > 0, 'it has started: ' + el.textContent);
    await new Promise(r => setTimeout(r, 2100));
    assert.ok(target > 0 && shown() >= mid, 'never runs backwards');
    assert.equal(el.textContent, sourced, 'it ends on exactly the text the page was built with');
  } finally { p.close(); }
});

test('a magnetic control leans towards a near pointer, never further than its limit, and returns when the pointer leaves', async () => {
  const p = await loadPage('index.html', { settle: 300 });
  try {
    p.window.matchMedia = q => ({ matches: /hover: hover|pointer: fine/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
    const el = p.document.querySelector('[data-magnetic]'); assert.ok(el, 'the hero call to action is marked magnetic');
    el.getBoundingClientRect = () => ({ left: 100, top: 100, width: 200, height: 50, right: 300, bottom: 150 });
    const m = p.window.FraudShieldMotion.magnetic(el); assert.ok(m, 'fine pointer: active');
    const move = (x, y) => p.document.dispatchEvent(new p.window.MouseEvent('pointermove', { clientX: x, clientY: y }));
    const shift = () => el.style.translate.split(' ').map(parseFloat);
    move(290, 125); await new Promise(r => setTimeout(r, 700)); const [x] = shift(); assert.ok(x > 5 && x <= 9.001, 'pulled right, within the limit: ' + x);
    move(900, 900); await new Promise(r => setTimeout(r, 700)); assert.deepEqual(shift().map(Math.abs), [0, 0], 'a far pointer lets go');
    move(290, 125); await new Promise(r => setTimeout(r, 400)); p.document.documentElement.dispatchEvent(new p.window.Event('pointerleave')); await new Promise(r => setTimeout(r, 700)); assert.deepEqual(shift().map(Math.abs), [0, 0], 'leaving the window lets go');
    m.destroy(); assert.equal(el.style.translate, '');
  } finally { p.close(); }
});

test('on a touch device no control is magnetic', async () => {
  const p = await loadPage('index.html', { settle: 200 });
  try {
    p.window.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
    assert.equal(p.window.FraudShieldMotion.magnetic(p.document.querySelector('[data-magnetic]')), null);
  } finally { p.close(); }
});

/* ---------- the assistant reads pasted messages, not just links ---------- */
test('a pasted KYC scam is named, its words are quoted back, and the person is offered the next step', async () => {
  const p = await loadPage('assistant.html');
  try {
    say(p.document, 'Dear customer, your KYC expires today. Update now at bankkyc-verify.xyz or your account will be blocked.');
    await until(() => /Walk me through/.test(transcript(p.document)));
    const text = transcript(p.document);
    assert.match(text, /🚫 This looks like a fake KYC or account-block message/); assert.match(text, /What gave it away:/);
    assert.match(text, /• "kyc … expires"/); assert.match(text, /Do not use the link or phone number/);
    assert.ok(p.document.querySelector('#cbMessages a[href="tel:1930"]'), 'the 1930 button is offered');
    assert.doesNotMatch(text, /\bsafe\b/i); assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('"Walk me through what to do" continues into the existing step-by-step flow for that scam', async () => {
  const p = await loadPage('assistant.html');
  try {
    say(p.document, 'This is the Cyber Crime Branch. A parcel in your name has illegal items. Stay on this video call. Do not tell anyone.');
    await until(() => /Walk me through/.test(transcript(p.document)));
    assert.match(transcript(p.document), /fake-officer or "digital arrest" call/);
    const chip = [...p.document.querySelectorAll('#cbMessages button')].find(b => /Walk me through/.test(b.textContent)); assert.ok(chip);
    const before = transcript(p.document).length; chip.click();
    await until(() => transcript(p.document).length > before + 40);
    assert.ok(transcript(p.document).length > before + 40, 'the flow started');
  } finally { p.close(); }
});

test('a real bank warning is not flagged, and a long message with no known pattern gets an honest "found nothing", never "genuine"', async () => {
  const p = await loadPage('assistant.html');
  try {
    say(p.document, 'Rs 2,000.00 debited from A/c XX1234 on 03-Oct-26 to VPA shop@oksbi. If not you, call 1930 or your bank.');
    await until(() => /does not make it genuine/.test(transcript(p.document)));
    const text = transcript(p.document);
    assert.match(text, /❔ I found no known scam pattern in this message/); assert.match(text, /does not make it genuine/);
    assert.doesNotMatch(text, /🚫|⚠️/); assert.doesNotMatch(text, /\b(?:is|looks) (?:safe|genuine)\b/i);
  } finally { p.close(); }
});

test('a person describing what happened is not interrogated as if they had pasted a scam: the old guided flow still answers', async () => {
  const p = await loadPage('assistant.html');
  try {
    say(p.document, 'I got a call from someone saying they are from CBI and my Aadhaar is linked to a drug case');
    await until(() => /That sounds like Digital Arrest/.test(transcript(p.document)));
    assert.match(transcript(p.document), /That sounds like Digital Arrest/); assert.doesNotMatch(transcript(p.document), /What gave it away/);
  } finally { p.close(); }
});

test('a screenshot of a scam text is read by OCR and then analysed as a message', async () => {
  const p = await loadPage('assistant.html');
  try {
    p.window.FraudShieldQR.scan = async () => null;
    p.window.Tesseract = { recognize: async () => ({ data: { text: 'SBI ALERT: Your account will be blocked today. Share your OTP immediately to continue.' } }) };
    attach(p.window);
    await until(() => /Walk me through/.test(transcript(p.document)), 9000);
    assert.match(transcript(p.document), /Here's what I read from the image/); assert.match(transcript(p.document), /What gave it away/);
  } finally { p.close(); }
});

/* ---------- the microphone: honest about where audio goes, and it works ---------- */
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
const SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const withSpeech = (opts = {}) => w => {
  Object.defineProperty(w.navigator, 'userAgent', { value: opts.ua || CHROME_UA, configurable: true });
  if (opts.none) return;
  // a browser that offers on-device recognition also defines processLocally on its recognizer
  class FakeSR { constructor() { FakeSR.last = this; this.started = 0; if (opts.available) this.processLocally = false; } start() { this.started++; if (opts.startError) { const e = new Error('x'); e.name = opts.startError; throw e; } if (this.onstart) this.onstart(); } stop() { if (this.onend) this.onend(); } }
  if (opts.available) FakeSR.available = opts.available;
  w.webkitSpeechRecognition = FakeSR; w.__FakeSR = FakeSR;
};
const tapMic = async p => { p.document.getElementById('cbMic').click(); await new Promise(r => setTimeout(r, 120)); };
const chipNamed = (p, re) => [...p.document.querySelectorAll('#cbMessages button')].find(b => re.test(b.textContent));
const speak = (rec, text, final = true) => rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: final })] });

test('the microphone is present, and it never opens before the person has decided where their audio may go', async () => {
  const p = await loadPage('assistant.html', { setup: withSpeech() });
  try {
    const mic = p.document.getElementById('cbMic'); assert.equal(mic.hidden, false, 'the microphone button is visible');
    await tapMic(p); await until(() => /Voice needs one decision/.test(transcript(p.document)));
    assert.match(transcript(p.document), /sends your audio to Google/); assert.match(transcript(p.document), /FraudShield never receives it/);
    assert.equal((p.window.__FakeSR.last || { started: 0 }).started, 0, 'no audio before consent');
    assert.ok(chipNamed(p, /Allow voice \(audio goes to Google\)/) && chipNamed(p, /No, I will type/));
  } finally { p.close(); }
});

test('saying yes starts the microphone in English, discloses where the audio goes while listening, and is remembered', async () => {
  const p = await loadPage('assistant.html', { setup: withSpeech() });
  try {
    await tapMic(p); await until(() => chipNamed(p, /Allow voice/)); chipNamed(p, /Allow voice/).click();
    const rec = p.window.__FakeSR.last; assert.equal(rec.started, 1); assert.equal(rec.lang, 'en-IN');
    assert.match(p.document.getElementById('cbInput').placeholder, /Listening… \(audio goes to Google\)/);
    assert.equal(p.window.localStorage.getItem('fs_voice_consent_v1'), 'cloud');
    rec.stop(); await tapMic(p); assert.equal(rec.started, 2, 'the second time it does not ask again');
  } finally { p.close(); }
});

test('saying no records nothing and leaves the microphone shut', async () => {
  const p = await loadPage('assistant.html', { setup: withSpeech() });
  try {
    await tapMic(p); await until(() => chipNamed(p, /No, I will type/)); chipNamed(p, /No, I will type/).click();
    await until(() => /Nothing was recorded/.test(transcript(p.document)));
    assert.equal(p.window.__FakeSR.last ? p.window.__FakeSR.last.started : 0, 0); assert.equal(p.window.localStorage.getItem('fs_voice_consent_v1'), null);
  } finally { p.close(); }
});

test('where the browser can recognise speech on the device, nothing leaves and no question is asked', async () => {
  const p = await loadPage('assistant.html', { setup: withSpeech({ available: async () => 'available' }) });
  try {
    await tapMic(p); const rec = p.window.__FakeSR.last;
    assert.equal(rec.started, 1); assert.equal(rec.processLocally, true); assert.doesNotMatch(transcript(p.document), /Voice needs one decision/);
    assert.match(p.document.getElementById('cbInput').placeholder, /Listening… \(on this device\)/);
  } finally { p.close(); }
});

test('what is said is captioned live, then answered like typed text', async () => {
  const p = await loadPage('assistant.html', { setup: withSpeech({ available: async () => 'available' }) });
  try {
    await tapMic(p); const rec = p.window.__FakeSR.last;
    speak(rec, 'someone asked for my', false); assert.equal(p.document.getElementById('cbInput').value, 'someone asked for my');
    speak(rec, 'please share your OTP now'); await until(() => /What gave it away/.test(transcript(p.document)), 9000);
    assert.match(transcript(p.document), /please share your OTP now/); assert.match(transcript(p.document), /OTP/);
  } finally { p.close(); }
});

test('a blocked microphone gets instructions that fit a Mac, and the next tap may try again (nothing latches)', async () => {
  const p = await loadPage('assistant.html', { setup: withSpeech({ available: async () => 'available', ua: SAFARI_UA }) });
  try {
    await tapMic(p); const rec = p.window.__FakeSR.last; rec.onerror({ error: 'not-allowed' });
    await until(() => /System Settings/.test(transcript(p.document))); assert.match(transcript(p.document), /Privacy & Security → Microphone/);
    await tapMic(p); assert.equal(rec.started, 2, 'after fixing the permission, tapping again tries again');
    rec.onerror({ error: 'service-not-allowed' }); await until(() => /Dictation/.test(transcript(p.document))); assert.match(transcript(p.document), /Keyboard → Dictation/);
  } finally { p.close(); }
});

test('Safari names Apple, and a browser without speech recognition says so instead of doing nothing', async () => {
  const s = await loadPage('assistant.html', { setup: withSpeech({ ua: SAFARI_UA }) });
  try { await tapMic(s); await until(() => /Voice needs one decision/.test(transcript(s.document))); assert.match(transcript(s.document), /sends your audio to Apple/); } finally { s.close(); }
  const n = await loadPage('assistant.html', { setup: withSpeech({ none: true }) });
  try { await tapMic(n); await until(() => /isn't supported in this browser/.test(transcript(n.document))); assert.match(transcript(n.document), /Chrome, Edge, or Safari/); } finally { n.close(); }
});

test('the Hindi switch changes the language the microphone listens in', async () => {
  const p = await loadPage('assistant.html', { setup: withSpeech({ available: async () => 'available' }) });
  try {
    const lang = p.document.getElementById('cbLang'); assert.equal(lang.textContent, 'EN'); lang.click(); assert.equal(lang.textContent, 'हिं'); assert.match(lang.getAttribute('aria-label'), /Hindi.*switch to English/);
    await tapMic(p); assert.equal(p.window.__FakeSR.last.lang, 'hi-IN');
  } finally { p.close(); }
});

test('with "reduce motion" on, the hero lens drops its drift but still follows the pointer exactly', async () => {
  const p = await loadPage('index.html', { settle: 600, setup: w => { w.matchMedia = q => ({ matches: /prefers-reduced-motion: reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} }); } });
  try {
    const scene = p.document.getElementById('heroScene'); assert.ok(scene.classList.contains('hs--still'));
    const before = scene.style.getPropertyValue('--lx');
    scene.parentElement.dispatchEvent(new p.window.MouseEvent('pointermove', { clientX: 420, clientY: 260, bubbles: true }));
    assert.equal(scene.style.getPropertyValue('--lx'), '420.0px'); assert.equal(scene.style.getPropertyValue('--ly'), '260.0px'); assert.notEqual(before, '420.0px');
  } finally { p.close(); }
});

/* ---------- the living hero and the flowing steps, on the real home page ---------- */
test('the home page arms the water: every step has an awake-ness, the line a fill, and none of it breaks the page', async () => {
  const p = await loadPage('index.html', { settle: 500 });
  try {
    const grid = p.document.querySelector('.funnel-grid'); assert.ok(grid.classList.contains('flow-armed'));
    const steps = [...grid.querySelectorAll('.funnel-step')]; assert.equal(steps.length, 4);
    for (const el of steps) { const s = parseFloat(el.style.getPropertyValue('--s')); assert.ok(s >= 0 && s <= 1, 'awake-ness is a fraction'); assert.ok(!/\breveal\b/.test(el.className), 'the flow, not a second reveal, owns the steps'); }
    const flow = parseFloat(grid.style.getPropertyValue('--flow')); assert.ok(flow >= 0 && flow <= 1);
    assert.ok(grid.querySelector('.funnel-drop') && grid.querySelector('.funnel-connector'));
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('the hero gets a motes canvas that is actually drawn on, inside the animation loop', async () => {
  const calls = { arc: 0, clear: 0 };
  const setup = w => {
    Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { get() { return 1000; }, configurable: true }); Object.defineProperty(w.HTMLElement.prototype, 'clientHeight', { get() { return 600; }, configurable: true });
    const ctx = new Proxy({}, { get: (_, k) => (...a) => { if (k === 'arc') calls.arc++; if (k === 'clearRect') calls.clear++; return a; }, set: () => true });
    w.HTMLCanvasElement.prototype.getContext = () => ctx;
  };
  const p = await loadPage('index.html', { settle: 900, setup });
  try {
    const canvas = p.document.querySelector('#heroScene canvas.hs__motes'); assert.ok(canvas, 'the canvas exists'); assert.equal(canvas.width, 1000);
    assert.ok(calls.clear > 3 && calls.arc > 50, `drawn repeatedly: ${calls.clear} clears, ${calls.arc} circles`);
  } finally { p.close(); }
});

test('under Reduce Motion the hero adds no canvas and the steps stay fully visible', async () => {
  const p = await loadPage('index.html', { settle: 500, setup: w => { w.matchMedia = q => ({ matches: /prefers-reduced-motion: reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} }); } });
  try {
    assert.equal(p.document.querySelector('#heroScene canvas'), null); assert.ok(!p.document.querySelector('.funnel-grid').classList.contains('flow-armed'));
  } finally { p.close(); }
});

test('on the real home page the characters are mounted: their pupils turn towards the pointer and nothing throws', async () => {
  const p = await loadPage('index.html', { settle: 400 });
  try {
    p.window.performance.now = (n => () => n += 16)(5000);
    p.window.dispatchEvent(Object.assign(new p.window.Event('pointermove'), { clientX: 900, clientY: 40 }));
    await new Promise(r => setTimeout(r, 700));
    const moved = [...p.document.querySelectorAll('.creature .cr-pupil')].filter(el => /translate\(/.test(el.style.transform));
    assert.ok(moved.length >= 12, 'the pupils of all six characters have been given an offset: ' + moved.length);
    assert.equal(p.document.querySelectorAll('.creature svg.cr-svg').length, 6); assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('under Reduce Motion the characters stay still: no offsets, no transforms, no ticker', async () => {
  const p = await loadPage('index.html', { settle: 400, setup: w => { w.matchMedia = q => ({ matches: /prefers-reduced-motion: reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} }); } });
  try {
    p.window.dispatchEvent(Object.assign(new p.window.Event('pointermove'), { clientX: 900, clientY: 40 })); await new Promise(r => setTimeout(r, 300));
    assert.ok([...p.document.querySelectorAll('.creature .cr-pupil')].every(el => !el.style.transform)); assert.ok([...p.document.querySelectorAll('.creature svg')].every(el => !el.style.transform));
  } finally { p.close(); }
});

/* ---------- the microphone is never touched without a tap ---------- */
for (const page of pages) {
  test(`${page}: loading, idling and moving the pointer never creates a speech recognizer or asks for the microphone`, async () => {
    const seen = { made: 0, started: 0, media: 0, permissions: 0 };
    const setup = w => {
      class Counting { constructor() { seen.made++; } start() { seen.started++; } stop() {} static available() { seen.permissions++; return Promise.resolve('unavailable'); } }
      w.webkitSpeechRecognition = Counting; w.SpeechRecognition = Counting;
      Object.defineProperty(w.navigator, 'mediaDevices', { value: { getUserMedia() { seen.media++; return Promise.reject(new Error('blocked')); } }, configurable: true });
    };
    const p = await loadPage(page, { settle: 900, setup });
    try {
      p.window.dispatchEvent(Object.assign(new p.window.Event('pointermove'), { clientX: 300, clientY: 200 })); await new Promise(r => setTimeout(r, 400));
      assert.deepEqual(seen, { made: 0, started: 0, media: 0, permissions: 0 }, 'nothing may touch speech or the microphone before a tap');
    } finally { p.close(); }
  });
}

test('the assistant header title is readable on its navy header on every page that has the chat: contrast of at least 7:1', async () => {
  const lum = rgb => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const parse = c => { const m = /rgba?\(([^)]+)\)/.exec(c); return (m ? m[1] : '0,0,0').split(',').slice(0, 3).map(Number); };
  for (const page of ['assistant.html', 'index.html']) {
    const p = await loadPage(page);
    try {
      p.document.querySelector('.cb-fab') && p.document.querySelector('.cb-fab').click();
      const title = p.document.querySelector('.cb-header__title'), head = title.closest('.cb-header'), w = p.window;
      const fg = parse(w.getComputedStyle(title).color), bg = parse(w.getComputedStyle(head).backgroundColor), [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      assert.ok((a + 0.05) / (b + 0.05) >= 7, `${page}: title ${fg} on ${bg} is ${(((a + 0.05) / (b + 0.05))).toFixed(2)}:1`);
    } finally { p.close(); }
  }
});
