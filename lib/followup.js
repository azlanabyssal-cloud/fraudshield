/* Memory for the chat. After a verdict, people ask the next question: "how do I block this number?", "is it safe?", "what do I do now?".
   Without memory each of those goes to the scam detector as if it were a fresh message, finds nothing in it, and the bot says it "couldn't match that":
   the context it just built is thrown away, and "is it safe?" gets an answer that has nothing to do with the thing it was asked about.
   So the chat remembers its last verdict (kind, level, family, the evidence it quoted) and, when a short follow-up question arrives, answers it about THAT.
   Two safeguards keep this honest: a message that is itself scam wording is always analysed as a message (the caller checks that first), and "is it safe?"
   never gets a yes, only "no" for a flagged message and "I cannot call it safe" for the rest. Pure functions; the chat engine supplies the memory. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FraudShieldFollowUp = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const FRESH_MS = 60 * 60 * 1000;   // a verdict is the current topic for an hour; after that a new question is a new conversation
const MAX_WORDS = 14;              // a follow-up is a short question; a long text is something to analyse

// Order matters: the first topic that matches wins. Each pattern is written for English, Hinglish and (a few) Devanagari phrasings.
const TOPICS = [
  ['paid', /\b(?:already|have|had|just)\b.{0,25}\b(?:paid|sent|shared|clicked|opened|installed|gave|given|transferred|entered|typed|replied)\b|\b(?:maine|mene|hamne)\b.{0,30}\b(?:diya|bheja|bhej diya|click kiya|kar diya|daal diya|dala|bata diya|install kiya)\b|\bpaise (?:chale gaye|kat gaye|nikal gaye)\b|\bi (?:clicked|paid|sent|shared)\b/i],
  ['recover', /\b(?:get|getting)\b.{0,15}\b(?:money|paise|amount)\b.{0,10}\bback\b|\b(?:recover|refund|reverse|chargeback)\b|\b(?:paise|paisa|rupaye|money)\b.{0,15}\b(?:wapas|vapas|back)\b|\b(?:wapas|vapas) (?:milenge|milega|kaise)\b/i],
  ['report', /\b(?:report|complain|complaint|file (?:a |an )?(?:fir|complaint|report)|lodge|cybercrime|cyber crime|1930|police|fir)\b|\b(?:shikayat|report kaise|kaise report)\b/i],
  ['block', /\b(?:block|blocking|blocked)\b|\bband kar(?:na|o|ein)?\b.{0,15}\b(?:number|call|message|msg)\b/i],
  ['safe', /\b(?:is|was) (?:it|this|that|the (?:link|message|call|qr|number))\b.{0,12}\b(?:safe|real|genuine|fake|legit|true|correct|a scam|fraud|ok|okay)\b|\b(?:can|could|should|may|shall) i\b.{0,12}\b(?:trust|click|open|ignore|reply|call back|pay|scan|worry|believe)\b|\b(?:safe|asli|sach|nakli|fake|genuine|real)\b.{0,6}\bhai\b|\bkya (?:ye|yeh|ise|isse)\b.{0,15}\b(?:sach|asli|nakli|fraud|safe|sahi)\b|\bdo i need to worry\b/i],
  ['why', /\b(?:why|how do you know|how can you tell|what makes|explain|which part)\b|\b(?:kyun|kyon|kaise pata|kaise bata)\b/i],
  ['evidence', /\b(?:evidence|proof|screenshot|save|keep|delete|should i keep|backup)\b/i],
  ['who', /\bwho (?:sent|is|are|was|did|made)\b|\bkaun\b.{0,10}\b(?:hai|tha|bhej)\b/i],
  ['what', /\bwhat (?:should|do|can|shall|to|now|next|happens)\b|\bnow what\b|\bwhat now\b|\bnext step\b|\bwhat can i do\b|\b(?:kya karu|kya karun|kya karna|kya karein|ab kya|aage kya)\b|\bhelp me\b|^\s*help\s*[?!.]*\s*$/i]
];

const words = t => (String(t).trim().match(/\S+/g) || []).length;

// Which follow-up question is this, if any? Null for anything that is not a short question of a known kind.
function topicOf(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t || words(t) > MAX_WORDS) return null;
  for (const [topic, re] of TOPICS) if (re.test(t)) return topic;
  return null;
}

// Whether a remembered verdict is still the topic.
const isFresh = (last, now) => !!last && typeof last.at === 'number' && now - last.at >= 0 && now - last.at <= FRESH_MS;

// The memory to keep after a verdict. Quotes the evidence but never stores more than what was already on screen, and caps it.
function remember(verdict, now) {
  const ev = (verdict.evidence || []).slice(0, 3).map(e => ({ quote: String(e.quote || '').slice(0, 80), label: String(e.label || '').slice(0, 220) }));
  return { kind: verdict.kind || 'message', level: verdict.level, family: verdict.family || null, intent: verdict.intent || null, headline: String(verdict.headline || '').slice(0, 240), evidence: ev, at: now };
}

const FLAGGED = new Set(['scam', 'suspicious']);
const REPORT_LINES = ['Call 1930 (free, all day). Or file at cybercrime.gov.in.', 'Have ready: the number, link or UPI ID, the time, a screenshot, and if you paid, the amount and the transaction ID.'];

// The answer: { lines, options } where options are keys the chat turns into buttons ('call1930', 'report', 'menu', 'loss', 'steps').
// families is msgcheck's FAMILIES, so the advice for the kind of scam is the same advice the verdict gave.
function reply(topic, last, families) {
  const flagged = FLAGGED.has(last.level), fam = last.family && families ? families[last.family] : null, what = last.kind === 'upi' || last.kind === 'url' || last.kind === 'link' ? 'link or code' : 'message';
  switch (topic) {
    case 'block':
      return { lines: ['Blocking helps a little. It stops that one number, but scammers change numbers, so report it as well.',
        'On the phone: open the message or call, tap the number, and choose Block (and Report spam if it is offered). On WhatsApp: open the chat, tap the name, then Report and Block.', ...REPORT_LINES], options: ['call1930', 'report', 'menu'] };
    case 'report':
      return { lines: [...REPORT_LINES, 'If money has already left your account, call your bank first and ask them to block the transaction. Then report.'], options: ['call1930', 'report', 'menu'] };
    case 'paid':
      return { lines: ['I am sorry. Move fast: the first hour matters most.'], options: ['loss'] };
    case 'recover':
      return { lines: ['I cannot promise to get money back, but speed is what decides it. Call your bank now and ask them to stop or reverse the transaction, then call 1930 and file at cybercrime.gov.in. Do not pay anyone who offers to "recover" it for a fee: that is a second scam.'], options: ['call1930', 'report', 'loss'] };
    case 'safe':
      return flagged
        ? { lines: ['No. Treat it as unsafe. ' + last.headline, 'Do not click, reply, pay, or share any code. If you already did, tell me and I will walk you through it.'], options: ['loss', 'report', 'menu'] }
        : { lines: ['I cannot call it safe. ' + (last.level === 'nothing' ? 'I found no known scam pattern in it, but that is not proof it is genuine.' : 'I could not confirm it either way.'),
          'Do not click, pay or share a code because of it. Check with the sender through a number or app you already trust, not through the ' + what + '.'], options: ['report', 'menu'] };
    case 'why':
      return last.evidence.length
        ? { lines: ['This is what I went on:', ...last.evidence.map(e => (e.quote ? '• "' + e.quote + '": ' : '• ') + e.label)], options: ['steps', 'menu'] }
        : { lines: [last.headline || 'I did not find a specific pattern to point to.', 'A verdict from me is evidence, not proof. When in doubt, check through an official app or number you already trust.'], options: ['menu'] };
    case 'evidence':
      return { lines: ['Keep everything: the message, the number, the link, the payment screenshot and the transaction ID. Do not delete the chat, and do not reply.', 'Screenshots help the police and your bank more than anything you remember later.'], options: ['report', 'menu'] };
    case 'who':
      return { lines: ['I cannot tell who sent it. Names, numbers and even bank headers are easy to fake, and no tool can verify a sender from the text.', 'What I can do is judge what it asks you to do, and it asked for something a genuine sender would not.'], options: ['report', 'menu'] };
    case 'what':
    default:
      return { lines: [flagged ? last.headline : 'I could not confirm it either way.', ...(fam && flagged ? fam.next : ['Do not act on it until you have checked with the sender through a number or app you already trust.']),
        'Keep the screenshot. Do not delete the message.'], options: ['call1930', 'report', 'loss', 'menu'] };
  }
}

// The one call the chat makes. Returns { topic, ...reply } or null when this is not a follow-up to a fresh verdict.
function route(text, last, families, now) {
  if (!isFresh(last, now)) return null;
  const topic = topicOf(text);
  return topic ? { topic, ...reply(topic, last, families) } : null;
}

return { FRESH_MS, MAX_WORDS, TOPICS, topicOf, isFresh, remember, reply, route };
}));
