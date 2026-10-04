#!/usr/bin/env node
'use strict';
/* How long does a verdict take? The message check, the link check and the UPI/QR payload check are run over a fixed corpus in a real Chrome, as the page runs them
   (lib/*.js, no network), once at full speed and once with the CPU slowed 6x, which is a common stand-in for a mid-range phone (it is an emulation, not a phone).
   Every call is timed on its own; the report gives p50, p95, p99 and the slowest call. SPEC section 5 asks for p95 under 50 ms. Usage: npm run bench:latency */
const fs = require('node:fs'), path = require('node:path');
const { launch, serve } = require('./cdp.js');
const ROOT = path.join(__dirname, '..', '..');

const hinglish = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'hinglish.json'), 'utf8'));
const english = ['Dear customer your SBI account will be blocked today. Update KYC immediately: http://sbi-kyc-update.tk/login', 'Your OTP for SBI transaction is 482913. Do not share it with anyone. -SBI', 'URGENT: Your electricity connection will be disconnected tonight at 9:30 pm. Call 98XXXXXX01 now to update bill.',
  'Congratulations! You won Rs 25 lakh in KBC lottery. Share your bank details and OTP to claim.', 'This is CBI. A parcel in your name contains drugs. You are under digital arrest. Stay on video call and do not tell anyone.', 'Rs.2,500.00 credited to your A/c XX1234 on 03-10-26 by UPI Ref 628374. -ICICI Bank',
  'Hi, are we still meeting at 6? Also please send the notes.', 'IRCTC: Your ticket PNR 4521896325 is confirmed. Train 12723 from HYB to NDLS on 10-Oct. Happy journey.', 'I have recorded your video. Pay Rs 30,000 or I will send it to all your contacts.', 'Sir I accidentally sent Rs 5000 to your PhonePe. Please return it, I am in a hospital emergency.',
  'Your Amazon order #402-1234567 has been shipped. Track at https://www.amazon.in/your-orders', 'Work from home! Earn Rs 5000 daily by liking YouTube videos. Join our Telegram group now t.me/earnfast'];
const longMsg = (english.concat(hinglish.scams)).join(' ').slice(0, 3900);
const messages = [...english, ...hinglish.scams, ...hinglish.genuine, longMsg];
const links = ['https://www.onlinesbi.sbi/', 'https://netbanking.hdfcbank.com/netbanking/', 'http://sbi-kyc-update.tk/login', 'https://hdfcbank.com.secure-login.xyz/', 'https://sbi.co.in.verify-now.top', 'https://www.sbi.co.in@evil.com/', 'https://xn--sbi-9ha.co.in', 'bit.ly/3xYz', 'https://wa.me/919999999999?text=hi',
  'https://evil-shop.com/sbi/kyc-update', 'https://www.google.com/url?q=https://sbi-kyc-update.tk/login', 'https://paytm-refund.in', 'https://irctc-tatkal-offer.com', 'https://sbi.co.in\\@evil.com', 'https://cybercrime.gov.in', 'https://random-shop.example.com/', 'http://192.168.1.5/sbi', 'https://sites.google.com/view/sbi-kyc',
  'upi://pay?pa=refund.desk@ybl&pn=Refund%20Desk&am=4999&tn=claim%20refund', 'upi://pay?pa=shop@okaxis&pn=Ravi%20Kirana&am=250', 'paytmmp://pay?pa=refund@ybl&pn=Refund&am=500', 'upi://pay?pa=sbi.support.helpline@ybl&pn=SBI%20Support&am=1', 'https://' + 'a'.repeat(200) + '.com/' + 'login/'.repeat(100)];

(async () => {
  const site = await serve(), b = await launch(); await b.goto(site.base + '/assistant.html'); await b.sleep(1500);
  const run = () => b.eval(`(async () => {
    const msgs = ${JSON.stringify(messages)}, links = ${JSON.stringify(links)}, M = FraudShieldMessage, L = FraudShieldLink, REPS = 40;
    const time = (items, f) => { const t = []; for (let r = 0; r < REPS; r++) for (const x of items) { const a = performance.now(); f(x); t.push(performance.now() - a); } t.sort((p, q) => p - q); const at = q => t[Math.min(t.length - 1, Math.floor(q * t.length))]; return { n: t.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: t[t.length - 1] }; };
    for (const m of msgs) M.analyzeMessage(m); for (const l of links) L.analyzePayload(l);   // warm up the JIT: first calls are not what a second message costs
    return JSON.stringify({ message: time(msgs, m => M.analyzeMessage(m)), link: time(links, l => L.analyzePayload(l)), modelLoaded: document.documentElement.dataset.nameModel });
  })()`).then(JSON.parse);
  const results = {};
  for (const rate of [1, 6]) { await b.send('Emulation.setCPUThrottlingRate', { rate }); results[rate] = await run(); }
  // The first verdict after a page loads is the one a worried person is waiting for. Measured on fresh page loads (3 each), after the page's idle warm-up has had time to run.
  const first = {};
  for (const rate of [1, 6]) {
    await b.send('Emulation.setCPUThrottlingRate', { rate }); const samples = [];
    for (let i = 0; i < 3; i++) { await b.goto(site.base + '/assistant.html?cold=' + rate + i); await b.sleep(2500); samples.push(JSON.parse(await b.eval(`(() => { const t = f => { const a = performance.now(); f(); return performance.now() - a; }; return JSON.stringify({ message: t(() => FraudShieldMessage.analyzeMessage('Bhai tumhara account block ho gaya hai, KYC update karo is link pe.')), link: t(() => FraudShieldLink.analyzePayload('https://sbi-kyc-update.tk/login')) }); })()`))); }
    first[rate] = { message: Math.max(...samples.map(x => x.message)), link: Math.max(...samples.map(x => x.link)) };
  }
  await b.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const f = x => (x < 0.1 ? '<0.1' : x < 1 ? x.toFixed(2) : x.toFixed(1)).padStart(6) + ' ms';   // the browser timer cannot resolve less than about 0.1 ms
  let ok = true;
  console.log(await b.eval(`navigator.userAgent.match(/Chrome\\/[\\d.]+/)[0] + ', ' + navigator.hardwareConcurrency + ' cores'`) + `; ${messages.length} messages, ${links.length} links and payment codes, 40 repetitions each; name model ${results[1].modelLoaded}`);
  console.log('                          p50        p95        p99        slowest');
  for (const rate of [1, 6]) for (const kind of ['message', 'link']) { const r = results[rate][kind]; console.log(`${(kind + ' check, CPU ' + (rate === 1 ? 'full speed' : 'slowed ' + rate + 'x')).padEnd(48)}${f(r.p50)} ${f(r.p95)} ${f(r.p99)} ${f(r.max)}`); if (r.p95 > 50) ok = false; }
  for (const rate of [1, 6]) { const r = first[rate]; console.log(`${('first verdict after page load, CPU ' + (rate === 1 ? 'full speed' : 'slowed ' + rate + 'x')).padEnd(48)}message ${f(r.message)}   link ${f(r.link)}   (slowest of 3 loads)`); if (r.message > 50 || r.link > 50) ok = false; }
  console.log('SPEC section 5 budget (p95 under 50 ms, and the first verdict too):', ok ? 'met in every row' : 'NOT MET');
  b.close(); site.close(); process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
