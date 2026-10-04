#!/usr/bin/env node
'use strict';
/* Measures the text reader in a real Chrome under the site's real Content-Security-Policy: the old way (Tesseract.recognize, a new worker
   for every picture) against the managed worker (lib/ocrworker.js), over three pictures, and the first picture when the worker was started
   while the picture was being chosen. Also reports any policy violation. Usage: npm run bench:ocr */
const { launch, serve } = require('./cdp.js');
(async () => {
  const site = await serve(), b = await launch(), violations = [];
  b.on(m => { if (m.method === 'Log.entryAdded' && /violates|Refused/.test(m.params.entry.text)) violations.push(m.params.entry.text.slice(0, 140)); });
  await b.goto(site.base + '/assistant.html');
  console.log(await b.eval(`navigator.userAgent.match(/Chrome\\/[\\d.]+/)[0] + ', ' + navigator.hardwareConcurrency + ' cores'`));
  const r = JSON.parse(await b.eval(`(async () => {
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/tesseract/tesseract.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    const mk = lines => { const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 900; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1080, 900); g.fillStyle = '#111'; g.font = '44px Helvetica, Arial, sans-serif'; lines.forEach((t, i) => g.fillText(t, 40, 160 + i * 70)); return new Promise(res => cv.toBlob(res, 'image/jpeg', 0.92)); };
    const shots = [await mk(['SBI ALERT: Your account will be blocked', 'today. Share your OTP now to continue.', 'Click sbi-kyc-update.tk to verify']), await mk(['Dear customer your electricity will be', 'disconnected tonight. Call 98XXXXXX01', 'to update your bill immediately']), await mk(['You have won Rs 25 lakh in KBC lottery.', 'Pay Rs 5000 processing fee to claim', 'your prize now'])];
    const base = new URL('vendor/tesseract/', document.baseURI).href, opts = { workerPath: base + 'worker.min.js', corePath: base, langPath: base + 'lang' };
    const timed = async f => { const t = performance.now(); const x = await f(); return [Math.round(performance.now() - t), x]; }, right = x => /OTP|electricity|KBC/i.test(x.data.text);
    const wrapper = []; for (const s of shots) { const [ms, x] = await timed(() => Tesseract.recognize(s, 'eng+hin', opts)); wrapper.push({ ms, correct: right(x) }); }
    const ocr = FraudShieldOcr.createOcr({ load: async () => Tesseract, langs: 'eng+hin', idleMs: 0, options: opts });
    const managed = []; for (const s of shots) { const [ms, x] = await timed(() => ocr.recognize(s)); managed.push({ ms, correct: right(x) }); }
    const starts = ocr.starts; await ocr.release();
    const warm = FraudShieldOcr.createOcr({ load: async () => Tesseract, langs: 'eng+hin', idleMs: 0, options: opts }); warm.warm(); await new Promise(res => setTimeout(res, 4000));
    const [firstWarm] = await timed(() => warm.recognize(shots[0])); await warm.release();
    return JSON.stringify({ wrapper, managed, workerStartsManaged: starts, firstPictureWarmedMs: firstWarm });
  })()`));
  const sum = a => a.reduce((t, x) => t + x.ms, 0);
  console.log(`wrapper (new worker per picture): ${r.wrapper.map(x => x.ms + ' ms').join(', ')}  total ${sum(r.wrapper)} ms`);
  console.log(`managed (one hot worker, ${r.workerStartsManaged} start): ${r.managed.map(x => x.ms + ' ms').join(', ')}  total ${sum(r.managed)} ms  (${Math.round((1 - sum(r.managed) / sum(r.wrapper)) * 100)}% less)`);
  console.log(`first picture when started while choosing it: ${r.firstPictureWarmedMs} ms`);
  const ok = [...r.wrapper, ...r.managed].every(x => x.correct) && r.workerStartsManaged === 1 && violations.length === 0;
  console.log('every read correct:', [...r.wrapper, ...r.managed].every(x => x.correct), '| policy violations:', violations.length ? violations : 'none');
  b.close(); site.close(); process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
