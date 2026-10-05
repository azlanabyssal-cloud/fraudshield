// The TypeScript engine must behave exactly like the JavaScript that ships today. Every comparison runs the old and the new module on the same input and
// requires identical output: all 596 labelled questions, thousands of seeded random inputs, hostile objects, every follow-up topic, and every lexicon entry.
import { test, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import * as K from './knowledge';
import * as U from './utterance';
import * as F from './followup';
import * as O from './ops';
import * as Fmt from './format';
import * as H from './hinglish';
import Q from '../../../tests/fixtures/chat_questions.json';

// These run thousands of inputs through two implementations; a shared CI machine is several times slower than a laptop, so they get a generous limit instead of the default 5 s.
vi.setConfig({ testTimeout: 60_000 });

const legacy = createRequire(import.meta.url);
const oK: any = legacy('../../../lib/knowledge.js'), oU: any = legacy('../../../lib/utterance.js'), oF: any = legacy('../../../lib/followup.js'),
  oO: any = legacy('../../../lib/ops.js'), oFmt: any = legacy('../../../lib/format.js'), oH: any = legacy('../../../lib/hinglish.js');

function mulberry32(a: number): () => number { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const questions: string[] = [...Q.dev, ...Q.heldout, ...Q.fresh, ...Q.probe].map(x => x.q);
const same = (a: unknown, b: unknown): void => expect(JSON.parse(JSON.stringify(a ?? null))).toEqual(JSON.parse(JSON.stringify(b ?? null)));

function soup(rnd: () => number, n: number): string[] {
  const vocab = K.ENTRIES.flatMap(e => e.m.flat().flatMap(g => g.split('|'))).map(a => a.replace(/\*$/, '').replace(/_/g, ' ')).filter(Boolean);
  const junk = ['constructor', '__proto__', 'toString', '\u0000', '‮', '😀', 'ﬁ', '..', '--', 'a.b.c', "o'neil", 'क्', '?', ',', 'u', 'ur', 'wat', 'x'.repeat(300)];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const len = 1 + Math.floor(rnd() * 28), parts: string[] = [];
    for (let j = 0; j < len; j++) parts.push(rnd() < 0.2 ? junk[Math.floor(rnd() * junk.length)] ?? '' : vocab[Math.floor(rnd() * vocab.length)] ?? '');
    out.push(parts.join(rnd() < 0.5 ? ' ' : '  ?, '));
  }
  return out;
}

test('knowledge: the same entry, score, alternatives, question shape and suggestions on every labelled question and 4,000 random inputs', () => {
  const rnd = mulberry32(20261005), inputs = [...questions, ...soup(rnd, 4000), '', '   ', '?!', 'x'.repeat(4000)];
  for (const q of inputs) {
    const a = K.route(q), b = oK.route(q);
    expect(a ? [a.entry.id, a.score, a.alternatives.map(e => e.id)] : null, q).toEqual(b ? [b.entry.id, b.score, b.alternatives.map((e: any) => e.id)] : null);
    expect(K.isQuestion(q)).toBe(oK.isQuestion(q)); expect(K.askable(q)).toBe(oK.askable(q));
    expect(K.suggest(q, 3).map(e => e.id)).toEqual(oK.suggest(q, 3).map((e: any) => e.id));
    expect(K.tokens(q)).toEqual(oK.tokens(q));
  }
  expect(K.ENTRIES.map(e => e.id)).toEqual(oK.ENTRIES.map((e: any) => e.id));
  for (const e of K.ENTRIES) { same(e.a, oK.byId(e.id).a); same(K.explain(e.q, e.id), oK.explain(e.q, e.id)); }
  same(K.deadPatterns(), oK.deadPatterns());
});

test('utterance: the same verdict on cut-off sentences, hostile values and 3,000 random strings', () => {
  const rnd = mulberry32(7), inputs: unknown[] = [...questions, ...soup(rnd, 3000), null, undefined, 42, {}, [], '', '...', '\u0000', 'what is the main purpose of'];
  for (const t of inputs) expect(U.isIncomplete(t), String(t)).toBe(oU.isIncomplete(t));
  expect([...U.TRAILING].sort()).toEqual([...oU.TRAILING].sort());
});

test('followup: every topic answers identically for every level, with and without a family, and routing and memory agree', () => {
  const levels = ['scam', 'suspicious', 'unverified', 'official', 'nothing'] as const, now = 1_800_000_000_000;
  const families = { kyc: { next: ['Do not click.', 'Call your bank on the number on your card.'] } };
  const topics = F.TOPICS.map(t => t[0]);
  expect(topics).toEqual(oF.TOPICS.map((t: any) => t[0]));
  for (const topic of topics) for (const level of levels) for (const family of [null, 'kyc', 'unknown'] as const) for (const kind of ['message', 'link', 'upi']) {
    const last = F.remember({ kind, level, family, headline: 'Looks like a fake KYC message.', evidence: [{ quote: 'update kyc', label: 'It demands KYC now.' }, { quote: 'x'.repeat(200), label: 'y'.repeat(400) }] }, now);
    same(last, oF.remember({ kind, level, family, headline: 'Looks like a fake KYC message.', evidence: [{ quote: 'update kyc', label: 'It demands KYC now.' }, { quote: 'x'.repeat(200), label: 'y'.repeat(400) }] }, now));
    same(F.reply(topic, last, families), oF.reply(topic, last, families)); same(F.reply(topic, last, null), oF.reply(topic, last, null));
  }
  const last = F.remember({ level: 'scam', family: 'kyc', headline: 'h' }, now);
  for (const q of [...questions, ...soup(mulberry32(3), 1500), 'How do I block this number?', 'maine OTP de diya', 'Is it safe?', null, 42]) {
    expect(F.topicOf(q), String(q)).toBe(oF.topicOf(q)); same(F.route(q, last, families, now), oF.route(q, last, families, now));
    same(F.route(q, last, families, now + 3_700_000), oF.route(q, last, families, now + 3_700_000)); same(F.route(q, null, families, now), oF.route(q, null, families, now));
  }
  expect(F.isFresh(last, now - 1)).toBe(oF.isFresh(last, now - 1)); expect(F.isFresh(undefined, now)).toBe(oF.isFresh(undefined, now));
});

test('ops: the same event is kept or refused, hostile objects are cleaned the same way, and the summary is identical', () => {
  const rnd = mulberry32(99), clock = { t: 1_800_000_000_000 };
  const known = { family: ['kyc', 'otp'], rules: ['r1', 'r2', 'r3'], topic: ['block', 'safe', 'privacy'], code: ['ocr-failed'] };
  const mk = (OpsMod: any) => OpsMod.createOps({ now: () => clock.t, known, capacity: 50 });
  const a = mk(O), b = mk(oO);
  const pickOne = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
  for (let i = 0; i < 600; i++) {
    clock.t += Math.floor(rnd() * 90_000);
    const raw: Record<string, unknown> = { kind: pickOne([...O.KINDS, 'bogus', 7, null]), level: pickOne([...O.LEVELS, 'safe', undefined]), family: pickOne(['kyc', 'otp', 'free text here', 'Bad', undefined]),
      rules: pickOne([['r1', 'r2'], ['r1', 'My OTP is 123456'], 'nope', undefined, Array.from({ length: 20 }, (_, k) => 'r' + (k % 3 + 1))]), ms: pickOne([0.123456, 42, -1, NaN, Infinity, 9e9, 'x', undefined]),
      nameModel: pickOne(['applied', 'not-loaded', 'hacked', undefined]), topic: pickOne(['block', 'privacy', 'Free text', undefined]), code: pickOne(['ocr-failed', 'weird-code', 'not valid!', undefined]), hot: pickOne([true, false, 'yes', undefined]), secret: 'must never appear' };
    expect(a.record(raw)).toBe(b.record(raw));
    expect(O.clean(raw, clock.t, known)).toEqual(oO.clean(raw, clock.t, known));
  }
  same(a.summary(), b.summary()); same(a.events, b.events); expect(a.size).toBe(b.size);
  expect(JSON.stringify(a.events)).not.toContain('must never appear'); expect(JSON.stringify(a.events)).not.toContain('123456');
  a.clear(); b.clear(); same(a.summary(), b.summary());
});

test('format: the same strings and the same refusals across a grid of numbers and every named format', () => {
  const values = [0, 1, 7, 99, 100, 999, 1000, 1234, 99999, 100000, 101928, 123456789, 12345678912, 0.5, 2.675, 1e7, 1e9, -5, -1234567];
  for (const v of values) { expect(Fmt.indian(v)).toBe(oFmt.indian(v)); expect(Fmt.indian(v, 2)).toBe(oFmt.indian(v, 2)); if (v >= 0) expect(Fmt.rupeesCompact(v)).toBe(oFmt.rupeesCompact(v)); for (const f of Object.keys(oFmt.FORMATS)) expect(Fmt.formatStat(v, f), f).toBe(oFmt.formatStat(v, f)); }
  for (const bad of [NaN, Infinity, 'x', undefined, null]) { expect(() => Fmt.indian(bad as number)).toThrow(RangeError); expect(() => oFmt.indian(bad)).toThrow(RangeError); }
  expect(() => Fmt.formatStat(1, 'nope')).toThrow(/unknown format "nope"/); expect(() => Fmt.rupeesCompact(-1)).toThrow(RangeError);
  expect(Object.keys(Fmt.FORMATS)).toEqual(Object.keys(oFmt.FORMATS));
});

test('hinglish: the same spelling folds, the same phrase expansion for every lexicon entry, and the same hits on real messages', () => {
  const rnd = mulberry32(5);
  for (const w of [...soup(rnd, 600).flatMap(s => s.split(/\s+/)), 'phishing', 'kaaro', 'jaldiii', 'nahin', 'hai', 'bhejiye', 'బ్లాక్', 'अकाउंट']) expect(H.canon(w), w).toBe(oH.canon(w));
  expect(Object.keys(H.LEX)).toEqual(Object.keys(oH.LEX));
  for (const id of Object.keys(oH.LEX)) { for (const pat of oH.LEX[id]) same(H.expand(pat), oH.expand(pat)); same([...H.phrases(id as H.LexId)], [...oH.phrases(id)]); }
  const messages = ['Aapka account band ho jayega turant KYC update karo', 'OTP kisi ko na batayein', 'मेरा खाता ब्लॉक हो जाएगा', 'ghar baithe 5000 daily kamao', 'Dear customer 24 ghante me pay karo', 'Your OTP is 123456. Do not share it.', ...questions.slice(0, 120)];
  for (const text of messages) {
    const tokens: H.Token[] = [], oTokens: H.Token[] = [];
    for (const m of text.matchAll(/\S+/g)) { const t = { t: m[0], s: m.index ?? 0, e: (m.index ?? 0) + m[0].length }; tokens.push({ ...t }); oTokens.push({ ...t }); }
    for (const id of Object.keys(oH.LEX)) { same(H.findAt({ text, tokens }, id as H.LexId), oH.findAt({ text, tokens: oTokens }, id)); same(H.find({ text, tokens }, id as H.LexId), oH.find({ text, tokens: oTokens }, id)); }
  }
  expect(H.compiledCount()).toBeGreaterThan(0);
});
