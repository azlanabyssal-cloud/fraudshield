import { useCallback, useEffect, useRef, useState } from 'react';
import { install } from '../../engine/urlmodel';
import type { Model } from '../../engine/urlmodel';

/* The domain-name model is a soft warning added to link checks. Its weights load after the page is usable, so nothing waits on the download, but a failed or corrupt
   download is never silent: it is retried, validated before use, announced on the page (data-name-model, the fs:model event, the console) and said out loud in every link
   verdict that it would have informed. The rules keep working without it, and no verdict ever reads as "safe", so a missing model makes the answer weaker and says so (ADR-0016). */
export type NameModelStatus = 'loading' | 'ready' | 'failed';
export interface NameModelOptions {
  /** Turn the loader off (tests that supply a fixed status). */
  enabled?: boolean;
  url?: string;
  /** Waits before each retry; after the last one the load is reported as failed. */
  retryMs?: readonly number[];
  /** Told when the load fails for good, with the reason as a short code (the on-device record keeps only that). */
  onFail?: (code: 'model-invalid' | 'model-failed') => void;
}
export const DEFAULT_RETRY_MS: readonly number[] = [1500, 4000, 9000];

export function useNameModel({ enabled = true, url = './data/urlmodel.json', retryMs = DEFAULT_RETRY_MS, onFail }: NameModelOptions = {}) {
  const [status, setStatus] = useState<NameModelStatus>('loading');
  const attempts = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), alive = useRef(true), failure = useRef(onFail);
  const again = useRef<() => void>(() => undefined);   // a retry calls the latest attempt, so the callback below never refers to itself
  useEffect(() => { failure.current = onFail; });

  const announce = useCallback((s: NameModelStatus): void => {
    setStatus(s);
    document.documentElement.setAttribute('data-name-model', s);
    try { window.dispatchEvent(new CustomEvent('fs:model', { detail: { status: s, attempts: attempts.current } })); } catch { /* no CustomEvent */ }
  }, []);

  const attempt = useCallback((): void => {
    attempts.current++;
    // everything happens after the current render, never inside it
    Promise.resolve()
      .then(() => { if (typeof fetch !== 'function') throw new Error('unsupported'); return fetch(url, { cache: 'no-cache' }); })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('http-' + String(r.status)))))
      .then((m: unknown) => { install(m as Model); if (alive.current) announce('ready'); })
      .catch((err: unknown) => {
        if (!alive.current) return;
        const message = err instanceof Error ? err.message : String(err);
        const wait = message === 'unsupported' ? undefined : retryMs[attempts.current - 1];   // a browser with no fetch will not get one by waiting
        if (wait !== undefined) { timer.current = setTimeout(() => { again.current(); }, wait); return; }
        announce('failed');
        failure.current?.(/^urlmodel:/.test(message) ? 'model-invalid' : 'model-failed');
        console.error('FraudShield: the domain-name check could not be loaded (' + message + '). Link checks are running on the written rules only.');
      });
  }, [announce, retryMs, url]);

  useEffect(() => { again.current = attempt; }, [attempt]);

  useEffect(() => {
    if (!enabled) return undefined;
    alive.current = true;
    document.documentElement.setAttribute('data-name-model', 'loading');   // the page announces that the check is on its way, before the first answer
    attempt();
    return () => { alive.current = false; clearTimeout(timer.current); };
  }, [enabled, attempt]);

  /** Try again from the start: the person asked for it, or the page was brought back online. */
  const retry = useCallback((): void => { clearTimeout(timer.current); attempts.current = 0; announce('loading'); attempt(); }, [announce, attempt]);
  return { status, retry };
}
