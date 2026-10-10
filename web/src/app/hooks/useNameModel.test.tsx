// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AssistantApp } from '../AssistantApp';
import { createAppOps } from '../appOps';
import { analyzePayload } from '../../engine/linkcheck';
import { install } from '../../engine/urlmodel';

const MODEL = readFileSync(resolve(import.meta.dirname, '../../../../data/urlmodel.json'), 'utf8');
const LINK = 'http://sbi-kyc-update.tk/login';
const storage = () => { const d = new Map<string, string>(); return { getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => void d.set(k, v), removeItem: (k: string) => void d.delete(k) }; };
const html = (): string | null => document.documentElement.getAttribute('data-name-model');
const ok = (body: string) => Promise.resolve(new Response(body, { status: 200 }));
const mount = () => {
  const ops = createAppOps(storage());
  render(<AssistantApp instant storage={storage()} ops={ops} nameModel={{ retryMs: [5, 5, 5] }} />);
  return { ops, user: userEvent.setup(), box: screen.getByLabelText('Your message') as HTMLTextAreaElement };
};

beforeEach(() => { install(null); document.documentElement.removeAttribute('data-name-model'); });
afterEach(() => { install(null); vi.unstubAllGlobals(); });

describe('the domain-name check loads without holding anything up, and is never silent when it cannot', () => {
  test('a good file is validated, installed and announced; link results then say the name check took part', async () => {
    vi.stubGlobal('fetch', vi.fn(() => ok(MODEL)));
    const { user, box } = mount();
    expect(html()).toBe('loading');
    await waitFor(() => { expect(html()).toBe('ready'); });
    expect(analyzePayload('http://paytm-secure-login.xyz').nameModel).toBe('applied');
    await user.type(box, LINK + '{Enter}');
    expect(await screen.findByRole('article', { name: /scam/i })).toBeInTheDocument();
    expect(screen.queryByText(/domain-name check/)).toBeNull();
  });

  test('a network failure is retried on the schedule, then reported once, recorded as a code, and said out loud in the link result; "Try again" recovers', async () => {
    const fetchMock = vi.fn<() => Promise<Response>>(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { ops, user, box } = mount();
    await waitFor(() => { expect(html()).toBe('failed'); });
    expect(fetchMock).toHaveBeenCalledTimes(4);                       // the first try and three retries
    expect(ops.summary().errors).toEqual({ 'model-failed': 1 });
    await user.type(box, LINK + '{Enter}');
    expect(await screen.findByText(/could not load on this device, so this result uses the written rules only/)).toBeInTheDocument();
    await user.click(screen.getByText('How this tool is doing on this device'));
    expect(screen.getByText(/could not load: link checks use the written rules only/)).toBeInTheDocument();
    fetchMock.mockImplementation(() => ok(MODEL));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => { expect(html()).toBe('ready'); });
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  test('a damaged file is refused before anything is touched: the rules carry on, and the record says the file was invalid', async () => {
    vi.stubGlobal('fetch', vi.fn(() => ok(JSON.stringify({ ...JSON.parse(MODEL), scale: 0 }))));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { ops } = mount();
    await waitFor(() => { expect(html()).toBe('failed'); });
    expect(ops.summary().errors).toEqual({ 'model-invalid': 1 });
    expect(analyzePayload(LINK).nameModel).toBe('not-loaded');
    expect(analyzePayload(LINK).level).toBe('scam');                  // the written rules still catch it
  });

  test('a half-downloaded file (not even JSON) and a server error are both reported, not installed', async () => {
    for (const reply of [() => ok('{"scale":'), () => Promise.resolve(new Response('nope', { status: 503 }))]) {
      document.documentElement.removeAttribute('data-name-model');
      vi.stubGlobal('fetch', vi.fn(reply));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { ops } = mount();
      await waitFor(() => { expect(html()).toBe('failed'); });
      expect(Object.keys(ops.summary().errors)).toHaveLength(1);
      expect(analyzePayload('http://paytm-secure-login.xyz').nameModel).toBe('not-loaded');
      document.body.innerHTML = '';
    }
  });

  test('a browser with no fetch is told so at once and does not wait for retries it cannot win', async () => {
    vi.stubGlobal('fetch', undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { ops } = mount();
    await waitFor(() => { expect(html()).toBe('failed'); });
    expect(ops.summary().errors).toEqual({ 'model-failed': 1 });
    expect(ops.summary().events).toBe(1);                              // one failure recorded, not four
  });
});
