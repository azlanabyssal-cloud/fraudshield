import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';
const subscribe = (cb: () => void): (() => void) => {
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
  mq?.addEventListener('change', cb);
  return () => mq?.removeEventListener('change', cb);
};
const snapshot = (): boolean => (typeof window.matchMedia === 'function' ? window.matchMedia(QUERY).matches : false);

/** Whether the person asked their device for less motion. Read from the browser, kept in step if they change it. */
export function useReducedMotion(): boolean { return useSyncExternalStore(subscribe, snapshot, () => false); }
