'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const P = require('../lib/imageprep.js');

const ROOT = path.join(__dirname, '..');
const u8 = a => Uint8Array.from(a);
const be32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255], be16 = n => [(n >> 8) & 255, n & 255], le16 = n => [n & 255, (n >> 8) & 255];
const png = (w, h) => u8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be32(w), ...be32(h), 8, 6, 0, 0, 0]);
const gif = (w, h) => u8([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...le16(w), ...le16(h), 0, 0, 0, 0]);
// a JPEG with an APP1 (EXIF-sized) segment before the frame header, as a phone writes it
const jpeg = (w, h, pad = 300) => u8([0xff, 0xd8, 0xff, 0xe1, ...be16(pad + 2), ...new Array(pad).fill(0x45), 0xff, 0xc0, 0, 17, 8, ...be16(h), ...be16(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);

test('image size is read from the first bytes: PNG, GIF, JPEG (past a large EXIF block), and every WebP variant', () => {
  assert.deepEqual(P.headerSize(png(4000, 3000)), { width: 4000, height: 3000 });
  assert.deepEqual(P.headerSize(gif(320, 200)), { width: 320, height: 200 });
  assert.deepEqual(P.headerSize(jpeg(4032, 3024)), { width: 4032, height: 3024 });
  assert.deepEqual(P.headerSize(jpeg(8000, 6000, 40000)), { width: 8000, height: 6000 });
  for (const f of ['images/field/csp-home.webp', 'images/hero-tips.webp', 'images/hotspot-ncrb.webp']) {
    const b = fs.readFileSync(path.join(ROOT, f)), got = P.headerSize(new Uint8Array(b.subarray(0, 65536)));
    assert.ok(got && got.width > 100 && got.height > 100, f);
  }
  assert.deepEqual(P.headerSize(new Uint8Array(fs.readFileSync(path.join(ROOT, 'images/field/csp-home.webp')).subarray(0, 65536))), { width: 1600, height: 1200 });
});

test('the header reader never throws and never reads past the end, whatever it is fed', () => {
  assert.equal(P.headerSize(null), null); assert.equal(P.headerSize(u8([])), null); assert.equal(P.headerSize(u8([1, 2, 3])), null);
  assert.equal(P.headerSize(u8(new Array(40).fill(0))), null); assert.equal(P.headerSize(u8(new Array(40).fill(255))), null);
  const j = jpeg(100, 100); for (let n = 0; n < j.length; n += 7) assert.doesNotThrow(() => P.headerSize(j.subarray(0, n)));
  const p = png(10, 10); for (let n = 0; n < p.length; n++) assert.doesNotThrow(() => P.headerSize(p.subarray(0, n)));
  assert.equal(P.headerSize(png(0, 5)), null, 'a zero side is not an image');
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 255;
  for (let i = 0; i < 2000; i++) { const b = new Uint8Array(64 + (i % 200)); for (let k = 0; k < b.length; k++) b[k] = rnd(); if (i % 3 === 0) { b[0] = 0xff; b[1] = 0xd8; } if (i % 5 === 0) { b[0] = 0x89; b[1] = 0x50; b[2] = 0x4e; b[3] = 0x47; } assert.doesNotThrow(() => P.headerSize(b)); }
});

test('the size plan: a screenshot passes untouched, a camera frame is cut to the pixel budget, proportions are kept, nothing is enlarged', () => {
  const shot = P.plan(1080, 2400); assert.equal(shot.scale, 1); assert.equal(shot.shrunk, false); assert.deepEqual([shot.width, shot.height], [1080, 2400]);
  for (const [w, h] of [[4000, 3000], [4032, 3024], [8000, 6000], [8160, 6120], [9000, 4000], [3024, 4032], [12000, 12000]]) {
    const p = P.plan(w, h); assert.ok(!p.refused && p.shrunk, `${w}x${h}`);
    assert.ok(p.width * p.height <= P.MAX_PIXELS * 1.002, `${w}x${h} -> ${p.width}x${p.height} is over budget`); assert.ok(Math.max(p.width, p.height) <= P.MAX_SIDE);
    assert.ok(Math.abs(p.width / p.height - w / h) < 0.01, 'proportions kept');
  }
  assert.equal(P.plan(300, 200).scale, 1); assert.equal(P.plan(1, 1).width, 1);
  assert.equal(P.plan(200000, 1).height >= 1, true, 'a one-pixel-tall sliver keeps a height of at least 1');
  assert.equal(P.plan(0, 5), null); assert.equal(P.plan(NaN, 5), null); assert.equal(P.plan(-4, 5), null); assert.equal(P.plan(Infinity, 5), null);
  assert.equal(P.plan(20000, 20000).refused, true, '400 megapixels is a decompression bomb, not a photo');
  for (let w = 100; w < 20000; w += 997) for (let h = 100; h < 20000; h += 811) { const p = P.plan(w, h); if (!p.refused) { assert.ok(p.width >= 1 && p.height >= 1 && p.scale <= 1 && p.width * p.height <= Math.max(P.MAX_PIXELS * 1.01, w * h)); } }
});

/* ---------- prepare(), with the browser replaced ---------- */
function env({ w, h, header, bitmapSize, noBitmapApi, ctx = true, blobOk = true }) {
  const log = { bitmapCalls: [], closed: 0, drawn: null, fills: [], canvases: [] };
  const bytes = header || jpeg(w, h);
  const file = { slice: () => ({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }) };
  const make = (cw, ch) => ({ width: cw, height: ch, close() { log.closed++; } });
  const win = {
    document: { createElement: () => { const c = { width: 0, height: 0, getContext: () => (ctx ? { fillRect: (...a) => log.fills.push(a), drawImage: (s, ...a) => { log.drawn = a; }, set fillStyle(v) { log.fillStyle = v; } } : null), toBlob: (cb, type, q) => { log.blob = { type, q, w: c.width, h: c.height }; cb(blobOk ? { size: 1234, type } : null); } }; log.canvases.push(c); return c; } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, Image: class {}
  };
  if (!noBitmapApi) win.createImageBitmap = async (f, o) => { log.bitmapCalls.push(o); const ratio = w / h, rw = o && o.resizeWidth ? o.resizeWidth : w; return make(...(bitmapSize || [rw, Math.round(rw / ratio)])); };
  return { win, file, log };
}

test('prepare: a 12 MP camera frame is decoded at reduced size from the start, drawn once on white, and leaves as a JPEG inside the budget', async () => {
  const e = env({ w: 4000, h: 3000 }), blob = await P.prepare(e.file, e.win);
  assert.equal(blob.type, 'image/jpeg'); assert.equal(e.log.blob.q, P.JPEG_QUALITY);
  assert.equal(e.log.bitmapCalls.length, 1); assert.ok(e.log.bitmapCalls[0].resizeWidth <= 1932 + 1 && e.log.bitmapCalls[0].resizeWidth > 0, 'the decoder was asked for the small size, never the full frame');
  assert.equal(e.log.bitmapCalls[0].imageOrientation, 'from-image');
  assert.ok(e.log.blob.w * e.log.blob.h <= P.MAX_PIXELS * 1.002); assert.equal(e.log.fillStyle, '#fff'); assert.deepEqual(e.log.fills[0].slice(0, 2), [0, 0]);
  assert.equal(e.log.closed, 1, 'the decoded bitmap is released'); assert.deepEqual([e.log.canvases[0].width, e.log.canvases[0].height], [0, 0], 'and so is the canvas');
});

test('prepare: even if the browser ignores the requested size, the canvas still holds the output to the budget', async () => {
  const e = env({ w: 4000, h: 3000, bitmapSize: [4000, 3000] }), blob = await P.prepare(e.file, e.win);
  assert.ok(blob && e.log.blob.w * e.log.blob.h <= P.MAX_PIXELS * 1.002, `${e.log.blob.w}x${e.log.blob.h}`);
});

test('prepare: a small screenshot is not resized at all, and a file with an unreadable header still goes through the normal path', async () => {
  let e = env({ w: 1080, h: 2400 }); await P.prepare(e.file, e.win); assert.equal(e.log.bitmapCalls[0].resizeWidth, undefined); assert.deepEqual([e.log.blob.w, e.log.blob.h], [1080, 2400]);
  e = env({ w: 1000, h: 800, header: u8(new Array(64).fill(1)) }); const b = await P.prepare(e.file, e.win); assert.ok(b); assert.equal(e.log.bitmapCalls[0].resizeWidth, undefined);
});

test('prepare: a header that claims hundreds of megapixels is refused before anything is decoded', async () => {
  const e = env({ w: 20000, h: 20000 });
  await assert.rejects(P.prepare(e.file, e.win), err => err.code === 'too-large'); assert.equal(e.log.bitmapCalls.length, 0, 'nothing was decoded');
});

test('prepare: a damaged file, a missing 2D context or a failed export reject with a clear code and leak nothing', async () => {
  let e = env({ w: 100, h: 100 }); e.win.createImageBitmap = async () => { throw new Error('decode failed'); };
  await assert.rejects(P.prepare(e.file, e.win), err => err.code === 'unreadable');
  e = env({ w: 100, h: 100, ctx: false }); await assert.rejects(P.prepare(e.file, e.win), err => err.code === 'unreadable'); assert.equal(e.log.closed, 1, 'the bitmap is released even when drawing is impossible');
  e = env({ w: 100, h: 100, blobOk: false }); await assert.rejects(P.prepare(e.file, e.win), err => err.code === 'unreadable');
  await assert.rejects(P.prepare({ slice: () => ({}) }, null), err => err.code === 'unreadable');
});

test('prepare: browsers without createImageBitmap fall back to an image element, and release its URL', async () => {
  const e = env({ w: 800, h: 600, noBitmapApi: true }); let revoked = 0; e.win.URL.revokeObjectURL = () => { revoked++; };
  e.win.Image = class { set src(v) { this.naturalWidth = 800; this.naturalHeight = 600; setImmediate(() => this.onload()); } };
  const blob = await P.prepare(e.file, e.win); assert.ok(blob); assert.equal(revoked, 1);
});

test('the assistant never hands a camera file to the text reader: it goes through the picture preparer first', () => {
  const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  assert.ok(/Prep\.prepare\(file\)/.test(src) && /ocr\.recognize\(blob,/.test(src) && !/Tesseract\.recognize\(/.test(src));
  assert.ok(/imageJobActive/.test(src), 'one picture at a time');
  for (const page of ['index', 'tips', 'data', 'assistant', 'report', 'about']) assert.ok(fs.readFileSync(path.join(ROOT, page + '.html'), 'utf8').includes('<script src="lib/imageprep.js" defer>'), page + ' loads the preparer');
});
