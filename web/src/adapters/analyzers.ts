import core from '../../../lib/core.js';
import msgcheck from '../../../lib/msgcheck.js';
import type { LinkVerdict, MessageFamily, MessageVerdict, SmallTalkRule } from './types';

/** A result and how long it took, in milliseconds (for the on-device speed target). */
export interface Timed<T> { value: T; ms: number }
const timed = <T>(run: () => T): Timed<T> => { const t0 = performance.now(), value = run(); return { value, ms: performance.now() - t0 }; };

export const analyzeMessage = (text: string): Timed<MessageVerdict> => timed(() => msgcheck.analyzeMessage(text));
export const checkLink = (raw: string): Timed<LinkVerdict> => timed(() => core.checkLink(raw));
export const FAMILIES: Readonly<Record<string, MessageFamily>> = msgcheck.FAMILIES;
export const RULE_IDS: readonly string[] = msgcheck.RULES.map(r => r.id);
export const detectIntent = (text: string): string | null => core.detectIntent(text);
export const isGeneralMoneyLoss = (text: string): boolean => core.isGeneralMoneyLoss(text);
export const findLinkIn = (text: string): string | null => core.findLinkIn(text);
export const matchSmallTalk = (text: string): SmallTalkRule | null => core.matchSmallTalk(text);
export const extractIntroducedName = (text: string): string | null => core.extractIntroducedName(text);
