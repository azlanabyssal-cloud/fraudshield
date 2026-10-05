// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AssistantApp } from './AssistantApp';
import { createAppOps } from './appOps';
import { ToolsMissing } from './imageTools';
import type { PictureTools } from './imageTools';

const SCAM = 'Dear customer your SBI account will be blocked today. Update KYC immediately: http://sbi-kyc-update.tk/login';
const NONE = { text: null, structure: { qr: false, certainty: null } } as const;
const storage = () => { const d = new Map<string, string>(); return { getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => void d.set(k, v), removeItem: (k: string) => void d.delete(k) }; };
const png = (name = 'shot.png') => new File([new Uint8Array(64)], name, { type: 'image/png' });
const fakeTools = (over: Partial<PictureTools> = {}): PictureTools => ({ prepare: f => Promise.resolve(f), inspect: () => Promise.resolve(NONE), recognize: () => Promise.resolve(''), warm: () => undefined, release: () => undefined, hot: false, ...over });
const mount = (tools: PictureTools) => {
  const ops = createAppOps(storage()), pickSpy = vi.fn();
  const view = render(<AssistantApp instant storage={storage()} ops={ops} tools={tools} modelStatus="ready" now={() => 1_800_000_000_000} />);
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  input.click = pickSpy;
  return { view, ops, input, user: userEvent.setup(), pickSpy };
};
const upload = async (m: ReturnType<typeof mount>, file: File) => { await act(async () => { fireEvent.change(m.input, { target: { files: [file] } }); await Promise.resolve(); }); };

describe('pictures', () => {
  test('a readable QR code: the picture appears, the person is shown what the code holds, and it is judged; nothing is read as text', async () => {
    const recognize = vi.fn(() => Promise.resolve('never'));
    const m = mount(fakeTools({ inspect: () => Promise.resolve({ text: 'upi://pay?pa=refund.desk@ybl&pn=Refund%20Desk&am=4999&tn=claim%20refund', structure: { qr: true, certainty: 'full' } }), recognize }));
    await upload(m, png());
    expect(await screen.findByText(/I found a QR code in that image\. It contains: "upi:\/\/pay\?pa=refund\.desk@ybl/)).toBeInTheDocument();
    expect(screen.getByAltText('The picture you shared')).toBeInTheDocument();
    expect(await screen.findByRole('article', { name: /scam/i })).toBeInTheDocument();
    expect(recognize).not.toHaveBeenCalled();
    expect(screen.queryByRole('status', { name: /./ })).toBeNull();
    expect(m.ops.summary().byKind).toMatchObject({ link: 1 });
  });

  test('a QR code that cannot be read stops everything: no text reading, no verdict from the words around it, and "Try another picture" opens the picker', async () => {
    const recognize = vi.fn(() => Promise.resolve(SCAM));
    const m = mount(fakeTools({ inspect: () => Promise.resolve({ text: null, structure: { qr: true, certainty: 'partial' } }), recognize }));
    await upload(m, png());
    expect(await screen.findByText(/Do not scan it\. I cannot tell where it would send your money/)).toBeInTheDocument();
    expect(recognize).not.toHaveBeenCalled();
    expect(screen.queryByRole('article')).toBeNull();
    expect(m.ops.summary().byKind).toMatchObject({ qr: 1 });
    await m.user.click(screen.getByRole('button', { name: '📷 Try another picture' }));
    expect(m.pickSpy).toHaveBeenCalledTimes(1);
  });

  test('a screenshot of a message is read, shown back, judged like the same words pasted, and the reading time and warm-start are recorded', async () => {
    let finish: (t: string) => void = () => undefined;
    const recognize = vi.fn((_b: Blob, onProgress: (p: { status?: string; progress?: number }) => void) => { onProgress({ status: 'recognizing text', progress: 0.4 }); return new Promise<string>(r => { finish = r; }); });
    const m = mount(fakeTools({ recognize, hot: true }));
    await upload(m, png());
    expect(await screen.findByRole('status')).toHaveTextContent('🔍 Reading image — 40%');
    await act(async () => { finish(SCAM); await Promise.resolve(); });
    expect(await screen.findByText(/Here's what I read from the image \(no QR code found in it\): "Dear customer your SBI account/)).toBeInTheDocument();
    expect(await screen.findByRole('article', { name: /scam/i })).toBeInTheDocument();
    await waitFor(() => { expect(screen.queryByText(/Reading image/)).toBeNull(); });
    const s = m.ops.summary();
    expect(s.ocr).toMatchObject({ runs: 1, hotShare: 1 });
    expect(JSON.stringify(s)).not.toMatch(/SBI|sbi-kyc|Dear customer/);
  });

  test('a picture with no readable text asks for the words instead; a reader that fails says so once, is recorded as a code, and the next picture can try again', async () => {
    const recognize = vi.fn<PictureTools['recognize']>(() => Promise.resolve('  '));
    const m = mount(fakeTools({ recognize }));
    await upload(m, png());
    expect(await screen.findByText(/couldn't read clear text from that image/)).toBeInTheDocument();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    recognize.mockImplementation(() => Promise.reject(new Error('out of memory')));
    await upload(m, png('two.png'));
    expect(await screen.findByText(/image reader could not run on this device/)).toBeInTheDocument();
    expect(m.ops.summary().errors).toEqual({ 'ocr-failed': 1 });
    recognize.mockImplementation(() => Promise.resolve(SCAM));
    await upload(m, png('three.png'));
    expect(await screen.findByRole('article', { name: /scam/i })).toBeInTheDocument();
  });

  test('a picture that cannot be opened, is absurdly large, or cannot be loaded at all each get their own plain message and a coded record', async () => {
    const reject = (code: string) => Object.assign(new Error(code), { code });
    for (const [prepare, words, codes] of [[() => Promise.reject(reject('too-large')), /over 150 megapixels/, { 'prepare-too-large': 1 }], [() => Promise.reject(reject('unreadable')), /could not open that picture/, { 'prepare-unreadable': 1 }], [() => Promise.reject(new ToolsMissing()), /image reader did not load/, {}]] as const) {
      const m = mount(fakeTools({ prepare }));
      await upload(m, png());
      expect(await screen.findByText(words)).toBeInTheDocument();
      expect(m.ops.summary().errors).toEqual(codes);
      m.view.unmount();
    }
  });

  test('a file over 25 MB is refused before anything is read; something that is not a picture is ignored; a second picture while one is being read waits its turn', async () => {
    const prepare = vi.fn<PictureTools['prepare']>(f => Promise.resolve(f));
    let finish: (t: string) => void = () => undefined;
    const m = mount(fakeTools({ prepare, recognize: () => new Promise<string>(r => { finish = r; }) }));
    const big = png('big.png'); Object.defineProperty(big, 'size', { value: 30 * 1024 * 1024 });
    await upload(m, big);
    expect(await screen.findByText(/over 25 MB/)).toBeInTheDocument(); expect(prepare).not.toHaveBeenCalled();
    await upload(m, new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    expect(prepare).not.toHaveBeenCalled();
    await upload(m, png('a.png'));
    await screen.findByRole('status');
    await upload(m, png('b.png'));
    expect(await screen.findByText(/One picture at a time/)).toBeInTheDocument();
    expect(prepare).toHaveBeenCalledTimes(1);
    await act(async () => { finish(SCAM); await Promise.resolve(); });
    expect(await screen.findByRole('article', { name: /scam/i })).toBeInTheDocument();
  });

  test('pasting a picture into the box sends it, the attach button warms the reader as the picker opens, and the whole page stays accessible with a picture on screen', async () => {
    const warm = vi.fn();
    const m = mount(fakeTools({ warm, recognize: () => Promise.resolve(SCAM) }));
    await m.user.click(screen.getByRole('button', { name: 'Attach a screenshot or QR code' }));
    expect(warm).toHaveBeenCalledTimes(1); expect(m.pickSpy).toHaveBeenCalledTimes(1);
    const box = screen.getByLabelText('Your message');
    await act(async () => { fireEvent.paste(box, { clipboardData: { files: [png('pasted.png')] } }); await Promise.resolve(); });
    expect(await screen.findByRole('article', { name: /scam/i })).toBeInTheDocument();
    const violations = (await axe.run(m.view.container, { rules: { 'color-contrast': { enabled: false } } })).violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(', '));
    expect(violations).toEqual([]);
  });

  test('erasing everything removes the picture from the chat and the page frees its address', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const m = mount(fakeTools({ recognize: () => Promise.resolve(SCAM) }));
    await upload(m, png());
    await screen.findByAltText('The picture you shared');
    await m.user.click(screen.getByText('How this tool is doing on this device'));
    await m.user.click(screen.getByRole('button', { name: /Erase everything/ }));
    expect(screen.queryByAltText('The picture you shared')).toBeNull();
    expect(revoke).toHaveBeenCalled();
  });
});

describe('spoken replies', () => {
  const spoken: string[] = [], cancels = { n: 0 };
  class Utt { text: string; rate = 1; pitch = 1; onend: (() => void) | null = null; onerror: (() => void) | null = null; voice: unknown; lang = ''; constructor(t: string) { this.text = t; } }
  const install = (voices: { name: string; lang: string; localService: boolean }[]) => {
    Object.assign(window, { speechSynthesis: { getVoices: () => voices, speak: (u: Utt) => { spoken.push(u.text); queueMicrotask(() => u.onend?.()); }, cancel: () => { cancels.n++; }, speaking: false, pending: false, onvoiceschanged: null }, SpeechSynthesisUtterance: Utt });
  };
  beforeEach(() => { spoken.length = 0; cancels.n = 0; });
  afterEach(() => { delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis; delete (window as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance; });
  const ask = async (m: ReturnType<typeof mount>, text: string) => { await m.user.type(screen.getByLabelText('Your message'), text + '{Enter}'); };

  test('off by default; switching on speaks new replies in an on-device voice (not the greeting), hands the screen reader a quiet log, and says why', async () => {
    install([{ name: 'Network', lang: 'en-IN', localService: false }, { name: 'Rishi', lang: 'en-IN', localService: true }]);
    const m = mount(fakeTools());
    const toggle = screen.getByRole('button', { name: /Spoken replies: off/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'false'); expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'polite');
    expect(spoken).toEqual([]);
    await m.user.click(toggle);
    expect(screen.getByRole('button', { name: /Spoken replies: on/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'off');
    expect(screen.getByText(/will not read them out a second time/)).toBeInTheDocument();
    expect(spoken).toEqual([]);
    await ask(m, 'who made this');
    await waitFor(() => { expect(spoken.join(' ')).toMatch(/built by Azlan/); });
    expect(spoken.join(' ')).not.toMatch(/FraudShield Assistant\. Type what happened/);
    await m.user.click(screen.getByRole('button', { name: /Spoken replies: on/ }));
    expect(cancels.n).toBeGreaterThan(0); expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'polite');
  });

  test('with only network voices nothing is spoken at all: the text would leave the device', async () => {
    install([{ name: 'Google UK English', lang: 'en-GB', localService: false }]);
    const m = mount(fakeTools());
    await m.user.click(screen.getByRole('button', { name: /Spoken replies: off/ }));
    await ask(m, 'who made this');
    await screen.findByText(/built by Azlan/);
    expect(spoken).toEqual([]);
  });

  test('a browser with no speech engine shows no toggle', () => {
    mount(fakeTools());
    expect(screen.queryByRole('button', { name: /Spoken replies/ })).toBeNull();
  });
});
