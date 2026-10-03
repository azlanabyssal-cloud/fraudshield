/* Gets a photo ready for the text reader without ever holding the whole photo in memory.
   A phone camera frame is 12 to 48 megapixels. Decoded, that is 48 to 192 MB of pixels before the reader has done anything, and the reader
   (a WebAssembly engine) then copies and transforms it several times over. On a mid-range phone that kills the tab. So:
     1. headerSize() reads the width and height from the first bytes of the file (JPEG, PNG, WebP, GIF) without decoding anything;
     2. the browser is asked to decode at reduced size (createImageBitmap with a target size), so the full frame is never allocated;
     3. plan() then sets the final size from a pixel budget, and the picture is drawn once onto a white canvas and exported as a JPEG.
   The limit is a pixel budget and a long-side cap, not "1080 pixels": a phone screenshot is 1080 x 2400, and shrinking its long side to 1080
   would halve the height of the text the reader has to recognise. 2.8 million pixels keeps a full screenshot at full size and cuts a 12 MP
   photo to a quarter of its pixels. Pure functions are tested in Node; prepare() needs a browser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FraudShieldImagePrep = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const MAX_PIXELS = 2800000;     // what the reader gets at most (a 1080 x 2400 screenshot is 2.59 million and passes untouched)
const MAX_SIDE = 2600;          // and no side longer than this
const REFUSE_PIXELS = 150e6;    // a header claiming more than this is a decompression bomb or damage, not a photo
const JPEG_QUALITY = 0.9;

const u16be = (b, i) => (b[i] << 8) | b[i + 1], u32be = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u16le = (b, i) => b[i] | (b[i + 1] << 8), u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

// { width, height } read from the start of the file, or null when the format or the bytes are not recognised. Never throws, never reads past the end.
function headerSize(b) {
  if (!b || b.length < 12) return null;
  const ok = (w, h) => (Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 ? { width: w, height: h } : null);
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return b.length >= 24 ? ok(u32be(b, 16), u32be(b, 20)) : null;   // PNG: IHDR
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return ok(u16le(b, 6), u16le(b, 8));                                              // GIF
  if (b[0] === 0xff && b[1] === 0xd8) {                                                                                                  // JPEG: walk the markers to a start-of-frame
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = u16be(b, i + 2);
      if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return ok(u16be(b, i + 7), u16be(b, i + 5));
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {   // WebP
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === 'VP8X' && b.length >= 30) return ok(u24le(b, 24) + 1, u24le(b, 27) + 1);
    if (kind === 'VP8 ' && b.length >= 30) return ok(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
    if (kind === 'VP8L' && b.length >= 25 && b[20] === 0x2f) { const v = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0; return ok((v & 0x3fff) + 1, ((v >>> 14) & 0x3fff) + 1); }
  }
  return null;
}

// The size to hand the reader: never larger than the original, within the pixel budget and the long-side cap, proportions kept.
function plan(width, height, limits) {
  const maxPixels = (limits && limits.maxPixels) || MAX_PIXELS, maxSide = (limits && limits.maxSide) || MAX_SIDE;
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width * height > REFUSE_PIXELS) return { refused: true, width, height, scale: 0 };
  const scale = Math.min(1, maxSide / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
  return { refused: false, scale, width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), shrunk: scale < 1 };
}

const fail = code => { const e = new Error(code); e.code = code; return e; };

// Browser: File/Blob -> Promise<Blob> (a JPEG within the budget). Rejects with .code 'too-large' | 'unreadable'. env lets tests substitute the browser.
function prepare(file, env) {
  const win = env || (typeof window !== 'undefined' ? window : null);
  if (!win) return Promise.reject(fail('unreadable'));
  const head = file.slice(0, 65536);
  return (head.arrayBuffer ? head.arrayBuffer() : Promise.reject(new Error('no-arrayBuffer')))
    .then(buf => new Uint8Array(buf), () => null)
    .then(bytes => {
      const dims = bytes && headerSize(bytes), first = dims && plan(dims.width, dims.height);
      if (first && first.refused) throw fail('too-large');
      // Ask for a reduced decode up front, so that a 48 MP frame is never allocated in full. Without a size we decode normally.
      const opts = { imageOrientation: 'from-image' };
      if (first && first.shrunk) { opts.resizeWidth = first.width; opts.resizeQuality = 'medium'; }
      if (typeof win.createImageBitmap === 'function') return win.createImageBitmap(file, opts).catch(() => win.createImageBitmap(file));
      return decodeWithImageElement(file, win);
    })
    .catch(err => { throw err && err.code ? err : fail('unreadable'); })
    .then(src => {
      const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight, p = plan(w, h);
      if (!p || p.refused) { if (src.close) src.close(); throw fail(p && p.refused ? 'too-large' : 'unreadable'); }
      const canvas = win.document.createElement('canvas'); canvas.width = p.width; canvas.height = p.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { if (src.close) src.close(); throw fail('unreadable'); }
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, p.width, p.height);   // a JPEG has no transparency: a transparent screenshot must not turn black
      ctx.drawImage(src, 0, 0, p.width, p.height);
      if (src.close) src.close();
      return new Promise((resolve, reject) => canvas.toBlob(blob => { canvas.width = canvas.height = 0; blob ? resolve(blob) : reject(fail('unreadable')); }, 'image/jpeg', JPEG_QUALITY));
    });
}

function decodeWithImageElement(file, win) {
  return new Promise((resolve, reject) => {
    const url = win.URL.createObjectURL(file), img = new win.Image();
    img.onload = () => { win.URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { win.URL.revokeObjectURL(url); reject(fail('unreadable')); };
    img.src = url;
  });
}

return { MAX_PIXELS, MAX_SIDE, REFUSE_PIXELS, JPEG_QUALITY, headerSize, plan, prepare };
}));
