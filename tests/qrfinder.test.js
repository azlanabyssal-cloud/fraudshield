'use strict';
// A QR code that cannot be read must not look like a picture with no QR code in it. The finder is measured the way the decoder is: against codes made by an
// independent encoder and damaged like real photos (logos, rotation, tilt, blur, noise, shadow, clutter), and against pictures that are not QR codes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const S = require('./helpers/qrsynth.js');
const F = require('../lib/qrfinder.js');
const QR = require('../lib/qr.js');
const jsQR = require('../vendor/jsqr/jsQR.js');

const PAY = ['upi://pay?pa=refund.desk@ybl&pn=Refund%20Desk&am=4999&cu=INR&tn=claim%20refund', 'upi://pay?pa=shop@okaxis&pn=Ravi%20Kirana&am=250', 'https://sbi-kyc-update.tk/login?id=48213', 'upi://pay?pa=hdfc.support.helpline@ybl&pn=HDFC%20Support&am=1&tn=kyc'];
const code = (p, ec = 'M', px = 6, extra = {}) => S.paint(S.matrix(p, ec), { px, ...extra });

test('the 1:1:3:1:1 ratio test: a finder slice passes, and bars of other proportions, equal bars and a lone block do not', () => {
  assert.ok(F.ratio([10, 10, 30, 10, 10]) > 0); assert.ok(F.ratio([9, 11, 28, 12, 10]) > 0, 'blur and perspective move the runs a little');
  assert.equal(F.ratio([10, 10, 10, 10, 10]), 0, 'a chessboard row'); assert.equal(F.ratio([10, 40, 10, 40, 10]), 0); assert.equal(F.ratio([30, 10, 10, 10, 30]), 0); assert.equal(F.ratio([1, 1, 3, 1, 1].map(x => x * 0.4)), 0, 'too small to be a pattern');
  assert.equal(F.ratio([39, 30, 60, 30, 39], true), 0, 'the halo of a square on a dark ground is not a finder pattern');
});

test('three finder patterns make a QR code only when they are one size, far enough apart, and at the corners of a right-angled triangle', () => {
  const p = (x, y, m = 5, hits = 6) => ({ x, y, m, hits });
  assert.ok(F.triple([p(100, 100), p(300, 100), p(100, 300)]), 'an upright code');
  assert.ok(F.triple([p(200, 300), p(300, 200), p(100, 200)]), 'a code turned 45 degrees');
  assert.equal(F.triple([p(100, 100), p(200, 100), p(300, 100)]), null, 'in a line');
  assert.equal(F.triple([p(100, 100), p(300, 100), p(100, 300, 25)]), null, 'one far larger than the others');
  assert.equal(F.triple([p(100, 100), p(110, 100), p(100, 110)]), null, 'too close together to be the corners of a code');
  assert.equal(F.triple([p(100, 100), p(500, 100), p(110, 200)]), null, 'unequal legs');
  assert.equal(F.pair([p(100, 100), p(300, 100)]) !== null, true); assert.equal(F.pair([p(100, 100, 5, 2), p(300, 100, 5, 2)]), null, 'seen on too few rows to count');
  assert.equal(F.pair([p(100, 100), p(104, 100)]), null);
});

test('a code is recognised however it is damaged short of being destroyed: readable or not, in a page or alone, light on dark too', () => {
  const rows = [
    ['plain', p => code(p)], ['inverted', p => code(p, 'M', 6, { invert: true })], ['rotated 33', p => S.photograph(code(p), { deg: 33 })], ['rotated 90 and tilted', p => S.photograph(code(p), { deg: 90, tilt: 0.3 })],
    ['logo, within what error correction can repair', p => S.withLogo(code(p, 'H'), 0.24)], ['logo too big to repair (ec L)', p => S.withLogo(code(p, 'L'), 0.32)], ['logo too big to repair (ec M, square)', p => S.withLogo(code(p, 'M'), 0.36, { shape: 'square' })],
    ['blurred', p => S.blur(code(p), 4)], ['noisy and shaded', p => S.shaded(S.noisy(code(p), 70))], ['inside a screenshot', p => S.inPage(S.withLogo(code(p, 'H'), 0.22))],
    ['photographed in a page', p => S.inPage(S.photograph(S.withLogo(code(p, 'H'), 0.22), { deg: 12, tilt: 0.18 }), { ox: 100, oy: 350 })]
  ];
  for (const [name, make] of rows) for (const p of PAY) { const f = F.findQrStructure(make(p)); assert.ok(f.qr && f.certainty === 'full', `${name}: ${p.slice(0, 24)} -> ${JSON.stringify({ qr: f.qr, c: f.certainty, finders: f.finders })}`); }
});

test('the finder agrees with the decoder where the decoder cannot help: unreadable codes are still seen', () => {
  const unreadable = PAY.flatMap(p => [S.withLogo(code(p, 'L'), 0.32), S.withLogo(code(p, 'M'), 0.38, { shape: 'square' })]).filter(img => QR.decodeRGBA(img, jsQR) === null);
  assert.ok(unreadable.length >= 6, `${unreadable.length} codes the decoder gave up on`);
  for (const img of unreadable) { const r = QR.inspectRGBA(img, jsQR); assert.equal(r.text, null); assert.ok(r.structure.qr, 'present but unreadable is reported as present'); }
  const readable = QR.inspectRGBA(code(PAY[0]), jsQR); assert.equal(readable.text, PAY[0]); assert.equal(readable.structure.qr, true);
});

test('pictures that are not QR codes are not mistaken for one: blank, noise, text, chequerboard, barcode, squares, gradients, buttons, three plain blocks, and 150 random scenes', () => {
  for (const [name, img] of Object.entries(S.decoys())) assert.equal(F.findQrStructure(img).qr, false, name);
  const rnd = S.rng(5); let fp = 0;
  for (let i = 0; i < 150; i++) { const W = 700, H = 700, im = { data: new Uint8ClampedArray(W * H * 4).fill(235), width: W, height: H }; for (let k = 0; k < 60; k++) { const s = 4 + Math.floor(rnd() * 60); S.fill(im, rnd() * W, rnd() * H, rnd() * W + s, rnd() * H + s, [rnd() * 255, rnd() * 255, rnd() * 255]); } if (F.findQrStructure(i % 2 ? S.noisy(im, 40, i) : im).qr) fp++; }
  assert.equal(fp, 0, `${fp} of 150 random scenes were called QR codes`);
});

test('with one corner missing (torn, covered or out of frame) it is reported as part of a code, not as none', () => {
  const img = code(PAY[0], 'M', 8), side = img.width, torn = S.clone(img);
  S.fill(torn, side * 0.55, side * 0.55, side, side, [255, 255, 255]);   // wipe the lower right: the third finder pattern is at the lower left, wipe that too
  S.fill(torn, 0, side * 0.55, side * 0.45, side, [255, 255, 255]);
  const f = F.findQrStructure(torn); assert.equal(f.qr, true); assert.equal(f.certainty, 'partial'); assert.equal(f.points.length, 2);
  assert.equal(F.findQrStructure(S.decoys().white).certainty, null);
});

test('it is quick, does not choke on odd sizes, and never throws', () => {
  const big = S.inPage(S.photograph(S.withLogo(code(PAY[0], 'H', 8), 0.2), { deg: 20, tilt: 0.2 }), { W: 3000, H: 3000, ox: 500, oy: 700 }), t0 = Date.now();
  assert.ok(F.findQrStructure(big).qr, 'a 3000 x 3000 frame is shrunk and still found'); assert.ok(Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
  for (const bad of [null, undefined, {}, { data: new Uint8ClampedArray(3), width: 10, height: 10 }, { data: new Uint8ClampedArray(4), width: 1, height: 1 }, { data: new Uint8ClampedArray(0), width: 0, height: 0 }, S.decoys(1, 1).white, { data: new Uint8ClampedArray(4 * 5 * 5), width: 5, height: 5 }]) assert.doesNotThrow(() => F.findQrStructure(bad));
  assert.equal(F.findQrStructure(null).qr, false); assert.deepEqual(F.findQrStructure({}).points, []);
  const again = F.findQrStructure(code(PAY[1])), same = F.findQrStructure(code(PAY[1])); assert.deepEqual(again, same, 'deterministic');
});

test('over a seeded batch of photographed codes the finder sees more codes than the decoder reads, and calls none of 150 decoys a code', () => {
  const rnd = S.rng(2026), pick = a => a[Math.floor(rnd() * a.length)]; let readable = 0, seen = 0, unreadable = 0, unreadableSeen = 0; const N = 120;
  for (let i = 0; i < N; i++) {
    const p = pick(PAY), ec = pick(['M', 'Q', 'H']), maxLogo = { M: 0.18, Q: 0.24, H: 0.3 }[ec];
    let img = code(p, ec, pick([4, 6, 8]), { invert: rnd() < 0.15 }); const logo = pick([0, 0, 0.12, 0.18, 0.24].filter(x => x <= maxLogo + 0.01)); if (logo) img = S.withLogo(img, logo, { shape: pick(['disc', 'square']) });
    img = S.photograph(img, { deg: rnd() * 360, tilt: rnd() * 0.3 }); const bl = pick([0, 0, 1, 2]); if (bl) img = S.blur(img, bl); if (rnd() < 0.5) img = S.noisy(img, pick([30, 60, 90])); if (rnd() < 0.4) img = S.shaded(img); if (rnd() < 0.5) img = S.inPage(img, { ox: Math.floor(rnd() * 200), oy: Math.floor(rnd() * 300) });
    const r = QR.inspectRGBA(img, jsQR), ok = r.text === p; if (ok) readable++; if (r.structure.qr) seen++; if (!ok) { unreadable++; if (r.structure.qr) unreadableSeen++; }
  }
  assert.ok(readable / N >= 0.88, `decoded ${readable}/${N}`); assert.ok(seen / N >= 0.92, `structure seen ${seen}/${N}`); assert.ok(seen >= readable, 'the finder never sees fewer codes than the decoder reads');
  assert.ok(unreadable === 0 || unreadableSeen / unreadable >= 0.7, `of ${unreadable} unreadable codes, ${unreadableSeen} were still seen`);
});

test('screenshots of plain text are not mistaken for a QR code: fourteen real-browser renderings (light and dark ground, five fonts, two sizes) that the earlier finder called a code', () => {
  // Rendered by Chrome's own text engine, which no synthetic image reproduces. The earlier finder (a 1:1:3:1:1 run on a row, a column and a diagonal) called 520 of 3,800 such
  // renderings a code, and the assistant then refused to read the words ("do not scan it"). A finder must be a ring pattern in all directions, a timing line or a dense data area
  // must join it to the others, and the area they span must be dense as a code's is.
  const { PNG } = require('pngjs'), dir = path.join(__dirname, 'fixtures', 'text_not_qr'), files = fs.readdirSync(dir).filter(f => f.endsWith('.png'));
  assert.ok(files.length >= 12, `${files.length} fixtures`);
  for (const f of files) {
    const png = PNG.sync.read(fs.readFileSync(path.join(dir, f))), img = { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
    assert.equal(F.findQrStructure(img).qr, false, f);
    const r = QR.inspectRGBA(img, jsQR); assert.equal(r.text, null, f); assert.equal(r.structure.qr, false, f);
  }
});

test('the three measures behind it: a real finder is a ring, a code has a timing line between its finders, and its data area is about half dark', () => {
  const img = code(PAY[0], 'M', 6), base = F.shrink(F.luminance(img), img.width, img.height, 1000), bin = F.binarize(base.g, base.w, base.h, false);
  const c = F.scanFinders(bin, base.w, base.h, false);
  assert.equal(c.length, 3, 'three rings, and nothing else, in a clean code');
  const [tl, tr, bl] = [...c].sort((a, b) => a.x + a.y - (b.x + b.y)).slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
  assert.equal(F.linked(bin, base.w, base.h, tl, tr), true, 'a timing line runs along the top');
  assert.equal(F.linked(bin, base.w, base.h, tl, bl), true, 'and down the left');
  assert.equal(F.linked(bin, base.w, base.h, tr, bl), false, 'but not across the diagonal');
  const d = F.density(bin, base.w, base.h, c); assert.ok(d >= 0.4 && d <= 0.7, `data area ${d}`);
  // a blank page, a lone ring and a chessboard make none of the three
  const blank = S.decoys().white, b2 = F.shrink(F.luminance(blank), blank.width, blank.height, 1000);
  assert.equal(F.scanFinders(F.binarize(b2.g, b2.w, b2.h, false), b2.w, b2.h, false).length, 0);
});
