// The verdict engine (link checker, domain-name model, chat helpers, message checker) must behave exactly like the JavaScript that ships today.
// Inputs: every string in the existing test suites, the Hinglish corpus, every labelled question, and seeded generators of hostile URLs, UPI codes and messages.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import * as Core from './core';
import * as Link from './linkcheck';
import * as Msg from './msgcheck';
import * as Url from './urlmodel';
import type { Model } from './urlmodel';
import Q from '../../../tests/fixtures/chat_questions.json';
import HINGLISH from '../../../tests/fixtures/hinglish.json';

vi.setConfig({ testTimeout: 120_000 });
const root = resolve(import.meta.dirname, '../../..');
const legacy = createRequire(import.meta.url);
/* The old modules share one linkcheck instance; the name model is installed into it only after the rules-only comparison. */
const oLink: any = legacy('../../../lib/linkcheck.js'), oCore: any = legacy('../../../lib/core.js'), oMsg: any = legacy('../../../lib/msgcheck.js');

const mulberry32 = (a: number) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const same = (a: unknown, b: unknown, why = ''): void => expect(JSON.parse(JSON.stringify(a ?? null)), why).toEqual(JSON.parse(JSON.stringify(b ?? null)));

/** Every quoted string of at least `min` characters in a file: the inputs the existing suites chose, reused as a corpus. */
function literals(file: string, min = 6): string[] {
  const src = readFileSync(resolve(root, file), 'utf8'), out = new Set<string>();
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? '';
    const s = raw.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    if (s.length >= min && !/^\.{0,2}\//.test(s) && !s.startsWith('node:')) out.add(s);
  }
  return [...out];
}
const corpusTexts = [...literals('tests/msgcheck.test.js', 12), ...literals('tests/core.test.js', 8), ...literals('tests/hinglish.test.js', 12), ...literals('tests/chat_context.test.js', 12),
  ...(HINGLISH.scams as unknown as string[] ?? []), ...(HINGLISH.genuine as unknown as string[] ?? []), ...[...Q.dev, ...Q.heldout, ...Q.fresh, ...Q.probe].map(x => x.q)];
const corpusLinks = [...literals('tests/linkcheck.test.js', 4), ...literals('tests/core.test.js', 4), ...literals('tests/qr.test.js', 4), ...literals('tests/urlmodel.test.js', 4)];

const pick = <T,>(rnd: () => number, xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
function genUrl(rnd: () => number): string {
  const brands = ['sbi', 'hdfc', 'icici', 'paytm', 'phonepe', 'amazon', 'flipkart', 'irctc', 'uidai', 'epfo', 'npci', 'rbi', 'google', 'whatsapp', 'trai'];
  const words = ['kyc', 'update', 'verify', 'login', 'secure', 'refund', 'claim', 'reward', 'support', 'netbanking', 'otp', 'account', 'blocked', 'bonus', 'lottery', 'customs', 'parcel'];
  const tlds = ['com', 'in', 'co.in', 'org', 'net', 'tk', 'ml', 'ga', 'xyz', 'top', 'click', 'live', 'gov.in', 'bank.in', 'fin.in', 'co.uk', 'ru', 'sbi'];
  const odd = ['а', 'о', 'е', 'ѕ', 'і', '0', '1', 'xn--', '--', '-', '_', '.', '..', '‮', '​'];
  let host = '';
  const n = 1 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) host += (i ? (rnd() < 0.6 ? '-' : '.') : '') + (rnd() < 0.5 ? pick(rnd, brands) : pick(rnd, words)) + (rnd() < 0.15 ? pick(rnd, odd) : '') + (rnd() < 0.2 ? String(Math.floor(rnd() * 99)) : '');
  host += '.' + pick(rnd, tlds);
  if (rnd() < 0.08) host = [1, 2, 3, 4].map(() => Math.floor(rnd() * 256)).join('.');
  if (rnd() < 0.05) host = 'xn--' + pick(rnd, ['80ak6aa92e', 'pple-43d', 'bcher-kva', 'abc', '']) + '.com';
  const scheme = pick(rnd, ['https://', 'http://', '', 'HTTPS://', 'hxxp://', 'ftp://', 'javascript:', 'data:text/html,', '//']);
  const user = rnd() < 0.1 ? pick(rnd, ['sbi.co.in@', 'user:pass@', 'a@']) : '';
  const port = rnd() < 0.08 ? ':' + pick(rnd, ['80', '8443', 'abc', '99999']) : '';
  let path = rnd() < 0.7 ? '/' + [pick(rnd, brands), pick(rnd, words), pick(rnd, ['index.php', 'login.aspx', 'a.html', 'news', 'fraud-alert'])].filter(() => rnd() < 0.7).join('/') : '';
  if (rnd() < 0.2) path += '?' + pick(rnd, ['url', 'next', 'redirect', 'q', 'r', 'x']) + '=' + pick(rnd, ['https://evil.tk/login', 'http://sbi-kyc.xyz', 'not a url', 'https://www.sbi.co.in/']);
  if (rnd() < 0.05) path = path.replace('/', '\\');
  return scheme + user + host + port + path + (rnd() < 0.04 ? ' ' + pick(rnd, ['now', 'urgent']) : '');
}
function genUpi(rnd: () => number): string {
  const params: string[] = [];
  const add = (k: string, v: string): void => { params.push((rnd() < 0.15 ? k.toUpperCase() : k) + '=' + encodeURIComponent(v)); };
  if (rnd() < 0.9) add('pa', pick(rnd, ['shop@oksbi', 'sbi.support@ybl', 'refund.kyc@paytm', 'rbi-customer-care@icici', 'a', 'x@y', 'name@bank', '', 'lottery.winner@axl']));
  if (rnd() < 0.8) add('pn', pick(rnd, ['Shop', 'SBI Support', 'Customer Care', 'Refund Dept', 'Ravi Kumar', '', 'CBI Officer', 'Prize Claim']));
  if (rnd() < 0.5) add('am', pick(rnd, ['100', '0', '-5', '99999999999', '1.50', 'abc', '5000']));
  if (rnd() < 0.3) add('tn', pick(rnd, ['refund', 'cashback prize', 'kyc', 'rent', 'lottery claim']));
  if (rnd() < 0.2) add('cu', pick(rnd, ['INR', 'USD']));
  if (rnd() < 0.1) add('pa', 'second@payee');
  const action = pick(rnd, ['pay', 'pay', 'pay', 'mandate', 'collect', 'weird', '']);
  return pick(rnd, ['upi://', 'upi:', 'UPI://', 'phonepe://', 'paytmmp://', 'gpay://']) + action + '?' + params.join('&');
}
function genMessage(rnd: () => number): string {
  const phrases = ['your account will be blocked', 'update kyc immediately', 'share your otp', 'do not share your otp', 'send your cvv', 'pay a processing fee', 'you have won a lottery', 'click the link', 'call back on this number',
    'stay on the call', 'do not tell anyone', 'install anydesk', 'guaranteed returns', 'work from home earn daily', 'your parcel is held at customs', 'cbi officer arrest warrant', 'approve the request to receive', 'refund is pending',
    'card will be blocked', 'within 24 hours', 'electricity will be disconnected tonight', 'scan this qr to receive money', 'I have your private video', 'sent to you by mistake please return',
    'aapka account band ho jayega', 'otp batao', 'OTP kisi ko na batayein', 'turant kyc update karo', 'ghar baithe kamao', 'అకౌంట్ బ్లాక్ అవుతుంది', 'ओटीपी शेयर करें', 'your OTP is 482913', 'delivery partner at your door',
    'Dear customer', 'thank you', 'meeting at 5pm', 'rs 5,000 debited', 'http://sbi-kyc-update.tk/login', 'https://www.sbi.co.in/', 'upi://pay?pa=a@b&pn=SBI%20Support', 'call 9876543210'];
  const noise = ['hello', 'ok', 'today', 'please', '😀', '...', '!!', 'the', 'and', 'urgent', 'sir', '\n', '  '];
  const n = 1 + Math.floor(rnd() * 5), out: string[] = [];
  for (let i = 0; i < n; i++) out.push(rnd() < 0.7 ? pick(rnd, phrases) : pick(rnd, noise));
  let t = out.join(rnd() < 0.5 ? ' ' : '. ');
  if (rnd() < 0.15) t = t.replace(/o/g, '0'); if (rnd() < 0.1) t = t.toUpperCase(); if (rnd() < 0.08) t = t.split('').join(' ');
  return t;
}

describe('rules only (no domain-name model installed)', () => {
  test('link checks: identical verdicts, reasons, codes and fields on the suites\' own links and 4,000 generated ones', () => {
    const rnd = mulberry32(2026), inputs = [...corpusLinks, ...Array.from({ length: 4000 }, () => genUrl(rnd)), '', '   ', 'x'.repeat(5000), 'http://' + 'a.'.repeat(300) + 'com'];
    for (const raw of inputs) { same(Link.analyzeUrl(raw), oLink.analyzeUrl(raw), 'analyzeUrl ' + raw); same(Link.analyzePayload(raw), oLink.analyzePayload(raw), 'analyzePayload ' + raw); same(Core.checkLink(raw), oCore.checkLink(raw), 'checkLink ' + raw); }
    expect(inputs.length).toBeGreaterThan(4200);
  });
  test('payment codes and UPI IDs: identical results on 3,000 generated codes', () => {
    const rnd = mulberry32(77);
    for (let i = 0; i < 3000; i++) { const raw = genUpi(rnd); same(Link.analyzeUpi(raw), oLink.analyzeUpi(raw), raw); same(Link.analyzePayload(raw), oLink.analyzePayload(raw), raw); }
  });
  test('the small helpers agree: registrable domains, splitting, punycode, edit distance, unicode hosts', () => {
    const rnd = mulberry32(5);
    for (let i = 0; i < 1500; i++) {
      const u = genUrl(rnd).replace(/^[a-z:]*\/\//i, '').split(/[/?]/)[0] ?? '';
      expect(Link.registrableDomain(u), u).toBe(oLink.registrableDomain(u)); same(Link.splitDomain(u), oLink.splitDomain(u), u); expect(Link.hostToUnicode(u), u).toBe(oLink.hostToUnicode(u));
    }
    for (const [a, b] of [['kitten', 'sitting'], ['sbi', 'sbl'], ['paytm', 'paytn'], ['', 'abc'], ['same', 'same'], ['ab', 'ba'], ['hdfcbank', 'hdfcbnak']] as const) for (const cap of [1, 2, 4]) expect(Link.damerau(a, b, cap)).toBe(oLink.damerau(a, b, cap));
    for (const w of ['80ak6aa92e', 'pple-43d', 'bcher-kva', 'abc', '', '--', '-x']) { let a: unknown, b: unknown; try { a = Link.punycodeDecode(w); } catch (e) { a = (e as Error).constructor.name; } try { b = oLink.punycodeDecode(w); } catch (e) { b = (e as Error).constructor.name; } expect(a, w).toBe(b); }
    same(Link.BRANDS, oLink.BRANDS); same(Link.OFFICIAL_DOMAINS, oLink.OFFICIAL_DOMAINS); same(Link.LEVELS, oLink.LEVELS); expect(Link.UPI_TRUTH).toBe(oLink.UPI_TRUTH);
  });
  test('chat helpers: intents, money-loss, links in text, small talk, names, speech provider, normalisation', () => {
    const rnd = mulberry32(11), texts = [...corpusTexts, ...Array.from({ length: 1500 }, () => genMessage(rnd))];
    for (const t of texts) {
      expect(Core.detectIntent(t), t).toBe(oCore.detectIntent(t)); expect(Core.isGeneralMoneyLoss(t), t).toBe(oCore.isGeneralMoneyLoss(t)); expect(Core.findLinkIn(t), t).toBe(oCore.findLinkIn(t));
      expect(Core.normalize(t), t).toBe(oCore.normalize(t)); expect(Core.extractIntroducedName(t), t).toBe(oCore.extractIntroducedName(t));
      const a = Core.matchSmallTalk(t), b = oCore.matchSmallTalk(t); expect(!!a, t).toBe(!!b); if (a && b) { same(a.reply('Ravi'), b.reply('Ravi')); expect(!!a.noMenu).toBe(!!b.noMenu); }
    }
    for (const ua of ['Mozilla/5.0 Chrome/120 Safari/537', 'Mozilla/5.0 Edg/120 Chrome/120', 'Mozilla/5.0 Version/17 Safari/605', 'curl/8', '', null, undefined, 7]) expect(Core.speechProvider(ua)).toBe(oCore.speechProvider(ua));
    same(Core.CHAT_INTENT_KEYWORDS, oCore.CHAT_INTENT_KEYWORDS); same(Core.GENERAL_LOSS_KEYWORDS, oCore.GENERAL_LOSS_KEYWORDS);
  });
  test('message checks: identical verdicts, evidence, quotes, weights, families and next steps on the suites\' own messages and 5,000 generated ones', () => {
    const rnd = mulberry32(31337), inputs = [...corpusTexts, ...Array.from({ length: 5000 }, () => genMessage(rnd)), '', '   ', 'x'.repeat(9000), '😀'.repeat(300), 'otp '.repeat(2000)];
    let flagged = 0;
    for (const t of inputs) { const a = Msg.analyzeMessage(t), b = oMsg.analyzeMessage(t); same(a, b, t); if (a.level !== 'nothing') flagged++; }
    expect(flagged, 'the generated corpus reaches the verdicts, not only "nothing"').toBeGreaterThan(800);
    same(Msg.FAMILIES, oMsg.FAMILIES); same(Msg.RULES.map(r => [r.id, r.w, r.family, r.label]), oMsg.RULES.map((r: any) => [r.id, r.w, r.family, r.label]));
    expect([Msg.SCAM_AT, Msg.SUSPICIOUS_AT]).toEqual([oMsg.SCAM_AT, oMsg.SUSPICIOUS_AT]); same(Msg.LEVELS, oMsg.LEVELS);
    for (const t of inputs.slice(0, 400)) same(Msg.prepare(t), oMsg.prepare(t), t);
  });
});

describe('with the shipped domain-name model installed in both', () => {
  const modelJson = readFileSync(resolve(root, 'data/urlmodel.json'), 'utf8');
  const oUrl: any = legacy('../../../lib/urlmodel.js');       // installs the shipped model into the old link checker when it loads
  Url.install(JSON.parse(modelJson) as Model);

  test('the model gives the same score, band and card for every host, and the same refusals for damaged files', () => {
    const rnd = mulberry32(8), hosts = [...Array.from({ length: 3000 }, () => (genUrl(rnd).replace(/^[a-z:]*\/\//i, '').split(/[/?]/)[0] ?? '').replace(/^.*@/, '')), '', 'localhost', '1.2.3.4', 'a.co', 'xn--80ak6aa92e.com', 'sbi.co.in', 'blogspot.com'];
    const oModel = oUrl.current(), model = Url.current() as Model;
    expect(model).not.toBeNull();
    for (const h of hosts) same(Url.score(h, model), oUrl.score(h, oModel), h);
    for (const [n, s] of [['sbi', '.co.in'], ['a1b2c3-secure', 'tk'], ['', ''], ['x', 'com']] as const) { same(Url.engineered(n, s), oUrl.engineered(n, s)); same(Url.features(n, s, model.spec), oUrl.features(n, s, oModel.spec)); }
    for (const x of [0, 1.5, 7, 1e9, -3, NaN]) for (const edges of [[1, 2, 3], [], [0.5]]) expect(Url.binOf(edges, x)).toBe(oUrl.binOf(edges, x));
    same(Url.layout(model.spec), oUrl.layout(oModel.spec)); expect(Url.fnv('hello', 0)).toBe(oUrl.fnv('hello', 0)); same(Url.KEYS, oUrl.KEYS); same(Url.BRANDS, oUrl.BRANDS); same(Url.ENGINEERED, oUrl.ENGINEERED);
    const damaged: unknown[] = [null, 1, {}, { ...JSON.parse(modelJson), scale: 0 }, { ...JSON.parse(modelJson), bias: 'x' }, { ...JSON.parse(modelJson), tld: [] }, { ...JSON.parse(modelJson), calibration: null }, { ...JSON.parse(modelJson), thresholds: { high: { score: 1 }, elevated: { score: 2 } } },
      { ...JSON.parse(modelJson), ngram: { idx: [-1], q: [1] } }, { ...JSON.parse(modelJson), spec: { ...JSON.parse(modelJson).spec, hashBits: 99 } }, JSON.parse(modelJson)];
    for (const bad of damaged) { const r = (f: (x: any) => unknown): string => { try { f(bad); return 'ok'; } catch (e) { return (e as Error).message; } }; expect(r(Url.validate)).toBe(r(oUrl.validate)); }
  });
  test('link results with the model applied are identical, including the name-model state and the warning it adds', () => {
    const rnd = mulberry32(404), inputs = [...corpusLinks, ...Array.from({ length: 3000 }, () => genUrl(rnd))];
    let applied = 0, warned = 0;
    for (const raw of inputs) { const a = Link.analyzePayload(raw), b = oLink.analyzePayload(raw); same(a, b, raw); if (a.nameModel === 'applied') applied++; if (a.codes.includes('name-model')) warned++; }
    expect(applied).toBeGreaterThan(300); expect(warned, 'the model sometimes lifts an address to suspicious').toBeGreaterThan(0);
    for (const t of corpusTexts.slice(0, 800)) same(Msg.analyzeMessage(t), oMsg.analyzeMessage(t), t);
  });
  test('removing the model puts the checker back on its rules, in both', () => {
    Url.install(null); oUrl.install(null);
    for (const raw of ['http://sbi-kyc-update.tk/login', 'http://paytm-secure-login.xyz', 'https://www.sbi.co.in/']) { same(Link.analyzePayload(raw), oLink.analyzePayload(raw), raw); expect(Link.analyzePayload(raw).nameModel).not.toBe('applied'); }
    Url.install(JSON.parse(modelJson) as Model); oUrl.install(JSON.parse(modelJson));
  });
});
