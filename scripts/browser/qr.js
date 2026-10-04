#!/usr/bin/env node
'use strict';
/* Drives the real assistant in a real Chrome with three pictures and reports what it does with each:
   1. a UPI code that can be read (a refund-desk scam payload)   -> must be read and called a scam, text reader not used
   2. a branded code too damaged to read (a logo bigger than error correction can repair) -> must STOP with "cannot read it", text reader not used
   3. a screenshot with only text                                   -> no code present, so the text reader runs
   Codes are made by the independent encoder (qrcode) and painted in the page. Usage: npm run bench:qr */
const QRCode = require('qrcode');
const { launch, serve } = require('./cdp.js');

const matrixOf = (text, ec) => { const q = QRCode.create(text, { errorCorrectionLevel: ec }), n = q.modules.size; return { n, bits: Array.from(q.modules.data, v => (v ? 1 : 0)) }; };
const SCAM = 'upi://pay?pa=refund.desk@ybl&pn=Refund%20Desk&am=4999&cu=INR&tn=claim%20refund';

(async () => {
  const site = await serve(), b = await launch(), v = [];
  b.on(m => { if (m.method === 'Log.entryAdded' && /violates|Refused/.test(m.params.entry.text)) v.push(m.params.entry.text.slice(0, 120)); });
  await b.goto(site.base + '/assistant.html'); await b.sleep(1500);
  const scenarios = { readable: matrixOf(SCAM, 'M'), branded: matrixOf(SCAM, 'L'), text: null };
  const out = JSON.parse(await b.eval(`(async () => {
    const scen = ${JSON.stringify(scenarios)}, results = {}, d = document, log = () => d.getElementById('cbMessages').textContent, sleep = ms => new Promise(r => setTimeout(r, ms));
    const draw = (m, logo) => { const px = 8, quiet = 4, side = (m.n + 2 * quiet) * px, cv = document.createElement('canvas'); cv.width = cv.height = side + 400; const g = cv.getContext('2d'); g.fillStyle = '#f6f6f6'; g.fillRect(0, 0, cv.width, cv.height);
      g.fillStyle = '#fff'; g.fillRect(200, 200, side, side); g.fillStyle = '#000'; for (let r = 0; r < m.n; r++) for (let c = 0; c < m.n; c++) if (m.bits[r * m.n + c]) g.fillRect(200 + (quiet + c) * px, 200 + (quiet + r) * px, px, px);
      if (logo) { const cx = 200 + side / 2, cy = 200 + side / 2, rad = side * logo / 2; g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, rad, 0, 7); g.fill(); g.fillStyle = '#0a5ac8'; g.beginPath(); g.arc(cx, cy, rad * 0.82, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = 'bold ' + rad + 'px sans-serif'; g.textAlign = 'center'; g.fillText('P', cx, cy + rad * 0.33); }
      g.fillStyle = '#111'; g.font = '40px Helvetica, Arial, sans-serif'; g.textAlign = 'left'; g.fillText('Scan to pay Rs 5000', 200, 120); return cv; };
    const textShot = () => { const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 700; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1080, 700); g.fillStyle = '#111'; g.font = '44px Helvetica, Arial, sans-serif'; ['Your electricity bill of Rs 1450 is due', 'on 12 October. Pay at the official portal', 'or in the app. Thank you.'].forEach((t, i) => g.fillText(t, 40, 150 + i * 70)); return cv; };
    const send = async (cv, name) => { const blob = await new Promise(r => cv.toBlob(r, 'image/png')), file = new File([blob], name + '.png', { type: 'image/png' }), dt = new DataTransfer(); dt.items.add(file);
      const before = log().length, t0 = performance.now(), input = d.getElementById('cbFile'); input.files = dt.files; input.dispatchEvent(new Event('change'));
      let last = log(), since = performance.now(); for (let i = 0; i < 400; i++) { await sleep(100); const now = log(); if (now !== last || d.querySelector('[data-cb-typing]')) { last = now; since = performance.now(); } if (log().length > before && performance.now() - since > 1800) break; }
      return { ms: Math.round(performance.now() - t0), reply: log().slice(before) }; };
    results.readable = await send(draw(scen.readable, 0), 'readable');
    results.branded = await send(draw(scen.branded, 0.34), 'branded');
    results.text = await send(textShot(), 'text');
    return JSON.stringify(results);
  })()`));
  const say = (r, re) => re.test(r.reply);
  const checks = [
    ['readable UPI code is read and called a scam', say(out.readable, /I found a QR code in that image/) && say(out.readable, /looks like a scam/i) && !say(out.readable, /cannot read it/)],
    ['unreadable branded code stops the assistant', say(out.branded, /I can see a QR code in this picture, but I cannot read it/) && say(out.branded, /Do not scan it/) && !say(out.branded, /what I read from the image|no known scam pattern|looks like a scam/i)],
    ['text-only screenshot goes to the text reader and says no QR was found', say(out.text, /what I read from the image \(no QR code found in it\)/)]
  ];
  for (const [name, ok] of checks) console.log((ok ? 'ok   ' : 'FAIL ') + name);
  console.log(`time from attach to finished reply: readable ${out.readable.ms} ms, branded ${out.branded.ms} ms, text ${out.text.ms} ms (these include the bot's paced typing)`);
  console.log('policy violations:', v.length ? v : 'none');
  b.close(); site.close(); process.exit(checks.every(c => c[1]) && !v.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
