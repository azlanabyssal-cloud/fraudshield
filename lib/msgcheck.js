/* FraudShield message check. Reads a pasted SMS, WhatsApp message or a description of a call and answers three things:
   what scam it resembles, which exact words gave it away, and what to do next.

   It is a rule list, not a model, and it says so. Every rule names the phrase it matched, so a verdict can be argued with.
   It never says a message is genuine: the best it can report is that it found no known pattern. A message can be dangerous
   and match nothing here, and a person asking is usually asking because something felt wrong.

   The rules come from the scam patterns documented on the site and in public advisories. They were written before any
   benchmark was run against them and are not tuned on one (ADR-0013). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), require('./linkcheck.js'));
  else root.FraudShieldMessage = factory(root.FraudShieldCore, root.FraudShieldLink);
}(typeof self !== 'undefined' ? self : this, function (Core, Link) {
'use strict';

const WILDCARD = '￿';           // what Core.normalize leaves for a swapped character such as the @ in p@ssword
const LEVELS = ['scam', 'suspicious', 'nothing'];
const MAX_CHARS = 4000;

/* ---------- reading the text ---------- */
function prepare(raw) {
  const clipped = String(raw == null ? '' : raw).slice(0, MAX_CHARS);
  const text = Core.normalize(clipped).toLowerCase().replace(/(\d),(?=\d)/g, '$1');   // "5,000" is one number, not two words
  const tokens = [], re = /[a-z0-9￿₹]+(?:'[a-z]+)?|[ऀ-ॿ]+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) tokens.push({ t: m[0], s: m.index, e: m.index + m[0].length });
  return { raw: clipped, text, tokens };
}

// A token matches a word when it is the same length and differs only where the normaliser left a wildcard.
function same(tok, word) {
  if (tok.length !== word.length) return false;
  for (let i = 0; i < word.length; i++) if (tok[i] !== word[i] && tok[i] !== WILDCARD) return false;
  return true;
}
function phraseAt(ctx, i, words) {
  for (let k = 0; k < words.length; k++) if (i + k >= ctx.tokens.length || !same(ctx.tokens[i + k].t, words[k])) return false;
  return true;
}
// Every place a phrase occurs, as the text that matched.
function findPhrase(ctx, phrase) {
  const words = phrase.split(' '), hits = [];
  for (let i = 0; i + words.length <= ctx.tokens.length; i++) {
    if (phraseAt(ctx, i, words)) hits.push(ctx.text.slice(ctx.tokens[i].s, ctx.tokens[i + words.length - 1].e));
  }
  return hits;
}
const findAny = (ctx, phrases) => phrases.flatMap(p => findPhrase(ctx, p));
const findRegex = (ctx, re) => { const m = re.exec(ctx.text); return m ? [m[0].trim()] : []; };
const isAny = (tok, words) => words.some(w => same(tok, w));

/* ---------- the rules ---------- */
const NEGATORS = ['not', 'never', 'dont', "don't", 'cant', "can't", 'cannot', 'without', 'nahi', 'mat', 'avoid'];
// "enter" and "confirm" are left out on purpose: genuine OTP texts say "enter this code on the website". A request to hand it to someone is share, send, tell, give.
const ASK_VERBS = ['share', 'send', 'give', 'tell', 'provide', 'forward', 'read', 'reply', 'dedo', 'batao', 'bhejo', 'bataiye', 'bataye', 'dijiye'];
// Two tiers. A PIN, CVV, password or card number is never a thing to hand over, so asking for one is conclusive on its own.
// An OTP or an Aadhaar number has rare honest uses (the delivery person at your door, a form you filled in), so it needs one more sign.
const CREDENTIALS = { words: ['pin', 'mpin', 'cvv', 'cvc', 'password', 'passcode', 'पिन', 'पासवर्ड'], pairs: [['card', 'number'], ['card', 'details'], ['bank', 'details'], ['account', 'number'], ['security', 'code'], ['upi', 'pin'], ['net', 'banking']] };
const CODES = { words: ['otp', 'aadhaar', 'aadhar', 'ओटीपी'], pairs: [['verification', 'code']] };

// "Share your OTP" asks for it. "Do not share your OTP" is the bank doing its job, and must never be flagged.
function askFor(ctx, secrets) {
  const tk = ctx.tokens, hits = [];
  // Genuine delivery apps do tell you to give the OTP to the person at your door. That is the one honest case, and it only
  // excuses an ask in the same sentence: a scammer must not be able to buy an exemption by adding "delivery agent" elsewhere.
  const DOOR = ['partner', 'agent', 'executive', 'person', 'boy', 'associate'];
  const doorAt = [];
  for (let i = 0; i + 1 < tk.length; i++) if (same(tk[i].t, 'delivery') && isAny(tk[i + 1].t, DOOR)) doorAt.push(i);
  const sameSentence = (a, b) => !/[.!?\n]/.test(ctx.text.slice(tk[Math.min(a, b)].e, tk[Math.max(a, b)].s));
  const excusedByDoor = i => doorAt.some(d => sameSentence(i, d));
  const secretAt = i => isAny(tk[i].t, secrets.words) || secrets.pairs.some(p => phraseAt(ctx, i, p));
  const negatedBefore = i => { for (let k = Math.max(0, i - 5); k < i; k++) if (isAny(tk[k].t, NEGATORS)) return true; return false; };
  for (let i = 0; i < tk.length; i++) {
    if (!isAny(tk[i].t, ASK_VERBS) || negatedBefore(i)) continue;
    if (excusedByDoor(i) && tk.slice(Math.max(0, i - 3), i + 7).some(x => same(x.t, 'otp'))) continue;
    let end = -1;
    for (let j = i + 1; j <= Math.min(tk.length - 1, i + 6); j++) if (secretAt(j)) { end = j; break; }
    if (end < 0) for (let j = Math.max(0, i - 3); j < i; j++) if (secretAt(j)) { end = i; break; }   // Hinglish order: "OTP bhejo"
    if (end >= 0) hits.push(ctx.text.slice(tk[Math.min(i, end)].s, tk[Math.max(i, end)].e));
  }
  return hits.slice(0, 1);
}

const AMOUNT = '(?:rs\\.?|₹|inr)?\\s?\\d{1,9}(?:\\.\\d+)?(?:\\s?/-)?';
const RULES = [
  { id: 'ask-credential', w: 5, family: 'otp', label: 'It asks you to hand over a PIN, CVV, password or card number. No genuine bank, officer or company ever asks for these.', find: ctx => askFor(ctx, CREDENTIALS) },
  { id: 'ask-secret', w: 3, family: 'otp', label: 'It asks you to hand over an OTP or an ID number. A bank or officer who needs your OTP is a thief: the code exists to prove it is you.', find: ctx => askFor(ctx, CODES) },
  { id: 'pay-to-receive', w: 3, family: 'fee', label: 'It asks you to pay first in order to receive, release or unlock something. A real refund, parcel or prize never costs you money first.',
    find: ctx => [...findAny(ctx, ['processing fee', 'registration fee', 'customs fee', 'customs charges', 'clearance fee', 'release fee', 'advance fee', 'refundable deposit', 'pay to claim', 'pay to release', 'pay to receive', 'deposit first', 'to unlock', 'unlock higher']),
      ...findRegex(ctx, new RegExp('\\b(?:pay|deposit|send|transfer)\\s+' + AMOUNT + '\\s+(?:to|and|for)\\s+(?:release|claim|unlock|receive|get|avoid|activate|clear|verify|stop)\\b'))] },
  { id: 'upi-receive', w: 3, family: 'upi', label: 'It tells you to approve a request or enter your UPI PIN in order to RECEIVE money. A UPI PIN is only ever for paying.',
    find: ctx => findAny(ctx, ['approve the request to receive', 'enter upi pin to receive', 'enter pin to receive', 'accept the request to receive', 'approve the collect request', 'to receive it approve', 'approve the request in your upi app']) },
  { id: 'stay-on-call', w: 3, family: 'arrest', label: 'It tells you to stay on a call or video call. Real police and courts do not hold you on a video call, and there is no "digital arrest".',
    find: ctx => findAny(ctx, ['stay on the call', 'stay on this call', 'stay on the line', 'stay on this video call', 'stay on video call', 'do not disconnect', 'dont disconnect', 'do not hang up', 'dont hang up', 'keep your camera on']) },
  { id: 'secrecy', w: 3, family: 'arrest', label: 'It tells you to keep this secret from family and friends. Scammers isolate people so nobody can say "stop".',
    find: ctx => findAny(ctx, ['do not tell anyone', 'dont tell anyone', 'do not inform anyone', 'dont inform anyone', 'do not tell your family', 'dont tell your family', 'keep this confidential', 'keep it confidential', 'do not share this with anyone', 'strictly confidential']) },
  { id: 'install-app', w: 3, family: 'app', label: 'It pushes you to install an app or give someone remote access to your phone. That is how accounts are emptied while you watch.',
    find: ctx => [...findAny(ctx, ['install this app', 'download this app', 'install the app', 'anydesk', 'teamviewer', 'quicksupport', 'rustdesk', 'screen sharing app']), ...findRegex(ctx, /[a-z0-9_-]+\.apk\b/)] },
  { id: 'task-job', w: 3, family: 'job', label: 'It offers money for easy tasks, likes or a part-time job. Pay-per-task offers on WhatsApp and Telegram are a known fraud that starts small and then asks for deposits.',
    find: ctx => findAny(ctx, ['per task', 'earn daily', 'earn per day', 'work from home', 'part time job', 'part-time job', 'like and earn', 'task and earn', 'online task', 'data entry job', 'youtube like', 'telegram task']) },
  { id: 'investment', w: 3, family: 'invest', label: 'It promises guaranteed or very high returns. No genuine investment guarantees profit, and these groups end when you try to withdraw.',
    find: ctx => [...findAny(ctx, ['guaranteed return', 'guaranteed returns', 'guaranteed profit', 'double your money', 'daily profit', 'vip group', 'risk free', '100 profit', 'sure shot', 'insider tip']), ...findRegex(ctx, /\b\d{2,3}\s?%\s*(?:monthly|weekly|daily|returns?|profit)\b/)] },
  { id: 'prize', w: 3, family: 'prize', label: 'It says you have won something you never entered for. Lottery and lucky-draw messages are the oldest scam there is.',
    find: ctx => findAny(ctx, ['you have won', 'you won', 'you are the winner', 'lucky draw', 'lottery', 'kbc', 'lucky winner', 'won a prize', 'reward points will expire', 'इनाम', 'लॉटरी']) },
  { id: 'authority', w: 2, family: 'arrest', label: 'It claims to come from the police, CBI, customs, TRAI, a court or a tax office. Genuine agencies do not demand money or secrecy over a call or message.',
    find: ctx => findAny(ctx, ['cbi', 'cyber crime branch', 'cyber cell', 'narcotics', 'arrest warrant', 'customs department', 'customs officer', 'trai', 'enforcement directorate', 'ncb', 'supreme court', 'fir', 'court notice', 'income tax department', 'digital arrest', 'video call arrest', 'house arrest', 'गिरफ्तार']) },
  { id: 'kyc', w: 2, family: 'kyc', label: 'It says a KYC or account detail must be updated now. Banks do not ask you to fix KYC through an SMS link or a phone call.',
    find: ctx => {
      const k = findAny(ctx, ['kyc', 'ekyc', 're-kyc', 'केवाईसी']); if (!k.length) return [];
      const act = findAny(ctx, ['expire', 'expires', 'expired', 'expiring', 'pending', 'update', 'updating', 'verify', 'suspended', 'blocked', 'incomplete', 'mandatory', 'अपडेट']);
      return act.length ? [k[0] + ' … ' + act[0]] : [];
    } },
  { id: 'parcel', w: 2, family: 'parcel', label: 'It says a parcel is held, a delivery failed or a fee is due on a package. Fake courier and customs messages are a common way in to larger frauds.',
    find: ctx => findAny(ctx, ['parcel is held', 'parcel held', 'held at customs', 'delivery failed', 'address incomplete', 'package is held', 'courier is held', 'reschedule delivery', 'parcel in your name']) },
  { id: 'refund-claim', w: 2, family: 'refund', label: 'It says a refund or cashback is waiting for you to claim. A genuine refund reaches your account without you clicking, paying or sharing anything.',
    find: ctx => findAny(ctx, ['claim your refund', 'claim refund', 'claim your cashback', 'refund is ready', 'refund is pending', 'refund pending', 'refund has been approved', 'refund approved', 'tax refund', 'your refund is waiting']) },
  { id: 'card-points', w: 2, family: 'card', label: 'It talks about card points expiring, a card being blocked or a limit being raised. These are a standard way to get card numbers and OTPs.',
    find: ctx => findAny(ctx, ['card will be blocked', 'credit card will be blocked', 'card is blocked', 'reward points expire', 'reward points will expire', 'redeem your points', 'limit increase', 'card limit']) },
  { id: 'click-link', w: 2, family: 'contact', label: 'It tells you to tap or click a link to fix, pay or claim something. Real banks and agencies do not send you a link to act on.',
    find: ctx => findAny(ctx, ['click the link', 'click this link', 'click here', 'tap the link', 'tap here', 'on this link', 'via this link', 'using this link', 'open the link', 'link below', 'below link']) },
  { id: 'threat', w: 1, family: 'threat', label: 'It threatens to block, close or disconnect something, or to take legal action.',
    find: ctx => findAny(ctx, ['will be blocked', 'will be suspended', 'will be closed', 'will be disconnected', 'will be deactivated', 'will be deleted', 'account blocked', 'account suspended', 'legal action', 'will be arrested', 'penalty will', 'खाता बंद']) },
  { id: 'urgency', w: 1, family: 'urgency', label: 'It rushes you with a deadline. Pressure to act in minutes is the scammer\'s main tool.',
    find: ctx => [...findAny(ctx, ['expires today', 'expiring today', 'expire today', 'within 24 hours', 'within 2 hours', 'within 1 hour', 'immediately', 'urgent', 'urgently', 'last warning', 'final notice', 'last chance', 'act now', 'today only', 'tonight', 'limited seats', 'limited time', 'hurry', 'अभी अपडेट', 'आज समाप्त']),
      ...findRegex(ctx, /\b(?:today|tonight|tomorrow)\s+(?:by|at)\s+\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/)] },
  { id: 'phone-number', w: 1, family: 'contact', label: 'It puts a mobile number in the message for you to call or message. Banks and agencies do not ask you to ring a personal-looking number.',
    find: ctx => findRegex(ctx, /(?:\+?91[\s-]?)?\b[6-9]\d{9}\b/) },
  { id: 'callback', w: 1, family: 'contact', label: 'It tells you to call a number or message someone it names. A fake "customer care" line is how a link-free scam reaches you.',
    find: ctx => findAny(ctx, ['call this number', 'call us on', 'call back', 'contact customer care', 'whatsapp us', 'message us on', 'dial']) }
];

// The scam each rule most closely belongs to, in the order they should be named when several apply.
const FAMILIES = {
  otp: { name: 'an OTP or PIN theft', intent: 'OTP Scam', next: ['Do not read out or type any OTP, PIN or password that someone asked for, whatever they say they are.', 'If you already shared one, call your bank on the number printed on your card and ask them to block the account, then call 1930.'] },
  fee: { name: 'a pay-to-receive scam', intent: 'Phishing', next: ['Do not pay. A genuine refund, parcel or prize does not ask you for money first.', 'If you already paid, tell your bank straight away and call 1930; the first hour matters most.'] },
  upi: { name: 'a UPI "receive money" trick', intent: 'UPI Fraud', next: ['Do not approve the request and do not enter your UPI PIN. Approving a request pays money out; it never brings money in.'] },
  arrest: { name: 'a fake-officer or "digital arrest" call', intent: 'Digital Arrest', next: ['Hang up. No agency arrests or interrogates anyone over a video call, and none asks for money to "clear" a case.', 'Tell someone you trust right now, even if you were told to keep it secret. If money has moved, call 1930.'] },
  app: { name: 'a fake app or remote-access scam', intent: 'Phishing', next: ['Do not install it. If you already did, uninstall it, turn on airplane mode, and call your bank and 1930.'] },
  job: { name: 'a task or job scam', intent: 'Job Fraud', next: ['Do not deposit anything to "unlock" earnings. A genuine employer never charges you to work.', 'Stop replying, keep the chat as evidence, and report the number on cybercrime.gov.in.'] },
  invest: { name: 'an investment scam', intent: 'Investment Scam', next: ['Do not transfer money to a group, app or person who guarantees returns.', 'Check whether the firm is registered on SEBI\'s website before you invest anything.'] },
  prize: { name: 'a lottery or prize scam', intent: 'Phishing', next: ['Do not reply, click or pay. You cannot win a draw you never entered.'] },
  kyc: { name: 'a fake KYC or account-block message', intent: 'Phishing', next: ['Do not use the link or phone number in the message. Open your bank\'s app (the one you installed yourself) or visit the branch to check your KYC.'] },
  parcel: { name: 'a fake parcel or customs message', intent: 'Digital Arrest', next: ['Do not pay or click. Check the parcel only on the courier\'s official app or site, typed in by you.'] },
  refund: { name: 'a fake refund message', intent: 'Phishing', next: ['Do not click or share anything to "claim" it. A real refund is credited to your account on its own.'] },
  card: { name: 'a card-block or reward-points scam', intent: 'Phishing', next: ['Do not follow the message. Check card status in your bank\'s app, or call the number printed on the card.'] },
  threat: { name: 'a threatening message', intent: 'Phishing', next: ['Check the claim yourself through the official app or a number you already trust, never through the message.'] },
  urgency: { name: 'a pressure message', intent: 'Phishing', next: ['A rush is a reason to slow down. Check with the sender through a number you already trust.'] },
  contact: { name: 'a message that wants you to call back', intent: 'Phishing', next: ['Do not call the number in the message. Look up the official number yourself.'] }
};
const PRIORITY = ['arrest', 'otp', 'upi', 'fee', 'app', 'job', 'invest', 'prize', 'refund', 'kyc', 'parcel', 'card', 'threat', 'urgency', 'contact'];
const SCAM_AT = 5, SUSPICIOUS_AT = 3;

const SAFETY_NOTE = 'That does not make it genuine. If it asks for money, an OTP or PIN, or for you to install something, treat it as a scam until you have checked with the sender through a number you already trust.';

function analyzeMessage(raw) {
  const ctx = prepare(raw);
  if (!ctx.tokens.length) return { kind: 'message', level: 'nothing', score: 0, family: null, headline: 'There is no message here for me to read.', evidence: [], link: null, next: [], intent: null, codes: [] };

  const evidence = [];
  let score = 0;
  for (const rule of RULES) {
    const hits = [...new Set(rule.find(ctx))];
    if (!hits.length) continue;
    // Several separate claims of the same kind ("guaranteed returns", "double your money", "risk free") are stronger than one.
    // Weak rules do not stack: a message with three deadline words is usually just a busy message.
    const weight = rule.w + (rule.w >= 2 ? Math.min(2, hits.length - 1) : 0);
    evidence.push({ id: rule.id, family: rule.family, weight, label: rule.label, quote: hits[0].slice(0, 80), count: hits.length });
    score += weight;
  }

  // Links inside the message are judged by the link analyzer, and its verdict outweighs any wording.
  const linkText = Core.findLinkIn(ctx.raw);
  let link = null;
  if (linkText) {
    link = Link.analyzePayload(linkText);
    const add = link.level === 'scam' ? 5 : link.level === 'suspicious' ? 3 : link.level === 'unverified' ? 1 : 0;
    if (add) { evidence.push({ id: 'link-' + link.level, family: link.level === 'scam' ? 'link' : 'contact', weight: add, label: link.headline, quote: linkText.slice(0, 80) }); score += add; }
  }

  const level = score >= SCAM_AT ? 'scam' : score >= SUSPICIOUS_AT ? 'suspicious' : 'nothing';
  const families = [...new Set(evidence.map(e => e.family))].filter(f => FAMILIES[f]).sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b));
  const primary = families[0] || (link && link.level === 'scam' ? 'kyc' : null);
  const info = primary ? FAMILIES[primary] : null;
  const named = info ? info.name : 'a scam';

  const headline = level === 'scam' ? `This looks like ${named}.`
    : level === 'suspicious' ? `This has warning signs of ${named}.`
    : 'I found no known scam pattern in this message.';
  const mentionsLink = !!info && info.next.some(l => /\blink\b/i.test(l));   // some families already say it
  const next = level === 'nothing' ? [SAFETY_NOTE] : [...(info ? info.next : []), ...(link && link.level !== 'official' && !mentionsLink ? ['Do not open the link in the message.'] : [])];
  return { kind: 'message', level, score, family: primary, headline, evidence, link, next, intent: level === 'nothing' ? null : (info && info.intent), codes: evidence.map(e => e.id) };
}

return { analyzeMessage, RULES, FAMILIES, LEVELS, SCAM_AT, SUSPICIOUS_AT, prepare };
}));
