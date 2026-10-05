import { useCallback, useEffect, useReducer, useState } from 'react';
import { act, greeting, reply } from '../../engine/assistant';
import type { Chip, Context, ModelStatus } from '../../engine/assistant';
import { chatReducer, INITIAL, isTyping, restore, serialise, STORAGE_KEY } from '../chatState';
import type { ChatMessage, ChatState } from '../chatState';
import { createAppOps } from '../appOps';
import type { Ops } from '../appOps';

export interface UseChatOptions {
  /** Show everything at once (tests, and people who ask for reduced motion). */
  instant?: boolean;
  ops?: Ops;
  now?: () => number;
  modelStatus?: ModelStatus;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

const safeStorage = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null => { try { return window.sessionStorage; } catch { return null; } };

function readSaved(storage: UseChatOptions['storage']): ChatState | null {
  try { return restore(storage?.getItem(STORAGE_KEY) ?? null); } catch { return null; }
}

/** How long the assistant "types" before showing a piece: a little longer for a longer piece. */
export function typingDelay(m: ChatMessage): number {
  if (m.from !== 'bot') return 0;
  const length = m.block.type === 'text' ? m.block.text.length : 160;
  return 320 + Math.min(520, length * 3);
}

export function useChat(options: UseChatOptions = {}) {
  const { instant = false, now = Date.now, modelStatus = 'absent' } = options;
  const [storage] = useState(() => (options.storage === undefined ? safeStorage() : options.storage));
  const [ops] = useState<Ops>(() => options.ops ?? createAppOps());
  const [version, setVersion] = useState(0);
  const [state, dispatch] = useReducer(chatReducer, INITIAL, (initial): ChatState => readSaved(storage) ?? chatReducer(initial, { type: 'bot', reply: greeting(), instant: true }));

  useEffect(() => { try { storage?.setItem(STORAGE_KEY, serialise(state)); } catch { /* storage full or blocked: the chat still works */ } }, [storage, state]);

  // The assistant shows what it decided to say one piece at a time.
  const head = state.queue[0];
  useEffect(() => {
    if (!head) return undefined;
    const timer = setTimeout(() => dispatch({ type: 'reveal' }), typingDelay(head));
    return () => clearTimeout(timer);
  }, [head]);

  const context = useCallback((): Context => ({ now: now(), modelStatus }), [now, modelStatus]);
  const record = useCallback((events: readonly Record<string, unknown>[]) => { for (const e of events) ops.record(e); if (events.length) setVersion(v => v + 1); }, [ops]);

  const send = useCallback((raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const r = reply(text, state.session, context());
    dispatch({ type: 'user', text });
    dispatch({ type: 'bot', reply: r, instant });
    record(r.events);
  }, [state.session, context, instant, record]);

  const press = useCallback((chip: Chip) => {
    const action = chip.action;
    if (!action) return;
    dispatch({ type: 'chipsUsed' });
    if (action.type === 'ask') { send(action.text); return; }
    const r = act(action, state.session, context());
    dispatch({ type: 'bot', reply: r, instant });
    record(r.events);
  }, [state.session, context, instant, record, send]);

  const erase = useCallback((extraKeys: readonly string[] = []) => {
    ops.clear(); setVersion(v => v + 1);
    try { for (const k of [STORAGE_KEY, ...extraKeys]) storage?.removeItem(k); } catch { /* ignore */ }
    dispatch({ type: 'reset' });
    dispatch({ type: 'bot', reply: greeting(), instant: true });
  }, [ops, storage]);

  return { state, typing: isTyping(state), send, press, erase, ops, version };
}
