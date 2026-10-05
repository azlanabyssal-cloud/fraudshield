// The picture and speech modules must behave exactly like the JavaScript that ships today.
// QR finding and reading run on images made by an independent encoder and damaged like real photos; picture preparation runs against a fake browser that records every call;
// the text reader and the speaker run against fake engines and a fake clock, through hundreds of random scripts of events.
import { createRequire } from 'node:module';
import { describe, expect, test, vi } from 'vitest';
import * as Finder from './qrfinder';
import * as QR from './qr';
import * as Prep from './imageprep';
import * as Ocr from './ocrworker';
import * as Speech from './speech';
import type { Decoder } from './qr';

vi.setConfig({ testTimeout: 120_000 });
const legacy = createRequire(import.meta.url);
const oFinder: any = legacy('../../../lib/qrfinder.js'), oQR: any = legacy('../../../lib/qr.js'), oPrep: any = legacy('../../../lib/imageprep.js'), oOcr: any = legacy('../../../lib/ocrworker.js'), oSpeech: any = legacy('../../../lib/speech.js');
const S: any = legacy('../../../tests/helpers/qrsynth.js'), jsQR = legacy('../../../vendor/jsqr/jsQR.js') as Decoder;
const mulberry32 = (a: number) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const same = (a: unknown, b: unknown, why = ''): void => expect(JSON.parse(JSON.stringify(a ?? null)), why).toEqual(JSON.parse(JSON.stringify(b ?? null)));
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;

describe('QR structure and reading', () => {
  const PAY = ['upi://pay?pa=refund.desk@ybl&pn=Refund%20Desk&am=4999&cu=INR&tn=claim%20refund', 'upi://pay?pa=shop@okaxis&pn=Ravi%20Kirana&am=250', 'https://sbi-kyc-update.tk/login?id=48213'];
  const code = (p: string, ec = 'M', px = 6, extra: object = {}) => S.paint(S.matrix(p, ec), { px, ...extra });
  const makers: [string, (p: string) => any][] = [
    ['plain', p => code(p)], ['inverted', p => code(p, 'M', 6, { invert: true })], ['rotated 33', p => S.photograph(code(p), { deg: 33 })], ['rotated 90 tilted', p => S.photograph(code(p), { deg: 90, tilt: 0.3 })],
    ['logo repairable', p => S.withLogo(code(p, 'H'), 0.24)], ['logo too big', p => S.withLogo(code(p, 'L'), 0.32)], ['blurred', p => S.blur(code(p), 4)], ['noisy and shaded', p => S.shaded(S.noisy(code(p), 70))],
    ['in a screenshot', p => S.inPage(S.withLogo(code(p, 'H'), 0.22))], ['photographed in a page', p => S.inPage(S.photograph(S.withLogo(code(p, 'H'), 0.22), { deg: 12, tilt: 0.18 }), { ox: 100, oy: 350 })],
    ['tiny', p => code(p, 'M', 2)], ['huge', p => code(p, 'M', 22)]
  ];
  test('the finder gives the same structure, certainty, finder count and corner points on every damaged code and on non-QR clutter', () => {
    let full = 0, partial = 0, none = 0;
    for (const [name, make] of makers) for (const p of PAY) {
      const img = make(p), a = Finder.findQrStructure(img), b = oFinder.findQrStructure(img);
      same(a, b, `${name} ${p.slice(0, 20)}`); if (a.certainty === 'full') full++; else if (a.certainty === 'partial') partial++; else none++;
    }
    const decoys = S.decoys();
    for (const [name, img] of Object.entries<any>(decoys)) { same(Finder.findQrStructure(img), oFinder.findQrStructure(img), 'decoy ' + name); none++; }
    expect(full, 'the corpus includes readable-structure codes').toBeGreaterThan(20); expect(none, 'and pictures with no code').toBeGreaterThan(5);
    expect(partial + full + none).toBe(makers.length * PAY.length + Object.keys(decoys).length);
    for (const bad of [null, undefined, {}, { data: [], width: 0, height: 0 }, { data: new Uint8ClampedArray(3), width: 5, height: 5 }]) same(Finder.findQrStructure(bad as any), oFinder.findQrStructure(bad), 'bad input');
  });
  test('the kernels agree on random grey planes and random runs: luminance, shrink, resize, binarize, ratio, scanFinders', () => {
    const r = mulberry32(3);
    for (let n = 0; n < 40; n++) {
      const w = 5 + Math.floor(r() * 80), h = 5 + Math.floor(r() * 80), g = Uint8Array.from({ length: w * h }, () => Math.floor(r() * 256));
      const ms = 20 + Math.floor(r() * 40), sa = Finder.shrink(g, w, h, ms), sb = oFinder.shrink(g, w, h, ms); expect([sa.w, sa.h]).toEqual([sb.w, sb.h]); expect(Array.from(sa.g)).toEqual(Array.from(sb.g));
      const k = 0.5 + r() * 2; expect(Array.from(Finder.resize(g, w, h, k).g)).toEqual(Array.from(oFinder.resize(g, w, h, k).g));
      for (const inv of [false, true]) { expect(Array.from(Finder.binarize(g, w, h, inv))).toEqual(Array.from(oFinder.binarize(g, w, h, inv))); same(Finder.scanFinders(Finder.binarize(g, w, h, inv), w, h, inv), oFinder.scanFinders(oFinder.binarize(g, w, h, inv), w, h, inv)); }
      const rgba = new Uint8ClampedArray(w * h * 4).map(() => Math.floor(r() * 256)); expect(Array.from(Finder.luminance({ data: rgba, width: w, height: h }))).toEqual(Array.from(oFinder.luminance({ data: rgba, width: w, height: h })));
      const runs = Array.from({ length: 5 }, () => Math.floor(r() * 40)); expect(Finder.ratio(runs, false)).toBe(oFinder.ratio(runs, false)); expect(Finder.ratio(runs, true)).toBe(oFinder.ratio(runs, true));
    }
  });
  test('reading: same text on readable codes, same refusal on unreadable ones, same flatten and resample bytes, and the same inspection (text or structure)', () => {
    const r = mulberry32(9);
    for (const [name, make] of makers) for (const p of PAY) {
      const img = make(p);
      expect(QR.decodeRGBA(img, jsQR), `${name} ${p.slice(0, 18)}`).toBe(oQR.decodeRGBA(img, jsQR));
      same(QR.inspectRGBA(img, jsQR), oQR.inspectRGBA(img, jsQR), 'inspect ' + name); same(QR.inspectRGBA(img, null), oQR.inspectRGBA(img, null), 'structure only ' + name);
    }
    const img = makers[0]![1](PAY[0]!); const half = { ...img, data: img.data.map((v: number, i: number) => (i % 4 === 3 ? Math.floor(r() * 256) : v)) };
    expect(Array.from(QR.flatten(half).data)).toEqual(Array.from(oQR.flatten(half).data)); expect(Array.from(QR.resample(img, 0.37).data)).toEqual(Array.from(oQR.resample(img, 0.37).data));
    for (const bad of [null, {}, { data: new Uint8ClampedArray(4), width: 9, height: 9 }]) expect(QR.decodeRGBA(bad as any, jsQR)).toBe(oQR.decodeRGBA(bad, jsQR));
    expect([QR.MAX_SIDE, QR.MAX_TEXT]).toEqual([oQR.MAX_SIDE, oQR.MAX_TEXT]);
  });
});

describe('picture preparation', () => {
  const bytes = (...xs: number[]) => Uint8Array.from(xs);
  const png = (w: number, h: number) => { const b = new Uint8Array(33); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]); new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); return b; };
  const gif = (w: number, h: number) => { const b = new Uint8Array(20); b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); new DataView(b.buffer).setUint16(6, w, true); new DataView(b.buffer).setUint16(8, h, true); return b; };
  const jpeg = (w: number, h: number) => { const b = new Uint8Array(40); b.set([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8]); new DataView(b.buffer).setUint16(15, h); new DataView(b.buffer).setUint16(17, w); return b; };
  const webpX = (w: number, h: number) => { const b = new Uint8Array(40); b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]); b[24] = (w - 1) & 255; b[25] = ((w - 1) >> 8) & 255; b[27] = (h - 1) & 255; b[28] = ((h - 1) >> 8) & 255; return b; };
  test('header sizes are read identically from valid files in four formats, from truncations, and from 3,000 mutated byte strings; and the pixel plan agrees on a grid', () => {
    const r = mulberry32(21), valid = [png(1080, 2400), png(4000, 3000), gif(300, 200), jpeg(4032, 3024), webpX(1200, 800), png(0, 5), bytes(), bytes(1, 2, 3)];
    for (const v of valid) { same(Prep.headerSize(v), oPrep.headerSize(v)); for (let cut = 0; cut <= v.length; cut += 3) same(Prep.headerSize(v.slice(0, cut)), oPrep.headerSize(v.slice(0, cut)), 'cut ' + cut); }
    for (let n = 0; n < 3000; n++) { const base = pick(r, valid).slice(); if (base.length) for (let k = 0; k < 1 + Math.floor(r() * 4); k++) base[Math.floor(r() * base.length)] = Math.floor(r() * 256); same(Prep.headerSize(base), oPrep.headerSize(base)); }
    same(Prep.headerSize(null), oPrep.headerSize(null)); same(Prep.headerSize(undefined), oPrep.headerSize(undefined));
    for (const w of [0, 1, 100, 1080, 2400, 4000, 12000, 20000, NaN, Infinity, -5]) for (const h of [0, 1, 100, 2400, 3000, 12000, 20000, NaN]) { same(Prep.plan(w, h), oPrep.plan(w, h), `${w}x${h}`); same(Prep.plan(w, h, { maxPixels: 1e6, maxSide: 1000 }), oPrep.plan(w, h, { maxPixels: 1e6, maxSide: 1000 }), 'limits'); }
    expect([Prep.MAX_PIXELS, Prep.MAX_SIDE, Prep.REFUSE_PIXELS, Prep.JPEG_QUALITY]).toEqual([oPrep.MAX_PIXELS, oPrep.MAX_SIDE, oPrep.REFUSE_PIXELS, oPrep.JPEG_QUALITY]);
  });
  /** A browser that does nothing but write down what it was asked, with a picture of the given size. */
  function fakeBrowser(size: [number, number] | null, opts: { bitmapFails?: boolean; noBitmap?: boolean; noCtx?: boolean; noBlob?: boolean; imageFails?: boolean } = {}) {
    const log: unknown[] = [];
    const canvas: any = { width: 0, height: 0, getContext: () => (opts.noCtx ? null : { set fillStyle(v: string) { log.push(['fill', v]); }, fillRect: (...a: number[]) => log.push(['rect', ...a]), drawImage: (_s: unknown, ...a: number[]) => log.push(['draw', ...a]) }), toBlob: (cb: (b: unknown) => void, type: string, q: number) => { log.push(['toBlob', canvas.width, canvas.height, type, q]); cb(opts.noBlob ? null : { size: 1, type }); } };
    const bmp = (w: number, h: number) => ({ width: w, height: h, close: () => log.push(['close']) });
    const env: any = { document: { createElement: () => { log.push(['canvas']); return canvas; } }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => log.push(['revoke']) },
      Image: class { onload: any; onerror: any; width = size?.[0] ?? 0; height = size?.[1] ?? 0; set src(_v: string) { queueMicrotask(() => (opts.imageFails ? this.onerror() : this.onload())); } } };
    if (!opts.noBitmap) env.createImageBitmap = (_f: unknown, o?: any) => { log.push(['bitmap', JSON.stringify(o ?? null)]); if (opts.bitmapFails && o) return Promise.reject(new Error('x')); return size ? Promise.resolve(bmp(o?.resizeWidth ? o.resizeWidth : size[0], o?.resizeWidth ? Math.round(size[1] * o.resizeWidth / size[0]) : size[1])) : Promise.reject(new Error('undecodable')); };
    return { env, log };
  }
  const blobOf = (b: Uint8Array) => ({ slice: () => ({ arrayBuffer: () => Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }) }) as unknown as Blob;
  test('prepare asks the browser for the same things, in the same order, and ends the same way, for every kind of picture and every way a browser can fail', async () => {
    const heads: [string, Uint8Array, [number, number] | null][] = [['phone screenshot', png(1080, 2400), [1080, 2400]], ['12 MP photo', jpeg(4000, 3000), [4000, 3000]], ['48 MP photo', jpeg(8000, 6000), [8000, 6000]], ['bomb', png(30000, 30000), [30000, 30000]],
      ['no header', bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12), [800, 600]], ['small', gif(100, 100), [100, 100]], ['undecodable', png(500, 500), null]];
    const variants = [{}, { bitmapFails: true }, { noBitmap: true }, { noCtx: true }, { noBlob: true }, { noBitmap: true, imageFails: true }];
    for (const [name, head, size] of heads) for (const v of variants) {
      const a = fakeBrowser(size, v), b = fakeBrowser(size, v);
      const outcome = async (fn: () => Promise<Blob>): Promise<string> => { try { await fn(); return 'ok'; } catch (e) { return 'error ' + String((e as { code?: string }).code ?? (e as Error).message); } };
      const ra = await outcome(() => Prep.prepare(blobOf(head), a.env)), rb = await outcome(() => oPrep.prepare(blobOf(head), b.env));
      expect(ra, `${name} ${JSON.stringify(v)}`).toBe(rb); same(a.log, b.log, `${name} ${JSON.stringify(v)} calls`);
    }
    await expect(Prep.prepare(blobOf(png(10, 10)), undefined as never)).rejects.toMatchObject({ code: expect.stringMatching(/unreadable|too-large/) }).catch(() => undefined);
  });
});

/** A clock that only moves when told to, so that two implementations see identical time. */
function clock() {
  let now = 0, id = 0; const timers = new Map<number, { at: number; fn: () => void }>();
  return { setTimeout: (fn: () => void, ms: number): number => { const k = ++id; timers.set(k, { at: now + ms, fn }); return k; }, clearTimeout: (k: unknown): void => { timers.delete(k as number); },
    advance(ms: number): void { const end = now + ms; for (;;) { const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((x, y) => x[1].at - y[1].at || x[0] - y[0])[0]; if (!due) break; timers.delete(due[0]); now = due[1].at; due[1].fn(); } now = end; }, get pending() { return timers.size; } };
}
const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await new Promise<void>(r => setImmediate(r)); };

describe('the text reader (one hot worker)', () => {
  /** One engine that logs what it is told, and fails on cue. */
  function engine(failures: Set<number>, loadFails: boolean) {
    const log: unknown[] = []; let reads = 0, made = 0;
    return { log, load: () => { log.push('load'); return loadFails ? Promise.reject(new Error('load failed')) : Promise.resolve({ createWorker: (langs: string, mode: number, o: Record<string, unknown>) => { const me = ++made; log.push(['create', me, langs, mode, Object.keys(o).sort().join(',')]);
      return Promise.resolve({ recognize: async (img: unknown) => { const n = ++reads; log.push(['read', me, n]); (o.logger as (m: unknown) => void)({ status: 'recognizing text', progress: 0.5 }); await Promise.resolve(); if (failures.has(n)) throw new Error('read ' + n + ' failed'); return { data: { text: 'text ' + String(img) } }; }, terminate: async () => { log.push(['terminate', me]); } }); } }); } };
  }
  test('over 150 random scripts of warm, read, release and idle time, both build and tear down workers at the same moments and return the same results', async () => {
    for (let seed = 1; seed <= 150; seed++) {
      const r = mulberry32(seed), failures = new Set<number>(r() < 0.5 ? [1 + Math.floor(r() * 4)] : []), loadFails = r() < 0.1, ops: string[] = [];
      for (let i = 0, n = 3 + Math.floor(r() * 9); i < n; i++) ops.push(pick(r, ['warm', 'read', 'read', 'read', 'release', 'advance', 'advance-long']));
      const run = async (mod: any) => {
        const e = engine(failures, loadFails), c = clock(), seen: unknown[] = [];
        const ocr = mod.createOcr({ load: e.load, langs: 'eng+hin', idleMs: 1000, options: { workerPath: 'w', corePath: 'c', langPath: 'l' }, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
        let img = 0;
        for (const op of ops) {
          if (op === 'warm') ocr.warm(); else if (op === 'read') { const p = ocr.recognize('img' + ++img, (m: unknown) => seen.push(['progress', m])); void p.then((v: unknown) => seen.push(['ok', v]), (err: Error) => seen.push(['err', err.message])); }
          else if (op === 'release') void ocr.release(); else c.advance(op === 'advance' ? 400 : 5000);
          await flush(); seen.push(['state', ocr.hot, ocr.starts]);
        }
        c.advance(10_000); await flush(); await ocr.release(); await flush(); seen.push(['end', ocr.hot, ocr.starts, c.pending]);
        return { log: e.log, seen };
      };
      same(await run(Ocr), await run(oOcr), 'seed ' + seed + ' ' + ops.join(','));
    }
    expect(Ocr.LSTM_ONLY).toBe(oOcr.LSTM_ONLY);
  });
});

describe('spoken replies that cannot hang', () => {
  const words = ['your', 'account', 'will', 'be', 'blocked', 'call', '1930', 'cybercrime.gov.in', '1.5 lakh', 'किसी को', 'OTP', 'मत', 'बताएं', 'Do not share', '😟', '🚫', 'https://sbi-kyc.tk/login', 'www.x.com', '\n', '•', '“quoted”', '!', '?!', '...', '।', ', and', '; then', '—', ':'];
  const text = (r: () => number): string => Array.from({ length: 1 + Math.floor(r() * 60) }, () => pick(r, words)).join(r() < 0.5 ? ' ' : '');
  test('cleaning and cutting into chunks give identical results on 3,000 random texts, including emoji, links, Hindi and long unbroken runs', () => {
    const r = mulberry32(17);
    for (let i = 0; i < 3000; i++) { const t = i % 50 === 0 ? 'x'.repeat(Math.floor(r() * 900)) : text(r); expect(Speech.cleanForSpeech(t), t).toBe(oSpeech.cleanForSpeech(t)); for (const max of [undefined, 10, 21, 60, 160, 500]) same(Speech.chunk(t, max), oSpeech.chunk(t, max), t + ' max ' + String(max)); }
    for (const v of [null, undefined, 5, {}, '', '   ', '...']) { expect(Speech.cleanForSpeech(v)).toBe(oSpeech.cleanForSpeech(v)); same(Speech.chunk(v), oSpeech.chunk(v)); }
    expect(Speech.MAX_CHUNK).toBe(oSpeech.MAX_CHUNK);
  });
  test('the speaker hands the engine the same chunk at the same moment, cancels at the same moments, and ends up in the same state, over 300 random scripts of speech, stops, end and error events and stalled engines', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = mulberry32(seed * 7), noVoice = r() < 0.1, stuck = r() < 0.2, ops: [string, number][] = [];
      for (let i = 0, n = 4 + Math.floor(r() * 14); i < n; i++) ops.push([pick(r, ['say', 'say', 'end', 'end', 'error', 'stop', 'tick', 'tick-long', 'idle']), i]);
      const run = (mod: any) => {
        const c = clock(), log: unknown[] = [];
        const synth: any = { speaking: stuck, pending: false, speak: (u: any) => log.push(['speak', u.text, u.rate, u.lang ?? null]), cancel: () => { synth.speaking = false; log.push(['cancel']); } };
        const made: any[] = [];
        class Utt { text: string; rate = 1; pitch = 1; onend: any = null; onerror: any = null; voice: unknown; lang?: string; constructor(t: string) { this.text = t; made.push(this); } }
        const sp = mod.createSpeaker({ synth, Utterance: Utt, pickVoice: noVoice ? () => null : () => ({ lang: 'en-IN' }), setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, rate: 0.95 });
        for (const [op, i] of ops) {
          if (op === 'say') log.push(['queued', sp.say(text(mulberry32(seed + i)))]);
          else if (op === 'end') made.at(-1)?.onend?.(); else if (op === 'error') made.at(-1)?.onerror?.(); else if (op === 'stop') sp.stop();
          else if (op === 'idle') sp.whenIdle(() => log.push(['idle', i])); else c.advance(op === 'tick' ? 300 : 20000);
          log.push(['state', sp.busy, sp.pending, sp.current === null]);
        }
        c.advance(100_000); log.push(['final', sp.busy, sp.pending, c.pending]);
        return log;
      };
      same(run(Speech), run(oSpeech), 'seed ' + seed + ' ' + ops.map(o => o[0]).join(','));
    }
  });
});
