/* The analyzers as the assistant uses them: each check also reports how long it took, for the on-device speed target. */
import * as Core from './core';
import type { CheckedLink } from './core';
import * as Msg from './msgcheck';
import type { MessageVerdict } from './msgcheck';

/** A result and how long it took, in milliseconds. */
export interface Timed<T> { value: T; ms: number }
const timed = <T>(run: () => T): Timed<T> => { const t0 = performance.now(), value = run(); return { value, ms: performance.now() - t0 }; };

export const analyzeMessage = (text: string): Timed<MessageVerdict> => timed(() => Msg.analyzeMessage(text));
export const checkLink = (raw: string): Timed<CheckedLink> => timed(() => Core.checkLink(raw));
export const FAMILIES = Msg.FAMILIES;
export const RULE_IDS: readonly string[] = Msg.RULES.map(r => r.id);
export const { detectIntent, isGeneralMoneyLoss, findLinkIn, matchSmallTalk, extractIntroducedName, speechProvider } = Core;
