/* FraudShield QR reading. The decoding itself is jsQR (vendor/jsqr, Apache-2.0), loaded only the first time someone
   attaches an image. This file adds what a phone photo or a screenshot needs on top of it: transparent backgrounds,
   huge frames, inverted codes, and a browser wrapper. Everything runs on the device; the image is never uploaded.
   The pixel logic is pure so the same code is tested in Node against generated QR codes. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FraudShieldQR = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const GLOBAL = typeof self !== 'undefined' ? self : {};
const MAX_SIDE = 1400;     // a bigger frame only makes the decoder slower, not better
const MIN_SIDE = 60;       // below this a QR code (at least 21 modules) cannot be resolved
const MAX_TEXT = 2000;     // a QR code can hold far more than any real payment or web address

const hasAlpha = img => { for (let i = 3; i < img.data.length; i += 4) if (img.data[i] !== 255) return true; return false; };

// Transparent pixels would read as black and hide a code drawn on a transparent background; put the image on white.
function flatten(img) {
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3] / 255;
    out[i] = img.data[i] * a + 255 * (1 - a); out[i + 1] = img.data[i + 1] * a + 255 * (1 - a); out[i + 2] = img.data[i + 2] * a + 255 * (1 - a); out[i + 3] = 255;
  }
  return { data: out, width: img.width, height: img.height };
}

// Area-average resize. Averaging (rather than skipping pixels) is what lets a fine screen grid or print texture
// blur away instead of breaking the code's finder patterns.
function resample(img, scale) {
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  const out = new Uint8ClampedArray(w * h * 4), sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.min(img.height, Math.max(y0 + 1, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.min(img.width, Math.max(x0 + 1, Math.ceil((x + 1) * sx)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) { const i = (yy * img.width + xx) * 4; r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++; }
      }
      const o = (y * w + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

// img: { data: Uint8ClampedArray (RGBA), width, height }; decoder: the jsQR function. Returns the text, or null.
function decodeRGBA(img, decoder) {
  if (!img || !img.data || !(img.width > 0) || !(img.height > 0) || img.data.length < img.width * img.height * 4) return null;
  const base = hasAlpha(img) ? flatten(img) : img;
  const cap = Math.min(1, MAX_SIDE / Math.max(base.width, base.height));
  for (const scale of [cap, cap / 2, cap / 4]) {
    if (Math.min(base.width, base.height) * scale < MIN_SIDE) break;
    const frame = scale === 1 ? base : resample(base, scale);
    let hit;
    try { hit = decoder(frame.data, frame.width, frame.height, { inversionAttempts: 'attemptBoth' }); } catch (e) { continue; }
    if (hit && typeof hit.data === 'string' && hit.data.length) return hit.data.slice(0, MAX_TEXT);
  }
  return null;
}

/* ---------- browser side ---------- */
let decoderPromise = null;
function loadDecoder(url) {
  if (typeof GLOBAL.jsQR === 'function') return Promise.resolve(GLOBAL.jsQR);
  if (decoderPromise) return decoderPromise;
  decoderPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url || 'vendor/jsqr/jsQR.js'; s.async = true;
    s.onload = () => (typeof GLOBAL.jsQR === 'function' ? resolve(GLOBAL.jsQR) : reject(new Error('qr-decoder-missing')));
    s.onerror = () => { decoderPromise = null; reject(new Error('qr-decoder-load-failed')); };
    document.head.appendChild(s);
  });
  return decoderPromise;
}

function pixelsOf(file) {
  const draw = (source, w, h) => {
    const k = Math.min(1, MAX_SIDE / Math.max(w, h)), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch); ctx.drawImage(source, 0, 0, cw, ch);
    return ctx.getImageData(0, 0, cw, ch);
  };
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file).then(bmp => { try { return draw(bmp, bmp.width, bmp.height); } finally { if (bmp.close) bmp.close(); } });
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { try { resolve(draw(img, img.naturalWidth, img.naturalHeight)); } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); } };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image-unreadable')); };
    img.src = url;
  });
}

// Resolves to the text inside the first QR code found in an image file, or null if there is none.
function scan(file, opts) {
  return Promise.all([loadDecoder(opts && opts.decoderUrl), pixelsOf(file)]).then(([decoder, pixels]) => decodeRGBA(pixels, decoder));
}

return { decodeRGBA, resample, flatten, scan, MAX_SIDE, MAX_TEXT };
}));
