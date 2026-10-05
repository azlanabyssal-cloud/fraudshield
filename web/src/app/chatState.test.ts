import { describe, expect, test } from 'vitest';
import { act, greeting, NEW_SESSION, reply } from '../engine/assistant';
import { chatReducer, INITIAL, isTyping, openChips, restore, serialise } from './chatState';
import type { ChatState } from './chatState';

const ctx = { now: 1_800_000_000_000, modelStatus: 'ready' } as const;
const run = (events: Parameters<typeof chatReducer>[1][], from: ChatState = INITIAL): ChatState => events.reduce(chatReducer, from);

describe('the conversation as a reducer', () => {
  test('instant shows everything at once; otherwise it queues, and buttons appear with the last bubble, not after another pause', () => {
    const r = reply('who made this', NEW_SESSION, ctx);
    const instant = run([{ type: 'bot', reply: r, instant: true }]);
    expect(instant.queue).toHaveLength(0);
    expect(openChips(instant)).not.toBeNull();

    let s = run([{ type: 'bot', reply: r, instant: false }]);
    expect(s.messages).toHaveLength(0);
    expect(isTyping(s)).toBe(true);
    while (s.queue.length) s = chatReducer(s, { type: 'reveal' });
    expect(s.messages.map(m => m.from)).toEqual(['bot', 'bot', 'chips']);   // the answer has two lines; the buttons came with the second
    expect(isTyping(s)).toBe(false);
  });
  test('sending a message removes the old buttons; pressing one removes them too; ids never repeat', () => {
    let s = run([{ type: 'bot', reply: greeting(), instant: true }]);
    expect(openChips(s)).not.toBeNull();
    s = chatReducer(s, { type: 'user', text: 'hello' });
    expect(s.messages.some(m => m.from === 'chips')).toBe(false);
    s = run([{ type: 'bot', reply: act({ type: 'menu' }, s.session, ctx), instant: true }, { type: 'chipsUsed' }], s);
    expect(openChips(s)).toBeNull();
    const ids = s.messages.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  test('the conversation never grows without limit', () => {
    let s: ChatState = INITIAL;
    for (let i = 0; i < 300; i++) s = chatReducer(s, { type: 'user', text: 'message ' + i });
    expect(s.messages.length).toBeLessThanOrEqual(120);
    expect(s.messages.at(-1)).toMatchObject({ text: 'message 299' });
  });
});

describe('what is kept for the tab is never trusted when it is read back', () => {
  const good = run([{ type: 'user', text: 'hi' }, { type: 'bot', reply: reply('who made this', NEW_SESSION, ctx), instant: true }]);
  test('a saved conversation comes back whole', () => {
    const back = restore(serialise(good));
    expect(back?.messages).toEqual(good.messages);
    expect(back?.session).toEqual(good.session);
    expect(back?.queue).toEqual([]);
    expect(back!.nextId).toBeGreaterThan(Math.max(...good.messages.map(m => m.id)));
  });
  test('damaged, old, hostile or empty values are ignored, never thrown', () => {
    for (const bad of [null, '', '{', 'null', '[]', '{"v":2}', '{"v":1}', '{"v":1,"messages":[],"session":{},"nextId":1}', JSON.stringify({ v: 1, messages: [{ id: 1, from: 'bot' }], session: { last: null, awaitingLink: false, userName: null }, nextId: 2 }),
      JSON.stringify({ v: 1, messages: [{ id: 'x', from: 'user', text: 'a' }], session: { last: null, awaitingLink: false, userName: null }, nextId: 2 }), '{"__proto__":{"v":1}}'])
      expect(restore(bad), String(bad)).toBeNull();
  });
  test('rows that are not messages are dropped, and the rest are kept', () => {
    const mixed = JSON.stringify({ v: 1, messages: [{ id: 1, from: 'user', text: 'a' }, { id: 2, from: 'wizard' }, 7, null, { id: 3, from: 'user', text: 5 }], session: { last: null, awaitingLink: false, userName: 'Asha' }, nextId: 4 });
    expect(restore(mixed)?.messages).toEqual([{ id: 1, from: 'user', text: 'a' }]);
  });
});
