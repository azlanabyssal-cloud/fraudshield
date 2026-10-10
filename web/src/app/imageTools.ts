import type { Inspection } from '../engine/qr';
import type { OcrEngine, OcrProgress, Ocr } from '../engine/ocrworker';

/** What the page needs to look at a picture. The heavy parts (picture preparation, QR reading, the text reader) are loaded only when a picture is first added. */
export interface PictureTools {
  /** Shrinks a picture to the pixel budget. Rejects with an error whose `code` is 'too-large' or 'unreadable'. */
  prepare(file: Blob): Promise<Blob>;
  inspect(blob: Blob): Promise<Inspection>;
  /** Reads the text in a picture. */
  recognize(blob: Blob, onProgress: (m: OcrProgress) => void): Promise<string>;
  /** Starts the text reader in the background (as the picture picker opens). */
  warm(): void;
  release(): void;
  readonly hot: boolean;
}

/** The tools could not be loaded at all (a failed chunk or script download). */
export class ToolsMissing extends Error { constructor() { super('tools-missing'); this.name = 'ToolsMissing'; } }

type TesseractWindow = Window & { Tesseract?: OcrEngine };

/** The real tools, loading their code on demand. The OCR and QR engines are served from this site (vendor/), never a CDN, so a screenshot reaches no third party and reading works offline. */
export function browserTools(base: string = document.baseURI): PictureTools {
  const OCR_BASE = new URL('vendor/tesseract/', base).href, QR_URL = new URL('vendor/jsqr/jsQR.js', base).href;
  let ocr: Ocr | null = null;

  const loadTesseract = (): Promise<OcrEngine> => new Promise((resolve, reject) => {
    const w = window as TesseractWindow;
    if (w.Tesseract) { resolve(w.Tesseract); return; }
    const s = document.createElement('script');
    s.src = OCR_BASE + 'tesseract.min.js';
    s.onload = () => (w.Tesseract ? resolve(w.Tesseract) : reject(new Error('tesseract-missing')));
    s.onerror = () => reject(new Error('tesseract-load-failed'));
    document.head.appendChild(s);
  });
  const reader = async (): Promise<Ocr> => {
    if (!ocr) {
      const { createOcr } = await import('../engine/ocrworker').catch(() => { throw new ToolsMissing(); });
      ocr = createOcr({ load: loadTesseract, langs: 'eng+hin', idleMs: 120000, options: { workerPath: OCR_BASE + 'worker.min.js', corePath: OCR_BASE, langPath: OCR_BASE + 'lang' } });
    }
    return ocr;
  };

  return {
    prepare: async file => (await import('../engine/imageprep').catch(() => { throw new ToolsMissing(); })).prepare(file),
    inspect: async blob => (await import('../engine/qr').catch(() => { throw new ToolsMissing(); })).inspect(blob, { decoderUrl: QR_URL }),
    recognize: async (blob, onProgress) => { const o = await reader(); return (await o.recognize(blob, onProgress)).data.text; },
    warm: () => { void reader().then(o => { o.warm(); }, () => undefined); },
    release: () => { void ocr?.release(); },
    get hot() { return ocr?.hot ?? false; }
  };
}
