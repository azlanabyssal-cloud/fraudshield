#!/usr/bin/env node
'use strict';
/* Measures the QR reader on a seeded batch of synthetic photographed codes: how many the decoder reads, how many the finder sees (a code is PRESENT), and how many
   of the unreadable ones are still seen; plus false positives on pictures that are not QR codes. Codes come from an independent encoder (the qrcode package) and are
   damaged with logos, rotation, tilt, blur, noise, shadow and page clutter (tests/helpers/qrsynth.js). "extreme" pushes past what any decoder can recover.
   Usage: SEED=7 node scripts/qr_eval.js   (npm run bench:qrcorpus) */
const S = require('../tests/helpers/qrsynth.js'), QR = require('../lib/qr.js'), jsQR = require('../vendor/jsqr/jsQR.js'), F = require('../lib/qrfinder.js');
const PAY = ['upi://pay?pa=refund.desk@ybl&pn=Refund%20Desk&am=4999&cu=INR&tn=claim%20refund', 'upi://pay?pa=shop@okaxis&pn=Ravi%20Kirana&am=250', 'https://sbi-kyc-update.tk/login?id=48213', 'upi://pay?pa=9876543210@paytm&pn=Paytm%20Merchant', 'https://paytm.com/x/1234567890abcdef', 'upi://pay?pa=hdfc.support.helpline@ybl&pn=HDFC%20Support&am=1&tn=kyc'];
const seed = Number(process.env.SEED || 2026), N = Number(process.env.N || 200), rnd = S.rng(seed), pick = a => a[Math.floor(rnd() * a.length)];

function make(level) {
  const p = pick(PAY), extreme = level === 'extreme', ec = extreme ? pick(['L', 'M', 'Q', 'H']) : pick(['M', 'Q', 'H']), maxLogo = { L: 0.12, M: 0.18, Q: 0.24, H: 0.3 }[ec];
  let img = S.paint(S.matrix(p, ec), { px: extreme ? pick([2, 3, 4, 6]) : pick([4, 6, 8]), invert: rnd() < 0.15 });
  const logo = extreme ? pick([0, 0.2, 0.28, 0.34, 0.4]) : pick([0, 0, 0.12, 0.18, 0.24].filter(x => x <= maxLogo + 0.01)); if (logo) img = S.withLogo(img, logo, { shape: pick(['disc', 'square']) });
  img = S.photograph(img, { deg: rnd() * 360, tilt: extreme ? rnd() * 0.5 : rnd() * 0.3 }); const bl = extreme ? pick([0, 1, 2, 3, 4]) : pick([0, 0, 1, 2]); if (bl) img = S.blur(img, bl);
  if (rnd() < 0.5) img = S.noisy(img, pick([30, 60, 90])); if (rnd() < 0.4) img = S.shaded(img); if (rnd() < 0.5) img = S.inPage(img, { ox: Math.floor(rnd() * 200), oy: Math.floor(rnd() * 300) });
  return { img, p };
}
const rows = [];
for (const level of ['moderate', 'extreme']) {
  let read = 0, seen = 0, unread = 0, unreadSeen = 0, partial = 0, ms = 0;
  for (let i = 0; i < N; i++) { const c = make(level), t0 = Date.now(), r = QR.inspectRGBA(c.img, jsQR); ms += Date.now() - t0; const ok = r.text === c.p; if (ok) read++; if (r.structure.qr) { seen++; if (r.structure.certainty === 'partial') partial++; } if (!ok) { unread++; if (r.structure.qr) unreadSeen++; } }
  rows.push({ level, codes: N, read, seen, unreadable: unread, unreadableSeen: unreadSeen, partialOnly: partial, avgMs: +(ms / N).toFixed(1) });
}
let fp = 0, n = 0;
for (const img of Object.values(S.decoys())) { n++; if (F.findQrStructure(img).qr) fp++; }
for (let i = 0; i < 150; i++) { const W = 700, H = 700, im = { data: new Uint8ClampedArray(W * H * 4).fill(235), width: W, height: H }; for (let k = 0; k < 60; k++) { const s = 4 + Math.floor(rnd() * 60); S.fill(im, rnd() * W, rnd() * H, rnd() * W + s, rnd() * H + s, [rnd() * 255, rnd() * 255, rnd() * 255]); } n++; if (F.findQrStructure(i % 2 ? S.noisy(im, 40, i) : im).qr) fp++; }
console.log(`seed ${seed}`); for (const r of rows) console.log(`${r.level.padEnd(9)} codes ${r.codes}: read ${r.read} (${(100 * r.read / r.codes).toFixed(1)}%), present-and-seen ${r.seen} (${(100 * r.seen / r.codes).toFixed(1)}%), of ${r.unreadable} unreadable still seen ${r.unreadableSeen}, ${r.avgMs} ms each`);
console.log(`decoys: ${fp} false positives in ${n} pictures that are not QR codes`);
process.exit(fp === 0 ? 0 : 1);
