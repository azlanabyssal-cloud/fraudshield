import type { Block, Chip, Reply, Session } from '../engine/assistant';
import { NEW_SESSION } from '../engine/assistant';

/** One bubble in the conversation, or a row of buttons under the last bubble. */
export type ChatMessage =
  | { id: number; from: 'user'; text: string }
  | { id: number; from: 'bot'; block: Block; urgent?: boolean }
  | { id: number; from: 'chips'; chips: Chip[] };

export interface ChatState {
  messages: ChatMessage[];
  /** What the assistant has decided to say but has not shown yet: shown one piece at a time, like a person typing. */
  queue: ChatMessage[];
  session: Session;
  nextId: number;
}
export const INITIAL: ChatState = { messages: [], queue: [], session: NEW_SESSION, nextId: 1 };
const MAX_MESSAGES = 120;

export type ChatEvent =
  | { type: 'user'; text: string }
  | { type: 'bot'; reply: Reply; instant: boolean }
  | { type: 'reveal' }
  | { type: 'chipsUsed' }
  | { type: 'restore'; state: ChatState }
  | { type: 'reset' };

function turnToMessages(reply: Reply, firstId: number): ChatMessage[] {
  const out: ChatMessage[] = reply.blocks.map((block, i) => (block.type === 'text' && block.urgent ? { id: firstId + i, from: 'bot', block, urgent: true } : { id: firstId + i, from: 'bot', block }));
  if (reply.chips.length) out.push({ id: firstId + reply.blocks.length, from: 'chips', chips: reply.chips });
  return out;
}
const trim = (m: ChatMessage[]): ChatMessage[] => (m.length > MAX_MESSAGES ? m.slice(-MAX_MESSAGES) : m);

/** The whole conversation as a pure function of events, so that it can be tested and replayed without a screen. */
export function chatReducer(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case 'user':
      return { ...state, messages: trim([...state.messages.filter(m => m.from !== 'chips'), { id: state.nextId, from: 'user', text: event.text }]), nextId: state.nextId + 1 };
    case 'bot': {
      const made = turnToMessages(event.reply, state.nextId), nextId = state.nextId + made.length;
      return event.instant
        ? { ...state, messages: trim([...state.messages, ...state.queue, ...made]), queue: [], session: event.reply.session, nextId }
        : { ...state, queue: [...state.queue, ...made], session: event.reply.session, nextId };
    }
    case 'reveal': {
      const [head, ...rest] = state.queue;
      if (!head) return state;
      // Buttons appear with the last bubble, not after another pause.
      const take = head.from === 'chips' ? [head] : rest[0]?.from === 'chips' ? [head, rest[0]] : [head];
      return { ...state, messages: trim([...state.messages, ...take]), queue: state.queue.slice(take.length) };
    }
    case 'chipsUsed':
      return { ...state, messages: state.messages.filter(m => m.from !== 'chips') };
    case 'restore':
      return event.state;
    case 'reset':
      return INITIAL;
  }
}

/** True while the assistant still has something to show. */
export const isTyping = (s: ChatState): boolean => s.queue.some(m => m.from === 'bot');

/** The button row currently on offer, if any: the last message, when it is a row of buttons. */
export const openChips = (s: ChatState): Chip[] | null => { const last = s.messages[s.messages.length - 1]; return last?.from === 'chips' ? last.chips : null; };

// ---- what is kept for the tab, and how it is read back: never trusted ----
export const STORAGE_KEY = 'fs_chat_v2';
interface Saved { v: 1; messages: ChatMessage[]; session: Session; nextId: number }
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

export function serialise(s: ChatState): string {
  const saved: Saved = { v: 1, messages: s.messages, session: s.session, nextId: s.nextId };
  return JSON.stringify(saved);
}
/** Reads a saved conversation back. Anything that is not exactly the expected shape is ignored, so a damaged or old value can never break the page. */
export function restore(json: string | null): ChatState | null {
  if (!json) return null;
  try {
    const x: unknown = JSON.parse(json);
    if (!isObj(x) || x.v !== 1 || !Array.isArray(x.messages) || typeof x.nextId !== 'number' || !isObj(x.session)) return null;
    const s = x.session;
    if (typeof s.awaitingLink !== 'boolean' || !(s.userName === null || typeof s.userName === 'string') || !(s.last === null || isObj(s.last))) return null;
    const messages = (x.messages as unknown[]).filter((m): m is ChatMessage => isObj(m) && typeof m.id === 'number' && (m.from === 'user' ? typeof m.text === 'string' : m.from === 'bot' ? isObj(m.block) : m.from === 'chips' && Array.isArray(m.chips)));
    if (!messages.length) return null;
    return { messages: trim(messages), queue: [], session: s as unknown as Session, nextId: Math.max(x.nextId, 1 + Math.max(...messages.map(m => m.id))) };
  } catch { return null; }
}
