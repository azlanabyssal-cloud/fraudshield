/* FraudShield core — pure, DOM-free scoring and rule logic.
   Loaded as a plain <script> in the browser (window.FraudShieldCore) and
   with require() in Node, so the exact same code is unit-tested in CI. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./linkcheck.js'));
  else root.FraudShieldCore = factory(root.FraudShieldLink);
}(typeof self !== 'undefined' ? self : this, function (Link) {
'use strict';


// ---- Text normalization -------------------------------------------------
// Canonicalises the tricks scammers use to dodge keyword filters. Applied only
// to intent/loss matching. URL and PII logic always sees the raw text.
// Properties (tested): idempotent; leaves digits-heavy tokens (amounts, phone
// numbers, "1930") alone; never changes Devanagari text.
const ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff\u00ad]/g;
// Cyrillic/Greek letters that render like Latin ones.
const CONFUSABLES = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y',
  'і': 'i', 'ѕ': 's', 'ј': 'j', 'һ': 'h', 'А': 'A', 'В': 'B', 'Е': 'E',
  'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T',
  'Х': 'X', 'ο': 'o', 'α': 'a', 'ρ': 'p', 'Α': 'A', 'Β': 'B', 'Ε': 'E',
  'Ο': 'O', 'Ρ': 'P', 'Τ': 'T'
};
// Every lowercase confusable also has an uppercase form (e.g. U+0456 -> U+0406); derive them
// instead of hand-listing, which is how U+0406 was originally missed.
for (const [k, v] of Object.entries(CONFUSABLES)) {
  const up = k.toUpperCase();
  if (up !== k && !(up in CONFUSABLES)) CONFUSABLES[up] = v.toUpperCase();
}

// A swapped character ("@", "0", "$"...) is ambiguous: "p@nding" uses @ for "e", "p@ssword"
// uses it for "a". Guessing a letter is wrong some of the time, so it becomes a wildcard
// that matches any single character during keyword matching (see hasKeyword).
const WILDCARD = '￿';
const SWAP_CHARS = /[013457@$]/g;

function normalize(text) {
  let t = String(text).normalize('NFKC').replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/[Ͱ-ϿЀ-ӿ]/g, ch => CONFUSABLES[ch] || ch);
  // "U P I", "K.Y.C", "o-t-p": three or more single letters split by separators.
  t = t.replace(/(^|[^A-Za-z])((?:[A-Za-z][ .\-_]){2,}[A-Za-z])(?![A-Za-z])/g, (m, pre, seq) => pre + seq.replace(/[ .\-_]/g, ''));
  // Swaps inside a word: only tokens with at least two letters and at most two swapped
  // characters, so amounts, phone numbers and "1930" are left alone.
  t = t.replace(/\S+/g, tok => {
    const letters = (tok.match(/[A-Za-z]/g) || []).length;
    const swaps = (tok.match(SWAP_CHARS) || []).length;
    if (letters < 2 || swaps === 0 || swaps > 2) return tok;
    return tok.replace(SWAP_CHARS, WILDCARD);
  });
  return t;
}

// Whole-word keyword match. Plain substring search made "stupid" match "upi",
// "train" match "trai" and "hotpot" match "otp", routing ordinary messages
// into scam flows. Stems listed in PREFIX_STEMS ("invest" -> investing,
// investment, "blackmail" -> blackmailing/blackmailed, "nude" -> nudes) are allowed to match as
// word prefixes. Add a stem here whenever a keyword has common inflections.
const PREFIX_STEMS = new Set(['invest', 'blackmail', 'nude']);
function hasKeyword(lower, kw) {
  // Each letter or digit of the keyword also matches the WILDCARD that normalize() leaves
  // for swapped characters; spaces and punctuation must match literally.
  const body = [...kw].map(ch => {
    const esc = ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return /[a-z0-9]/i.test(ch) ? '(?:' + esc + '|' + WILDCARD + ')' : esc;
  }).join('');
  // The wildcard stands in for a letter, so it counts as part of a word when checking boundaries.
  const wordChar = 'a-z0-9' + WILDCARD;
  const end = PREFIX_STEMS.has(kw) ? '' : '(?![' + wordChar + '])';
  return new RegExp('(^|[^' + wordChar + '])' + body + end).test(lower);
}

const CHAT_INTENT_KEYWORDS = {
  'Digital Arrest': ['cbi', 'digital arrest', 'video call', 'arrest warrant', 'court notice', 'narcotics case',
    'judge', 'police custody', 'aadhaar linked', 'aadhaar is linked', 'parcel case', 'customs case', 'trai',
    'courier scam', 'fedex scam', 'money laundering case', 'drug case', 'passport case', 'income tax notice'],
  'OTP Scam': ['otp', 'one time password', 'verification code', 'shared my otp', 'gave my otp', 'told them the otp'],
  'UPI Fraud': ['upi', 'qr code', 'scan the qr', 'gpay', 'phonepe', 'google pay', 'paytm fraud', 'scan and pay',
    'unauthorized upi', 'unauthorised upi'],
  'Phishing': ['phishing', 'click the link', 'clicked a link', 'clicked on a link', 'fake website', 'kyc update',
    'fake sms', 'suspicious link', 'fake link', 'malicious link'],
  'Fake Loan App': ['loan app', 'instant loan', 'loan approved', 'loan agent', 'loan recovery agent',
    'harassing me for loan', 'blackmailing me for loan'],
  'Sextortion': ['nude', 'private photo', 'blackmail', 'morphed', 'morphing', 'sextortion', 'obscene video',
    'threatening to leak', 'threatening to post', 'video call recorded', 'threatening to share my photo'],
  'Investment Scam': ['invest', 'trading tip', 'guaranteed return', 'crypto scheme', 'stock tip', 'demat',
    'ponzi', 'forex scam', 'binary trading', 'stock market fraud', 'trading app fraud'],
  'Job Fraud': ['job offer', 'work from home job', 'part time job', 'registration fee', 'fake job', 'job scam',
    'data entry job'],
  'SIM Swap': ['sim swap', 'sim stopped', 'no service suddenly', 'sim card blocked', 'duplicate sim',
    'number deactivated', 'sim deactivated']
};

// General "I've already been defrauded" phrasing that doesn't name a specific
// scam type — this is how a lot of people actually describe it. Checked
// AFTER the specific-type matcher above (which is more actionable when it
// hits), but BEFORE giving up with the generic fallback.
const GENERAL_LOSS_KEYWORDS = [
  'money is gone', 'money gone', 'lost my money', 'lost money', 'stolen my money', 'money was stolen',
  'took my money', 'scammed me', 'i got scammed', 'i was scammed', 'i got cheated', 'i was cheated',
  'get my money back', 'get back my money', 'recover my money', 'defrauded', 'someone cheated me',
  'sent money to a scammer', 'unauthorized transaction', 'unauthorised transaction', 'account was hacked',
  'money got deducted', 'amount deducted', 'wiped my account', 'emptied my account', 'drained my account'
];
function isGeneralMoneyLoss(text) {
  const lower = normalize(text).toLowerCase();
  return GENERAL_LOSS_KEYWORDS.some(kw => hasKeyword(lower, kw));
}

// Link and QR checking lives in lib/linkcheck.js, which returns evidence-based levels. These wrappers keep the older
// three-way verdict the chat code uses: official -> safe, scam -> danger, everything else -> caution.
const LEGACY_VERDICT = { official: 'safe', scam: 'danger', suspicious: 'caution', unverified: 'caution' };

function checkLink(raw) {
  const r = Link.analyzePayload(raw);
  if (r.kind === 'text') {
    return { kind: 'text', level: 'unverified', verdict: 'caution', codes: ['unreadable'], headline: "That doesn't look like a link I can check.",
      reasons: ["If it's a phone number or UPI ID, search it online with the word \"scam\": many are already reported."] };
  }
  return Object.assign({}, r, { verdict: LEGACY_VERDICT[r.level] });
}

const LINK_ENDINGS = 'com|in|net|org|co|me|io|app|xyz|info|top|icu|club|work|site|online|live|shop|store|vip|click|link|rest|buzz|cc|pw|ru|cn|ly|gl|tk|ml|ga|cf|gq|sbi|apk';
const LINK_PATTERN = new RegExp('(upi://\\S+)|(https?://\\S+)|(\\bwww\\.\\S+)|(\\b[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:' + LINK_ENDINGS + ')\\b\\S*)', 'i');

function findLinkIn(text) {
  const m = String(text).match(LINK_PATTERN);
  return m ? m[0].replace(/[)\]}>.,;:!?'"]+$/, '') : null;   // a full stop or bracket after a link is punctuation, not part of it
}

function detectIntent(text) {
  const lower = normalize(text).toLowerCase();
  let best = null, bestScore = 0;
  Object.keys(CHAT_INTENT_KEYWORDS).forEach(key => {
    let score = 0;
    CHAT_INTENT_KEYWORDS[key].forEach(kw => { if (hasKeyword(lower, kw)) score++; });
    if (score > bestScore) { bestScore = score; best = key; }
  });
  return bestScore > 0 ? best : null;
}

// ── Small talk — a hand-authored conversational layer, NOT a general AI.
//    This is a rule-based pattern matcher for common greetings/chit-chat so
//    the bot doesn't dead-end on "hello" or "how are you". It cannot answer
//    arbitrary open-ended questions the way a real LLM could — that would
//    need an API key and a small ongoing cost, which this project runs
//    without by design. ──
const NAME_PATTERN = /\b(?:i'?m|i am|my name is|myself)\s+([a-z][a-z'-]{1,19})\b/i;
const NAME_STOPWORDS = new Set(['not', 'worried', 'scared', 'afraid', 'confused', 'trying', 'asking',
  'wondering', 'calling', 'writing', 'here', 'sure', 'sorry', 'fine', 'good', 'ok', 'okay', 'well',
  'still', 'also', 'just', 'really', 'very', 'so', 'done', 'back', 'new', 'a', 'an', 'the', 'having']);

function extractIntroducedName(text) {
  const m = text.match(NAME_PATTERN);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  if (NAME_STOPWORDS.has(raw)) return null;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

const SMALL_TALK = [
  {
    test: /^\s*(hi+|hello+|hey+|yo|namaste|helo)\b/i,
    reply: name => ['Hello' + (name ? ', ' + name : '') + '! Good to hear from you. I\'m here to help with anything fraud-related — or ask me anything else too.']
  },
  {
    test: /\bhow are you\b/i,
    reply: () => ["I'm doing well, thanks for asking! More importantly — how are you doing? Anything fraud-related I can help with today?"]
  },
  {
    test: /\b(good|safe|digital|online)\s+habits?\b|\bhow (can|do) i (stay|keep myself) safe\b|\bhow to stay safe\b/i,
    reply: () => [
      'Good question — a few habits genuinely keep you safer than any single warning: never share your OTP or UPI PIN with anyone, verify unexpected urgent calls by hanging up and calling back on an official number, never click links in SMS or WhatsApp from unknown senders, and remember no real official ever asks for money to "verify" or "clear" your name.',
      'Want the full guide, or is something specific worrying you right now?'
    ]
  },
  {
    test: /\b(thank you|thanks|thx|thankyou)\b/i,
    reply: () => ["You're welcome! I'm here anytime you need help."]
  },
  {
    test: /\bwhat can you (do|help)|\bwho are you\b|\bwhat are you\b/i,
    reply: () => ["I'm the FraudShield Assistant — I guide you step by step through common scams (digital arrest, OTP, UPI, phishing, and more), check suspicious links, read screenshots of scam messages, and connect you straight to the 1930 helpline. Type, speak, or paste a screenshot anytime."]
  },
  {
    test: /\b(bye|goodbye|good ?night|see you)\b/i,
    reply: () => ['Take care! Remember — 1930 is always free, day or night, if you ever need it.'],
    noMenu: true
  }
];

function matchSmallTalk(text) {
  for (const rule of SMALL_TALK) {
    if (rule.test.test(text)) return rule;
  }
  return null;
}

return {
  CHAT_INTENT_KEYWORDS, GENERAL_LOSS_KEYWORDS, isGeneralMoneyLoss,
  checkLink, findLinkIn, detectIntent, hasKeyword, normalize,
  extractIntroducedName, matchSmallTalk, SMALL_TALK
};
}));
