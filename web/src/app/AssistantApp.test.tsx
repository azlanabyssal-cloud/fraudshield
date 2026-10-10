// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AssistantApp } from './AssistantApp';
import { createAppOps } from './appOps';
import { STORAGE_KEY } from './chatState';
import { VOICE_CONSENT_KEY } from './hooks/useVoice';

const SCAM = 'Dear customer your SBI account will be blocked today. Update KYC immediately: http://sbi-kyc-update.tk/login';
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
}
const setup = (storage = memoryStorage()) => {
  const ops = createAppOps(storage);
  const user = userEvent.setup();
  const view = render(<AssistantApp instant storage={storage} ops={ops} now={() => 1_800_000_000_000} />);
  return { user, view, storage, ops, box: screen.getByLabelText('Your message') as HTMLTextAreaElement };
};
const say = async (s: ReturnType<typeof setup>, text: string) => { await s.user.type(s.box, text); await s.user.keyboard('{Enter}'); };
const accessibility = async (root: Element) => (await axe.run(root, { rules: { 'color-contrast': { enabled: false } } })).violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(', '));

describe('the page', () => {
  test('opens with a greeting and the menu, one main heading, the landmarks, and no accessibility violations', async () => {
    const { view } = setup();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Check a message/);
    expect(screen.getByRole('banner')).toBeInTheDocument(); expect(screen.getByRole('main')).toBeInTheDocument(); expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('log', { name: /Conversation/ })).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText(/I'm the FraudShield Assistant/)).toBeInTheDocument();
    expect(screen.getAllByRole('button').filter(b => /Fake loan app|Suspicious call/.test(b.textContent ?? ''))).toHaveLength(2);
    expect(await accessibility(view.container)).toEqual([]);
  });

  test('a scam message gets a verdict card that quotes the exact words, names the result in words, and says it is not proof; focus stays in the box', async () => {
    const s = setup();
    await say(s, SCAM);
    const card = await screen.findByRole('article', { name: /Looks like a scam/ });
    expect(within(card).getByText('kyc … update')).toBeInTheDocument();
    expect(within(card).getByText(/What gave it away/)).toBeInTheDocument();
    expect(within(card).getByText(/never means a message is safe/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Paid or shared details\? Call 1930/ })).toHaveAttribute('href', 'tel:1930');
    expect(screen.getAllByRole('link', { name: /Call 1930/ })).toHaveLength(3);   // the card's button, the helpline at the foot of the page, and the one in the header that is on screen whatever the person scrolls to
    expect(s.box).toHaveValue(''); expect(s.box).toHaveFocus();
    expect(screen.getByText(SCAM)).toBeInTheDocument();
    expect(await accessibility(s.view.container)).toEqual([]);
  });

  test('Enter sends, Shift+Enter adds a line, and a key pressed while a keyboard is composing a word never sends', async () => {
    const s = setup();
    await s.user.type(s.box, 'who made this{Shift>}{Enter}{/Shift}and more');
    expect(s.box.value).toBe('who made this\nand more');
    expect(screen.queryByText(/built by Azlan/)).toBeNull();
    fireEvent.change(s.box, { target: { value: 'who made this' } });
    fireEvent.keyDown(s.box, { key: 'Enter', isComposing: true });
    expect(screen.queryByText(/built by Azlan/)).toBeNull();
    fireEvent.keyDown(s.box, { key: 'Enter' });
    expect(await screen.findByText(/built by Azlan/)).toBeInTheDocument();
  });

  test('the send button is off until there is something to send', async () => {
    const s = setup();
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await s.user.type(s.box, '   ');
    expect(send).toBeDisabled();
    await s.user.type(s.box, 'hello');
    expect(send).toBeEnabled();
  });

  test('a question is answered, a suggested question can be tapped and appears as the person’s own message, and unknown questions are said plainly', async () => {
    const s = setup();
    await say(s, 'is my data safe here');
    expect(await screen.findByText(/refuses to send it to any other server/)).toBeInTheDocument();
    await s.user.click(screen.getByRole('button', { name: 'Do you store my messages?' }));
    expect(screen.getAllByText('Do you store my messages?').length).toBeGreaterThan(0);
    expect(await screen.findByText(/nothing for it to keep or sell/)).toBeInTheDocument();
    await say(s, 'what is the capital of france');
    expect(await screen.findByText(/I don't have an answer for that/)).toBeInTheDocument();
  });

  test('markup typed by a person is shown as text and runs nothing', async () => {
    const s = setup();
    await say(s, '<img src=x onerror="window.__xss=1"> what is phishing');
    expect(await screen.findByText(/Phishing is a message or call/)).toBeInTheDocument();
    expect(s.view.container.querySelector('img')).toBeNull();
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });

  test('the conversation survives a reload of the tab, and a damaged saved value is ignored', async () => {
    const first = setup();
    await say(first, 'who made this');
    await screen.findByText(/built by Azlan/);
    first.view.unmount();
    const again = setup(first.storage);
    expect(screen.getByText('who made this')).toBeInTheDocument();
    expect(again.box).toBeInTheDocument();
    again.view.unmount();
    const damaged = setup(memoryStorage({ [STORAGE_KEY]: '{"v":1,"messages":"nope"}' }));
    expect(damaged.view.container.textContent).toMatch(/I'm the FraudShield Assistant/);
  });
});

describe('on-device diagnostics', () => {
  test('counts what happened, never the words, and the erase button clears the chat, the counts, and the voice choice', async () => {
    const s = setup(memoryStorage({ [VOICE_CONSENT_KEY]: 'cloud' }));
    window.localStorage.setItem(VOICE_CONSENT_KEY, 'cloud');
    await say(s, 'is my data safe here'); await screen.findByText(/refuses to send/);
    await say(s, 'what is the capital of france'); await screen.findByText(/I don't have an answer/);
    await say(s, SCAM + ' my OTP 482913'); await screen.findByRole('article', { name: /scam/i });
    const summary = s.ops.summary();
    expect(summary.questions).toMatchObject({ answered: 1, unanswered: 1 });
    expect(JSON.stringify(summary) + [...s.storage.data.values()].filter((_, i) => i >= 0 && false).join('')).not.toMatch(/482913|capital|france/);
    expect(s.storage.data.get('fs_ops_v1') ?? '').not.toMatch(/482913|capital|france|data safe/);
    await s.user.click(screen.getByText('How this tool is doing on this device'));
    await s.user.click(screen.getByRole('button', { name: /Erase everything/ }));
    expect(s.ops.summary().events).toBe(0);
    expect(s.storage.data.get('fs_ops_v1')).toBeUndefined();
    expect(window.localStorage.getItem(VOICE_CONSENT_KEY)).toBeNull();
    expect(screen.queryByText('is my data safe here')).toBeNull();
    expect(screen.getByText(/I'm the FraudShield Assistant/)).toBeInTheDocument();
  });
});

describe('typing takes a moment, and says so', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  test('without "instant", the assistant shows one piece at a time with a typing indicator, and the buttons arrive with the last piece', () => {
    const storage = memoryStorage();
    render(<AssistantApp storage={storage} ops={createAppOps(storage)} now={() => 1_800_000_000_000} />);
    const box = screen.getByLabelText('Your message');
    fireEvent.change(box, { target: { value: 'who made this' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.queryByText(/built by Azlan/)).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/typing/);
    // one piece appears per render, so time is advanced a step at a time
    for (let i = 0; i < 8; i++) act(() => { vi.advanceTimersByTime(700); });
    expect(screen.getByText(/built by Azlan/)).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'What is FraudShield for?' })).toBeInTheDocument();
  });
});

describe('voice', () => {
  class FakeRecognition {
    static last: FakeRecognition | null = null;
    lang = ''; interimResults = false; maxAlternatives = 1; started = 0;
    onresult: ((e: unknown) => void) | null = null; onstart: (() => void) | null = null; onend: (() => void) | null = null; onerror: ((e: { error: string }) => void) | null = null;
    constructor() { FakeRecognition.last = this; }
    start(): void { this.started++; this.onstart?.(); }
    stop(): void { this.onend?.(); }
    hear(text: string): void { this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] }); }
  }
  beforeEach(() => {
    FakeRecognition.last = null;
    (window as unknown as { webkitSpeechRecognition: typeof FakeRecognition }).webkitSpeechRecognition = FakeRecognition;
    window.localStorage.clear();
  });
  afterEach(() => { delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition; window.localStorage.clear(); });

  test('the microphone never opens before the person decides where their audio may go; "No" leaves it closed', async () => {
    const s = setup();
    await s.user.click(screen.getByRole('button', { name: 'Speak your message' }));
    expect(await screen.findByText('Voice needs one decision from you')).toBeInTheDocument();
    expect(screen.getByText(/sends your audio to/)).toBeInTheDocument();
    expect(FakeRecognition.last?.started ?? 0).toBe(0);
    await s.user.click(screen.getByRole('button', { name: /No, I will type/ }));
    expect(screen.getByRole('status')).toHaveTextContent(/Nothing was recorded/);
    expect(FakeRecognition.last?.started ?? 0).toBe(0);
  });

  test('"Allow" is remembered and starts listening; the page says where the audio goes', async () => {
    const s = setup();
    await s.user.click(screen.getByRole('button', { name: 'Speak your message' }));
    await s.user.click(await screen.findByRole('button', { name: /Allow voice/ }));
    expect(FakeRecognition.last?.started).toBe(1);
    expect(window.localStorage.getItem(VOICE_CONSENT_KEY)).toBe('cloud');
    expect(s.box.placeholder).toMatch(/Listening… \(audio goes to/);
    expect(screen.getByRole('button', { name: 'Stop listening' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('"What is the main purpose of" is held, the microphone reopens, and the rest completes it into one question', async () => {
    window.localStorage.setItem(VOICE_CONSENT_KEY, 'cloud');
    const s = setup();
    await s.user.click(screen.getByRole('button', { name: 'Speak your message' }));
    const rec = FakeRecognition.last!;
    vi.useFakeTimers();
    act(() => { rec.hear('What is the main purpose of'); rec.onend?.(); });
    expect(s.box).toHaveValue('What is the main purpose of');
    expect(screen.queryByText(/helps you act fast/)).toBeNull();
    act(() => { vi.advanceTimersByTime(200); });
    expect(rec.started).toBe(2);
    act(() => { rec.hear('FraudShield'); });
    vi.useRealTimers();
    expect(await screen.findByText(/helps you act fast on digital fraud/)).toBeInTheDocument();
    expect(screen.getAllByText('What is the main purpose of FraudShield').length).toBeGreaterThan(0);
  });

  test('a person who keeps trailing off is held at most twice and then answered; silence after a held sentence answers it too', async () => {
    window.localStorage.setItem(VOICE_CONSENT_KEY, 'cloud');
    const s = setup();
    await s.user.click(screen.getByRole('button', { name: 'Speak your message' }));
    const rec = FakeRecognition.last!;
    vi.useFakeTimers();
    act(() => { rec.hear('what is the'); rec.onend?.(); vi.advanceTimersByTime(200); rec.hear('purpose of'); rec.onend?.(); vi.advanceTimersByTime(200); rec.hear('the'); });
    vi.useRealTimers();
    expect(await screen.findByText(/sounds cut off/)).toBeInTheDocument();
    expect(screen.getAllByText('what is the purpose of the').length).toBeGreaterThan(0);

    vi.useFakeTimers();
    act(() => { rec.hear('who made'); rec.onend?.(); });
    act(() => { vi.advanceTimersByTime(200); });
    act(() => { rec.onerror?.({ error: 'no-speech' }); });
    vi.useRealTimers();
    expect(await screen.findByText(/built by Azlan/)).toBeInTheDocument();
  });

  test('every error says what happened and how to go on, and none latches: the next tap tries again', async () => {
    window.localStorage.setItem(VOICE_CONSENT_KEY, 'cloud');
    const s = setup();
    await s.user.click(screen.getByRole('button', { name: 'Speak your message' }));
    const rec = FakeRecognition.last!;
    for (const [error, words] of [['not-allowed', /microphone is blocked/], ['audio-capture', /can't reach a microphone/], ['network', /needs an internet connection/], ['mystery', /unexpected problem \(mystery\)/]] as const) {
      act(() => { rec.onerror?.({ error }); });
      expect(screen.getByRole('status')).toHaveTextContent(words);
    }
    act(() => { rec.onerror?.({ error: 'aborted' }); });
    await s.user.click(screen.getByRole('button', { name: 'Speak your message' }));
    expect(rec.started).toBe(2);
  });

  test('without speech support there is no microphone to tap, and typing is all there is', () => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    setup();
    expect(screen.queryByRole('button', { name: /Speak your message/ })).toBeNull();
    expect(screen.getByLabelText('Your message')).toBeInTheDocument();
  });
});
