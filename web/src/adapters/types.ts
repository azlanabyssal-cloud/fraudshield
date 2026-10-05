import type { FamilyAdvice } from '../engine/followup';
import type { Level } from '../engine/ops';

/** One piece of evidence the message checker quotes. */
export interface MessageEvidence { id: string; family: string; weight: number; label: string; quote: string; count?: number }
export interface LinkVerdict {
  kind: string;
  level: Exclude<Level, 'nothing'>;
  headline: string;
  reasons: string[];
  codes: string[];
  host?: string | null;
  brand?: string | null;
  nameModel?: 'applied' | 'not-loaded' | 'not-applicable';
}
export interface MessageVerdict {
  kind: 'message';
  level: Level;
  score: number;
  family: string | null;
  headline: string;
  evidence: MessageEvidence[];
  link: LinkVerdict | null;
  next: string[];
  intent: string | null;
  codes: string[];
}
export interface MessageFamily extends FamilyAdvice { name: string; intent: string | null }
/** lib/msgcheck.js, the message checker that has not been ported yet. */
export interface MessageApi { analyzeMessage(text: string): MessageVerdict; FAMILIES: Record<string, MessageFamily>; RULES: readonly { id: string }[] }
export interface SmallTalkRule { reply(name?: string | null): string[]; noMenu?: boolean }
/** lib/core.js, the link checker and chat helpers that have not been ported yet. */
export interface CoreApi {
  detectIntent(text: string): string | null;
  isGeneralMoneyLoss(text: string): boolean;
  checkLink(raw: string): LinkVerdict;
  findLinkIn(text: string): string | null;
  matchSmallTalk(text: string): SmallTalkRule | null;
  extractIntroducedName(text: string): string | null;
  speechProvider(userAgent: string): string;
}
