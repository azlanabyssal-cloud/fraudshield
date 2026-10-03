'use strict';
// QR reading, checked against QR codes generated here by an independent encoder (the qrcode package), then damaged in the
// ways real photos and screenshots are: scaled, inverted, rotated, noisy, unevenly lit, blurred, on a transparent background.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const QRCode = require('qrcode');
const { PNG } = require('pngjs');
const jsQR = require('../vendor/jsqr/jsQR.js');
const QR = require('../lib/qr.js');
const L = require('../lib/linkcheck.js');

const decode = img => QR.decodeRGBA(img, jsQR);
const rng = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

function matrix(text, ec = 'M') {
  const q = QRCode.create(text, { errorCorrectionLevel: ec }), n = q.modules.size;
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.modules.data[r * n + c] ? 1 : 0));
}
const rotate = m => m.map((_, r) => m.map((__, c) => m[m.length - 1 - c][r]));

// Draws a module matrix as RGBA: px pixels per module, a quiet zone of 4 modules, optional colour inversion.
function paint(m, { px = 6, quiet = 4, invert = false } = {}) {
  const side = (m.length + 2 * quiet) * px, data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const r = Math.floor(y / px) - quiet, c = Math.floor(x / px) - quiet;
      const dark = r >= 0 && c >= 0 && r < m.length && c < m.length && m[r][c] === 1;
      const v = dark !== invert ? 0 : 255, i = (y * side + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return { data, width: side, height: side };
}
const noisy = (img, amount, seed) => {
  const rnd = rng(seed), data = new Uint8ClampedArray(img.data);
  for (let i = 0; i < data.length; i += 4) { const d = (rnd() - 0.5) * amount; data[i] += d; data[i + 1] += d; data[i + 2] += d; }
  return { ...img, data };
};
const shaded = img => {
  const data = new Uint8ClampedArray(img.data);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) { const k = 0.5 + 0.5 * (x / img.width) * (0.6 + 0.4 * y / img.height), i = (y * img.width + x) * 4; data[i] *= k; data[i + 1] *= k; data[i + 2] *= k; }
  return { ...img, data };
};
const blurred = img => {
  const data = new Uint8ClampedArray(img.data);
  for (let y = 1; y < img.height - 1; y++) for (let x = 1; x < img.width - 1; x++) for (let ch = 0; ch < 3; ch++) {
    let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += img.data[((y + dy) * img.width + x + dx) * 4 + ch];
    data[(y * img.width + x) * 4 + ch] = s / 9;
  }
  return { ...img, data };
};
// A code placed inside a larger "screenshot": off-centre, among bars that stand in for text and buttons.
function inScreenshot(code, W = 1080, H = 1500) {
  const data = new Uint8ClampedArray(W * H * 4).fill(246);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (let k = 0; k < 14; k++) for (let y = 40 + k * 28; y < 52 + k * 28; y++) for (let x = 60; x < 60 + (k % 3) * 200 + 500; x++) { const i = (y * W + x) * 4; data[i] = data[i + 1] = data[i + 2] = 60; }
  const ox = 260, oy = 480;
  for (let y = 0; y < code.height; y++) for (let x = 0; x < code.width; x++) { const s = (y * code.width + x) * 4, d = ((oy + y) * W + ox + x) * 4; data[d] = code.data[s]; data[d + 1] = code.data[s + 1]; data[d + 2] = code.data[s + 2]; }
  return { data, width: W, height: H };
}

const PAYLOADS = [
  'https://sbi.bank.in/', 'upi://pay?pa=ravi.stores@oksbi&pn=Ravi%20Stores&am=120&cu=INR', 'https://www.irctc.co.in/nget/train-search',
  'https://sbi-kyc-update.tk/login?ref=' + 'a1b2c3'.repeat(40), 'upi://pay?pa=refund@ybl&pn=Refund%20Desk&tn=claim%20refund', 'नमस्ते: ₹500 का इनाम', 'WIFI:S:home;T:WPA;P:secret;;', 'x'
];

test('a QR code from an independent encoder, saved as PNG, decodes exactly', async () => {
  for (const text of PAYLOADS) {
    const png = PNG.sync.read(await QRCode.toBuffer(text, { type: 'png', width: 320, margin: 3 }));
    assert.equal(decode({ data: new Uint8ClampedArray(png.data), width: png.width, height: png.height }), text.slice(0, QR.MAX_TEXT));
  }
});

test('size does not matter: 2 to 14 pixels per module, and a frame so large it must be shrunk first', () => {
  const text = PAYLOADS[1], m = matrix(text);
  for (const px of [3, 4, 6, 9, 14]) assert.equal(decode(paint(m, { px })), text, `${px}px per module`);
  const huge = paint(m, { px: 60 }); assert.ok(huge.width > QR.MAX_SIDE);
  assert.equal(decode(huge), text, 'a frame of ' + huge.width + 'px');
});

test('light-on-dark codes, and every rotation, decode', () => {
  const text = PAYLOADS[4];
  assert.equal(decode(paint(matrix(text), { px: 6, invert: true })), text);
  let m = matrix(text); for (let k = 0; k < 4; k++, m = rotate(m)) assert.equal(decode(paint(m, { px: 6 })), text, `rotated ${k * 90} degrees`);
});

test('noise, uneven light and blur, separately and together, do not defeat the decoder', () => {
  const text = PAYLOADS[1], base = paint(matrix(text, 'Q'), { px: 8 });
  assert.equal(decode(noisy(base, 90, 1)), text, 'sensor noise');
  assert.equal(decode(shaded(base)), text, 'shadow across the code');
  assert.equal(decode(blurred(base)), text, 'out of focus');
  assert.equal(decode(blurred(shaded(noisy(base, 60, 2)))), text, 'all three');
});

test('a code inside a full screenshot among text-like bars is found', () => {
  for (const text of [PAYLOADS[0], PAYLOADS[4]]) assert.equal(decode(inScreenshot(paint(matrix(text), { px: 7 }))), text);
});

test('a code on a transparent background is read as black on white, not as a black square', () => {
  const text = PAYLOADS[2], img = paint(matrix(text), { px: 6 });
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i] === 255) { img.data[i + 3] = 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = 0; }
  assert.equal(decode(img), text);
});

test('there is no code to find in a blank frame, in noise, or in text-like stripes, and the decoder never invents one', () => {
  const rnd = rng(99), side = 400, n = side * side * 4;
  const blank = new Uint8ClampedArray(n).fill(255), grain = new Uint8ClampedArray(n), stripes = new Uint8ClampedArray(n).fill(255);
  for (let i = 0; i < n; i += 4) { grain[i] = grain[i + 1] = grain[i + 2] = rnd() * 255; grain[i + 3] = 255; }
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) if (Math.floor(y / 7) % 2 === 0 && x > 30 && x < 360) stripes[(y * side + x) * 4] = stripes[(y * side + x) * 4 + 1] = stripes[(y * side + x) * 4 + 2] = 0;
  for (const d of [blank, grain, stripes]) assert.equal(decode({ data: d, width: side, height: side }), null);
});

test('malformed input and a failing decoder return null instead of throwing', () => {
  for (const bad of [null, undefined, {}, { data: new Uint8ClampedArray(4), width: 10, height: 10 }, { data: new Uint8ClampedArray(16), width: 0, height: 4 }, { data: new Uint8ClampedArray(16), width: 2, height: 2 }]) assert.equal(decode(bad), null);
  const img = paint(matrix('hello'), { px: 6 });
  assert.equal(QR.decodeRGBA(img, () => { throw new Error('boom'); }), null);
  assert.equal(QR.decodeRGBA(img, () => ({ data: 12345 })), null);
  assert.equal(QR.decodeRGBA(img, () => ({ data: 'y'.repeat(QR.MAX_TEXT * 3) })).length, QR.MAX_TEXT, 'an absurdly long payload is cut');
});

test('resampling keeps flat colour flat, averages a fine grid to its mean, and returns the size asked for', () => {
  const flat = { data: new Uint8ClampedArray(40 * 30 * 4).fill(200), width: 40, height: 30 };
  const f = QR.resample(flat, 0.5); assert.deepEqual([f.width, f.height], [20, 15]); assert.ok(f.data.every((v, i) => i % 4 === 3 ? v === 255 : v === 200));
  const grid = { data: new Uint8ClampedArray(16 * 16 * 4), width: 16, height: 16 };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const i = (y * 16 + x) * 4, v = (x + y) % 2 ? 255 : 0; grid.data[i] = grid.data[i + 1] = grid.data[i + 2] = v; grid.data[i + 3] = 255; }
  const g = QR.resample(grid, 0.5); for (let i = 0; i < g.data.length; i += 4) assert.ok(Math.abs(g.data[i] - 127.5) < 1);
  assert.deepEqual([QR.resample(flat, 0.001).width, QR.resample(flat, 0.001).height], [1, 1]);
});

test('end to end: what a QR holds goes through the analyzer and gets the right verdict', () => {
  const read = text => L.analyzePayload(decode(paint(matrix(text), { px: 6 })));
  assert.equal(read('upi://pay?pa=refund@ybl&pn=Refund%20Desk&tn=claim%20refund').level, 'scam');
  assert.equal(read('https://sbi-kyc-update.tk/login').level, 'scam');
  assert.equal(read('https://sbi.bank.in/').level, 'official');
  assert.equal(read('upi://pay?pa=ravi.stores@oksbi&pn=Ravi%20Stores&am=120').level, 'unverified');
  assert.equal(read('WIFI:S:home;T:WPA;P:secret;;').kind, 'other');
});

test('the vendored decoder is the exact file that was reviewed, with its licence beside it', () => {
  const dir = path.join(__dirname, '..', 'vendor', 'jsqr'), [want, name] = fs.readFileSync(path.join(dir, 'SHA256'), 'utf8').trim().split(/\s+/);
  assert.equal(name, 'jsQR.js'); assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex'), want);
  assert.equal(fs.readFileSync(path.join(dir, 'VERSION'), 'utf8').trim(), '1.4.0');
  assert.match(fs.readFileSync(path.join(dir, 'LICENSE.md'), 'utf8'), /Apache License/);
});
