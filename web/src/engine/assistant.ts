/* What the assistant says, as a pure function.
   The routing is the one the site has always used (a pasted message is checked as a message; a question after a verdict is about that verdict, unless the knowledge layer can answer it;
   half a sentence is never answered; nothing is guessed), moved out of the page so that it can be tested without a browser and drawn by any view. Given the person's words and what
   the chat remembers, it returns the blocks to show, the buttons to offer, the new memory, and the counts to record (never words). It does no I/O and reads no clock except the one it is given. */
import * as A from './analyze';
import type { CheckedLink } from './core';
import type { MessageVerdict } from './msgcheck';
import { FLOWS, TOP_CHIPS, flowNode } from './flows';
import * as FollowUp from './followup';
import type { LastVerdict, TopicId } from './followup';
import * as Know from './knowledge';
import * as Utter from './utterance';

/** What a button does when it is pressed. Plain data, so a conversation can be stored, replayed and tested. */
export type Action =
  | { type: 'goto'; flow: string; node: string }
  | { type: 'menu' }
  | { type: 'loss' }
  | { type: 'checkLink' }
  | { type: 'ask'; text: string }
  | { type: 'followup'; topic: TopicId };
export interface Chip { label: string; href?: string; cta?: boolean; action?: Action }
export type Block =
  | { type: 'text'; text: string; urgent?: boolean }
  | { type: 'message-verdict'; verdict: MessageVerdict }
  | { type: 'link-verdict'; verdict: CheckedLink };
/** What the chat remembers between turns. */
export interface Session { last: LastVerdict | null; awaitingLink: boolean; userName: string | null }
/** A count or timing to record: the shape lib/ops accepts, which keeps only enumerated fields. */
export type OpsInput = Record<string, unknown>;
export interface Reply { blocks: Block[]; chips: Chip[]; session: Session; events: OpsInput[] }
export type ModelStatus = 'ready' | 'loading' | 'failed' | 'absent';
export interface Context { now: number; modelStatus: ModelStatus }

export const NEW_SESSION: Session = { last: null, awaitingLink: false, userName: null };
/** Said after every link verdict: a link check can never make it safe to type a secret. */
export const LINK_ADVICE = 'Never enter your OTP, UPI PIN, or password after clicking a link or scanning a code, even if it looks official.';
const CALL_1930 = { label: '📞 Paid or shared details? Call 1930', href: 'tel:1930' } as const;

// A pasted scam talks TO the reader ("your KYC expires"); a person describing what happened talks about themselves ("I got a call").
const DESCRIBING_SELF = /^\s*(?:i|my|me|we|mera|meri|mujhe|hum)\b|\b(?:i|we)\s+(?:got|received|have|was|am|just|clicked|paid|shared|lost)\b/i;
const justALink = (text: string, link: string | null): boolean => !!link && link.length >= text.trim().length * 0.8;

const chip = (label: string, extra: Partial<Chip> = {}): Chip => ({ label, ...extra });
const menuChip = (): Chip => chip('🏠 Main Menu', { action: { type: 'menu' } });
const mainMenuChips = (): Chip[] => TOP_CHIPS.map(c => chip(c.label, { action: c.goto === '__checklink__' ? { type: 'checkLink' } : { type: 'goto', flow: c.goto, node: FLOWS[c.goto]?.start ?? '' } }));
const ctaChips = (cta: readonly { label: string; href: string }[] | undefined): Chip[] => (cta ?? []).map(c => chip(c.label, { href: c.href, cta: true }));
const texts = (lines: readonly string[], urgent?: boolean): Block[] => lines.map(text => (urgent ? { type: 'text', text, urgent } : { type: 'text', text }));

interface TurnOptions { urgent?: boolean; options?: Chip[]; cta?: readonly { label: string; href: string }[]; menu?: boolean; blocks?: Block[] }
/** Builds a reply the way the page's botSay did: the lines, then the options, then the call-to-action buttons, then Main Menu unless told not to. */
function say(lines: readonly string[], session: Session, opts: TurnOptions = {}, events: OpsInput[] = []): Reply {
  const chips = [...(opts.options ?? []), ...ctaChips(opts.cta)];
  if (opts.menu !== false) chips.push(menuChip());
  return { blocks: [...(opts.blocks ?? []), ...texts(lines, opts.urgent)], chips, session, events };
}

function gotoNode(flow: string, node: string, session: Session, lead: readonly string[] = []): Reply {
  const n = flowNode(flow, node);
  if (!n) return say(['I lost my place in that guide. Let me start again.'], session, { options: mainMenuChips(), menu: false });
  const options = (n.options ?? []).map(o => chip(o.label, { action: { type: 'goto', flow, node: o.goto } }));
  const blocks = [...texts(lead), ...texts(n.say, n.urgent)];
  return { blocks, chips: [...options, ...ctaChips(n.cta), menuChip()], session, events: [] };
}

function showMainMenu(session: Session): Reply {
  const who = session.userName ? ', ' + session.userName : '';
  return say(['What would you like help with' + who + '? You can also paste a screenshot.'], session, { options: mainMenuChips(), menu: false });
}

const remember = (session: Session, verdict: FollowUp.VerdictInput, now: number): Session => ({ ...session, last: FollowUp.remember(verdict, now) });

function noticeFor(result: CheckedLink, status: ModelStatus): string {
  if (result.nameModel !== 'not-loaded') return '';
  if (status === 'failed') return ' Note: the domain-name check could not load on this device, so this result uses the written rules only. Reload the page to try again.';
  if (status === 'absent') return ' Note: the domain-name check is not part of this build yet, so this result uses the written rules only.';
  return ' Note: the domain-name check is still loading, so this result uses the written rules only. Check again in a few seconds.';
}

function linkReply(raw: string, session: Session, ctx: Context): Reply {
  const { value: result, ms } = A.checkLink(raw), scam = result.level === 'scam';
  const next = remember(session, { kind: result.kind || 'url', level: result.level, headline: result.headline, evidence: (result.reasons ?? []).map(r => ({ quote: '', label: r })) }, ctx.now);
  const reply = say([], next, { urgent: scam, cta: scam ? [CALL_1930] : undefined, blocks: [{ type: 'link-verdict', verdict: result }] },
    [{ kind: 'link', level: result.level, rules: result.codes, ms, nameModel: result.nameModel }]);
  const notice = noticeFor(result, ctx.modelStatus);
  return notice ? { ...reply, blocks: [...reply.blocks, { type: 'text', text: notice.trim() }] } : reply;
}

function messageReply(v: MessageVerdict, ms: number, session: Session, ctx: Context): Reply {
  const scam = v.level === 'scam';
  const next = remember(session, { kind: 'message', level: v.level, family: v.family, intent: v.intent, headline: v.headline, evidence: v.evidence }, ctx.now);
  const options: Chip[] = [];
  if (v.intent && FLOWS[v.intent]) options.push(chip('🧭 Walk me through what to do', { action: { type: 'goto', flow: v.intent, node: FLOWS[v.intent]?.start ?? '' } }));
  options.push(chip('😟 I already clicked, paid or shared', { action: { type: 'loss' } }), menuChip());
  return say([], next, { urgent: scam, menu: false, cta: scam ? [CALL_1930] : undefined, options, blocks: [{ type: 'message-verdict', verdict: v }] },
    [{ kind: 'message', level: v.level, family: v.family, rules: v.codes, ms }]);
}

function nothingFound(v: MessageVerdict, ms: number, session: Session, ctx: Context): Reply {
  const next = remember(session, { kind: 'message', level: 'nothing', headline: v.headline, evidence: [] }, ctx.now);
  return say(['❔ ' + v.headline, v.next.join(' ')], next, { options: mainMenuChips(), menu: false }, [{ kind: 'message', level: 'nothing', ms }]);
}

function generalLoss(session: Session): Reply {
  return say([
    "I'm sorry this happened — let's move fast. Call your bank's helpline right now and report it as a fraudulent transaction. Ask them to block your card or account, and note the complaint number. Under RBI's rules you are generally protected from losses that happen after you report an unauthorised transaction, and delay can cost you that protection. Then call 1930 and report at cybercrime.gov.in too: the sooner the report, the better the chance of freezing the money before it moves on. If any of it is frozen, you can later apply to get it back through the Money Restoration Module on cybercrime.gov.in, using your complaint number.",
    'To get you more specific next steps, what caused it — a phone call, a link, a QR code, or something else? Or pick the closest match below.'
  ], session, { urgent: true, cta: [{ label: '📞 Call 1930 Now', href: 'tel:1930' }], options: mainMenuChips(), menu: false });
}

function followUpReply(f: FollowUp.FollowUpRoute, session: Session): Reply {
  const buttons: Record<FollowUp.ReplyOption, Chip> = {
    call1930: chip('📞 Call 1930', { href: 'tel:1930', cta: true }), report: chip('📝 Report online', { href: 'report.html' }),
    menu: menuChip(), loss: chip('😟 I already clicked, paid or shared', { action: { type: 'loss' } }), steps: chip('🧭 What should I do?', { action: { type: 'followup', topic: 'what' } })
  };
  const acts = f.options.map(k => buttons[k]);
  return say(f.lines, session, { urgent: f.topic === 'paid', menu: false, options: [...acts.filter(a => !a.cta), ...acts.filter(a => a.cta)] }, [{ kind: 'followup', topic: f.topic }]);
}

function knowledgeReply(entry: Know.Entry, session: Session): Reply {
  const options: Chip[] = (entry.links ?? []).map(l => chip(l.label, { href: l.href, cta: !!l.cta }));
  if (entry.act === 'check') options.push(chip('🔎 Check a link, number or UPI ID', { action: { type: 'checkLink' } }));
  if (entry.flow && FLOWS[entry.flow]) options.push(chip('Walk me through it', { action: { type: 'goto', flow: entry.flow, node: FLOWS[entry.flow]?.start ?? '' } }));
  for (const id of (entry.rel ?? []).slice(0, 2)) { const r = Know.byId(id); if (r) options.push(chip(r.q, { action: { type: 'ask', text: r.q } })); }
  return say(entry.a, session, { urgent: entry.id === 'emergency', options }, [{ kind: 'faq', topic: entry.id.replace(/_/g, '-') }]);
}

// Nothing matched. Say so, say what this tool is, and offer questions it can answer; never a guess and never a bare menu.
function unanswered(text: string, session: Session): Reply {
  const cut = Utter.isIncomplete(text);
  const options = Know.suggest(text, 3).map(e => chip(e.q, { action: { type: 'ask', text: e.q } }));
  options.push(chip('Describe what happened', { action: { type: 'menu' } }));
  return say([cut
    ? 'That sounds cut off, so I did not try to answer it. Say or type the whole question, or pick one of these:'
    : "I don't have an answer for that. I am a rules-based assistant, so I only know how to check a message, link or QR code, the common scams, and where to report fraud in India. These are things I can answer:"],
  session, { options, menu: false }, [{ kind: 'unanswered' }]);
}

/** The opening of a conversation. */
export function greeting(session: Session = NEW_SESSION): Reply {
  const hello = say(["Hi — I'm the FraudShield Assistant. Type what happened, paste a link, or share a screenshot or QR code, and I'll guide you step by step."], session, { menu: false });
  const menu = showMainMenu(session);
  return { blocks: [...hello.blocks, ...menu.blocks], chips: menu.chips, session, events: [] };
}

/** The answer to something the person typed or said. */
export function reply(rawText: string, session: Session, ctx: Context): Reply {
  const text = rawText.trim();
  const linkMatch = A.findLinkIn(text);
  if (session.awaitingLink) {
    const cleared: Session = { ...session, awaitingLink: false };
    const asked = justALink(text, linkMatch) ? null : A.analyzeMessage(text);
    if (asked && asked.value.level !== 'nothing') return messageReply(asked.value, asked.ms, cleared, ctx);
    return linkReply(text, cleared, ctx);
  }
  if (linkMatch && justALink(text, linkMatch)) return linkReply(linkMatch, session, ctx);
  const pasted = DESCRIBING_SELF.test(text) ? null : A.analyzeMessage(text);
  if (pasted && pasted.value.level !== 'nothing') return messageReply(pasted.value, pasted.ms, session, ctx);
  if (linkMatch) return linkReply(linkMatch, session, ctx);

  // A question about the tool, a scam in general or the official routes. Half a sentence is not answered, and someone describing what happened to them still goes to the guided flow.
  const intent = A.detectIntent(text), moneyLoss = A.isGeneralMoneyLoss(text);
  const know = Utter.isIncomplete(text) ? null : Know.route(text);
  const knowAnswers = know !== null && (Know.isQuestion(text) || !(intent || moneyLoss));

  // A short question right after a verdict is about that verdict, unless the knowledge layer can answer it ("who made this?", "what is 1930?"): then it is about the tool or the topic.
  // "I already paid / clicked / shared" is about the person's own loss and always gets the steps.
  const follow = FollowUp.route(text, session.last, A.FAMILIES, ctx.now);
  if (follow && !(knowAnswers && follow.topic !== 'paid')) return followUpReply(follow, session);
  if (know && knowAnswers) return knowledgeReply(know.entry, session);

  if (intent && FLOWS[intent]) return gotoNode(intent, FLOWS[intent].start, session, ['That sounds like ' + intent + " — let's go through it step by step."]);
  if (moneyLoss) return generalLoss(session);

  const name = A.extractIntroducedName(text);
  if (name) {
    const next: Session = { ...session, userName: name };
    return say(['Nice to meet you, ' + name + "! I'll remember that for our chat."], next, { options: mainMenuChips(), menu: false });
  }
  const talk = A.matchSmallTalk(text);
  if (talk) return say(talk.reply(session.userName), session, talk.noMenu ? { menu: false } : { options: mainMenuChips(), menu: false });

  if (text.length >= 60) {
    const late = A.analyzeMessage(text);
    return late.value.level !== 'nothing' ? messageReply(late.value, late.ms, session, ctx) : nothingFound(late.value, late.ms, session, ctx);
  }
  return unanswered(text, session);
}

/** What a button does: the same kind of reply as typing, without the typing. */
export function act(action: Action, session: Session, ctx: Context): Reply {
  switch (action.type) {
    case 'goto': return gotoNode(action.flow, action.node, session);
    case 'menu': return showMainMenu({ ...session, awaitingLink: false });
    case 'loss': return generalLoss(session);
    case 'checkLink': return say(['Paste the link, phone number or UPI ID you want me to check, or attach a photo of the QR code.'], { ...session, awaitingLink: true }, { menu: false });
    case 'ask': return reply(action.text, session, ctx);
    case 'followup': {
      const f = FollowUp.route('what do I do now', session.last, A.FAMILIES, ctx.now);
      return f ? followUpReply(f, session) : showMainMenu(session);
    }
  }
}

/** A plain-text reading of a block: for screen readers, for speech, and for copying. */
export function describe(block: Block): string {
  switch (block.type) {
    case 'text': return block.text;
    case 'link-verdict': return block.verdict.headline + ' ' + block.verdict.reasons.join(' ') + ' ' + LINK_ADVICE;
    case 'message-verdict': {
      const v = block.verdict;
      return [v.headline, ...(v.evidence.length ? ['What gave it away:', ...v.evidence.slice(0, 4).map(e => '"' + e.quote + '": ' + e.label)] : []), v.next.join(' ')].join(' ');
    }
  }
}
