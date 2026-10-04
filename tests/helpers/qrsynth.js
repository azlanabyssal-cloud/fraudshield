'use strict';
/* Builds QR codes the way scam posters and screenshots really look, so the reader can be measured against them: an independent encoder (the qrcode package)
   makes the code, and the damage is applied to pixels. Pure functions over { data: RGBA, width, height }. */
const QRCode = require('qrcode');

const rng = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

function matrix(text, ec = 'M') {
  const q = QRCode.create(text, { errorCorrectionLevel: ec }), n = q.modules.size;
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (q.modules.data[r * n + c] ? 1 : 0)));
}

function paint(m, { px = 6, quiet = 4, invert = false } = {}) {
  const side = (m.length + 2 * quiet) * px, data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const r = Math.floor(y / px) - quiet, c = Math.floor(x / px) - quiet, dark = r >= 0 && c >= 0 && r < m.length && c < m.length && m[r][c] === 1, v = dark !== invert ? 0 : 255, i = (y * side + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  return { data, width: side, height: side };
}

const clone = img => ({ data: new Uint8ClampedArray(img.data), width: img.width, height: img.height });
function fill(img, x0, y0, x1, y1, [r, g, b]) { for (let y = Math.max(0, y0 | 0); y < Math.min(img.height, y1 | 0); y++) for (let x = Math.max(0, x0 | 0); x < Math.min(img.width, x1 | 0); x++) { const i = (y * img.width + x) * 4; img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; } }

// A brand logo in the middle: a white-bordered coloured disc (or square) covering `fraction` of the code's WIDTH (so 0.25 hides about 6% of its modules' area... of the code area it is fraction squared).
function withLogo(img, fraction, { shape = 'disc', colour = [0, 90, 200] } = {}) {
  const out = clone(img), cx = img.width / 2, cy = img.height / 2, rad = fraction * img.width / 2, border = Math.max(2, rad * 0.14);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const dx = Math.abs(x - cx), dy = Math.abs(y - cy), d = shape === 'disc' ? Math.hypot(dx, dy) : Math.max(dx, dy), i = (y * img.width + x) * 4;
    const col = d <= rad - border ? colour : d <= rad ? [255, 255, 255] : null;
    if (col) { out.data[i] = col[0]; out.data[i + 1] = col[1]; out.data[i + 2] = col[2]; }
  }
  return out;
}

// Inverse-mapped bilinear sampling through a 3x3 homography H (output -> source), on a white canvas of the given size.
function warp(img, H, W, Hh) {
  const out = { data: new Uint8ClampedArray(W * Hh * 4).fill(255), width: W, height: Hh };
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const d = H[6] * x + H[7] * y + H[8], sx = (H[0] * x + H[1] * y + H[2]) / d, sy = (H[3] * x + H[4] * y + H[5]) / d;
    if (sx < 0 || sy < 0 || sx >= img.width - 1 || sy >= img.height - 1) continue;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0, o = (y * W + x) * 4;
    for (let ch = 0; ch < 3; ch++) {
      const a = img.data[(y0 * img.width + x0) * 4 + ch], b = img.data[(y0 * img.width + x0 + 1) * 4 + ch], c = img.data[((y0 + 1) * img.width + x0) * 4 + ch], dd = img.data[((y0 + 1) * img.width + x0 + 1) * 4 + ch];
      out.data[o + ch] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + dd * fx * fy;
    }
    out.data[o + 3] = 255;
  }
  return out;
}
const mul3 = (p, q) => [0, 1, 2].flatMap(r => [0, 1, 2].map(c => p[r * 3] * q[c] + p[r * 3 + 1] * q[3 + c] + p[r * 3 + 2] * q[6 + c]));

// A photo taken at an angle: rotate by `deg` in the plane, then tilt so one edge is `tilt` (0..0.5) nearer the camera than the other.
function photograph(img, { deg = 0, tilt = 0, pad = 0.25 } = {}) {
  const W = Math.round(img.width * (1 + 2 * pad)), Hh = Math.round(img.height * (1 + 2 * pad)), cx = W / 2, cy = Hh / 2, t = deg * Math.PI / 180, cos = Math.cos(t), sin = Math.sin(t);
  const toSrc = [cos, sin, -cos * cx - sin * cy + img.width / 2, -sin, cos, sin * cx - cos * cy + img.height / 2, 0, 0, 1];   // rotation about the centre, output -> source
  const persp = [1, 0, 0, 0, 1, 0, 0, tilt / Hh, 1 - tilt * cy / Hh];                                                          // vertical foreshortening in output space
  return warp(img, mul3(toSrc, persp), W, Hh);
}

const blur = (img, r) => {
  let cur = img;
  for (let pass = 0; pass < r; pass++) {
    const data = new Uint8ClampedArray(cur.data);
    for (let y = 1; y < cur.height - 1; y++) for (let x = 1; x < cur.width - 1; x++) for (let ch = 0; ch < 3; ch++) { let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += cur.data[((y + dy) * cur.width + x + dx) * 4 + ch]; data[(y * cur.width + x) * 4 + ch] = s / 9; }
    cur = { ...cur, data };
  }
  return cur;
};
const noisy = (img, amount, seed = 7) => { const rnd = rng(seed), data = new Uint8ClampedArray(img.data); for (let i = 0; i < data.length; i += 4) { const d = (rnd() - 0.5) * amount; data[i] += d; data[i + 1] += d; data[i + 2] += d; } return { ...img, data }; };
const shaded = img => { const data = new Uint8ClampedArray(img.data); for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) { const k = 0.45 + 0.55 * (x / img.width) * (0.6 + 0.4 * y / img.height), i = (y * img.width + x) * 4; data[i] *= k; data[i + 1] *= k; data[i + 2] *= k; } return { ...img, data }; };

// The code placed into a larger "screenshot" or "poster": text-like bars around it. Optionally tinted modules (a coloured code).
function inPage(code, { W = 1080, H = 1500, ox = 260, oy = 480, bg = 246, bars = true } = {}) {
  const data = new Uint8ClampedArray(W * H * 4).fill(bg); for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const page = { data, width: W, height: H };
  if (bars) for (let k = 0; k < 14; k++) fill(page, 60, 40 + k * 28, 60 + (k % 3) * 200 + 500, 52 + k * 28, [60, 60, 60]);
  for (let y = 0; y < code.height && oy + y < H; y++) for (let x = 0; x < code.width && ox + x < W; x++) { const s = (y * code.width + x) * 4, d = ((oy + y) * W + ox + x) * 4; page.data[d] = code.data[s]; page.data[d + 1] = code.data[s + 1]; page.data[d + 2] = code.data[s + 2]; }
  return page;
}

// Things that are not QR codes, for the "must not cry wolf" side.
function decoys(W = 900, H = 900) {
  const rnd = rng(99), blank = () => ({ data: new Uint8ClampedArray(W * H * 4).fill(240), width: W, height: H }), list = {};
  list.white = blank();
  list.noise = noisy(blank(), 255, 3);
  list.textBars = (() => { const i = blank(); for (let k = 0; k < 25; k++) fill(i, 40, 30 + k * 32, 40 + 300 + (k * 53) % 450, 44 + k * 32, [30, 30, 30]); return i; })();
  list.checker = (() => { const i = blank(); for (let y = 0; y < H; y += 30) for (let x = 0; x < W; x += 30) if (((x + y) / 30) % 2 === 0) fill(i, x, y, x + 30, y + 30, [20, 20, 20]); return i; })();
  list.barcode = (() => { const i = blank(); let x = 80; while (x < W - 80) { const w = 3 + Math.floor(rnd() * 9); fill(i, x, 300, x + w, 560, [10, 10, 10]); x += w + 3 + Math.floor(rnd() * 9); } return i; })();
  list.randomSquares = (() => { const i = blank(); for (let k = 0; k < 150; k++) { const s = 20 + rnd() * 60, x = rnd() * (W - s), y = rnd() * (H - s); fill(i, x, y, x + s, y + s, [rnd() * 255, rnd() * 255, rnd() * 255]); } return i; })();
  list.gradient = (() => { const i = blank(); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = 255 * (x + y) / (W + H), o = (y * W + x) * 4; i.data[o] = v; i.data[o + 1] = 255 - v; i.data[o + 2] = 128; } return i; })();
  list.bigButtons = (() => { const i = blank(); fill(i, 100, 100, 400, 220, [0, 120, 255]); fill(i, 100, 300, 400, 420, [0, 0, 0]); fill(i, 500, 100, 800, 220, [0, 0, 0]); fill(i, 500, 300, 800, 420, [200, 30, 30]); return i; })();
  list.threeBlobs = (() => { const i = blank(); for (const [x, y] of [[100, 100], [700, 100], [100, 700]]) { fill(i, x, y, x + 120, y + 120, [0, 0, 0]); fill(i, x + 30, y + 30, x + 90, y + 90, [255, 255, 255]); } return i; })();   // three squares in a corner arrangement but not finder-shaped
  return list;
}

module.exports = { rng, matrix, paint, clone, fill, withLogo, warp, photograph, blur, noisy, shaded, inPage, decoys };
