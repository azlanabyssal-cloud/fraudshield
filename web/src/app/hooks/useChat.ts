import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { act, greeting, pictureReply, reply } from '../../engine/assistant';
import type { Chip, Context, ModelStatus, PictureOutcome, Reply } from '../../engine/assistant';
import { chatReducer, INITIAL, isTyping, restore, serialise, STORAGE_KEY } from '../chatState';
import type { ChatMessage, ChatState } from '../chatState';
import { createAppOps } from '../appOps';
import type { Ops } from '../appOps';
import { browserTools, ToolsMissing } from '../imageTools';
import type { PictureTools } from '../imageTools';

export interface UseChatOptions {
  /** Show everything at once (tests, and people who ask for reduced motion). */
  instant?: boolean;
  ops?: Ops;
  now?: () => number;
  modelStatus?: ModelStatus;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /** What looks at pictures; the real, lazily loaded tools unless a test supplies its own. */
  tools?: PictureTools;
  /** Opens the picture picker (the page owns the file input). */
  pickImage?: () => void;
}

const MAX_FILE_BYTES = 25 * 1024 * 1024;

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
  const { instant = false, now = Date.now, modelStatus = 'absent', pickImage } = options;
  const [storage] = useState(() => (options.storage === undefined ? safeStorage() : options.storage));
  const [ops] = useState<Ops>(() => options.ops ?? createAppOps());
  const [tools] = useState<PictureTools>(() => options.tools ?? browserTools());
  const [progress, setProgress] = useState<string | null>(null);
  const busy = useRef(false);
  const [version, setVersion] = useState(0);
  const [state, dispatch] = useReducer(chatReducer, INITIAL, (initial): ChatState => readSaved(storage) ?? chatReducer(initial, { type: 'bot', reply: greeting(), instant: true }));

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });
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
    if (action.type === 'pickImage') { pickImage?.(); return; }
    if (action.type === 'ask') { send(action.text); return; }
    const r = act(action, state.session, context());
    dispatch({ type: 'bot', reply: r, instant });
    record(r.events);
  }, [state.session, context, instant, record, send, pickImage]);

  // Pictures: prepare (shrink), look for a QR code, and only if there is none read the text. Everything is decided by pictureReply; this only runs the steps and shows progress.
  const urls = useRef<string[]>([]);
  useEffect(() => () => { for (const u of urls.current) URL.revokeObjectURL(u); }, []);
  const attach = useCallback(async (file: File | null | undefined): Promise<void> => {
    if (!file || !file.type.startsWith('image/')) return;
    const say = (outcome: PictureOutcome, extra: readonly Record<string, unknown>[] = []): void => {
      const r: Reply = pictureReply(outcome, stateRef.current.session, context());
      dispatch({ type: 'bot', reply: r, instant });
      record([...extra, ...r.events]);
    };
    if (busy.current) { say({ kind: 'busy' }); return; }
    if (file.size > MAX_FILE_BYTES) { say({ kind: 'file-too-big' }); return; }
    busy.current = true; setProgress('🖼️ Preparing the picture…');
    try {
      let blob: Blob;
      try { blob = await tools.prepare(file); }
      catch (err) { say(err instanceof ToolsMissing ? { kind: 'tools-missing' } : { kind: (err as { code?: string }).code === 'too-large' ? 'picture-too-large' : 'picture-unreadable' }); return; }
      const url = URL.createObjectURL(blob); urls.current.push(url);
      dispatch({ type: 'chipsUsed' }); dispatch({ type: 'image', url });
      setProgress('🔍 Looking for a QR code…');
      const found = await tools.inspect(blob).catch(() => ({ text: null, structure: { qr: false, certainty: null } }));
      if (found.text) { say({ kind: 'qr-text', text: found.text }); return; }
      if (found.structure.qr) { say({ kind: 'qr-unreadable', certainty: found.structure.certainty }); return; }   // never fall back to the words around a code that cannot be read
      setProgress('🔍 Preparing image reader…');
      const wasHot = tools.hot, t0 = performance.now();
      try {
        const text = await tools.recognize(blob, m => {
          if (m.status === 'recognizing text') setProgress('🔍 Reading image — ' + Math.round((m.progress ?? 0) * 100) + '%');
          else if (m.status) setProgress('🔍 ' + m.status.charAt(0).toUpperCase() + m.status.slice(1) + '…');
        });
        say({ kind: 'text', text }, [{ kind: 'ocr', ms: performance.now() - t0, hot: wasHot }]);
      } catch (err) {
        console.error('FraudShield: the text reader failed (' + (err instanceof Error ? err.message : String(err)) + ').');
        say({ kind: 'reader-failed', loaded: !(err instanceof ToolsMissing) });
      }
    } finally { busy.current = false; setProgress(null); }
  }, [context, instant, record, tools]);

  const erase = useCallback((extraKeys: readonly string[] = []) => {
    ops.clear(); setVersion(v => v + 1);
    try { for (const k of [STORAGE_KEY, ...extraKeys]) storage?.removeItem(k); } catch { /* ignore */ }
    for (const u of urls.current) URL.revokeObjectURL(u);
    urls.current = [];
    dispatch({ type: 'reset' });
    dispatch({ type: 'bot', reply: greeting(), instant: true });
  }, [ops, storage]);

  return { state, typing: isTyping(state), send, press, erase, ops, version, attach, progress, tools };
}
