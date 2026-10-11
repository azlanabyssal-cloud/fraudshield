/* Scam wording in the way India actually writes it: Hindi and Telugu typed in Latin letters ("Hinglish", "Tenglish"), and Hindi in Devanagari.
   An English-only phrase list sees nothing in "Bhai tumhara account block ho gaya hai, KYC update karo is link pe", although every word of it is a
   known scam pattern. Two ideas keep this honest and maintainable:
     1. Spelling. Romanised Hindi has no fixed spelling (wapas/vapas, bhejo/bhejiye, kaaro/karo). canon() reduces a word to a spelling-insensitive
        form (doubled letters, aa/a, ph/f, w/v, bh/b and the like) and BOTH the message and the lexicon go through it, so one entry covers the spellings
        people actually type. Genuinely different words (karo, kro, kare, kijiye) are written as alternatives in the entry: "update (karo|kro|kare)".
     2. Phrases, not words. Every entry is a phrase, and the lexicon is grouped by the rule it feeds (threat, urgency, secrecy ...), so a Hinglish hit
        is quoted as evidence exactly like an English one and the same weights apply. A single everyday word ("abhi", "jaldi") is a weak signal on its own, as in English.
   This is a lexicon written from public scam advisories and common SMS wording, tested on hand-made scam and genuine Hinglish messages (including the genuine
   warnings banks send in Hinglish, which must not be flagged). It has not been measured on real Indian messages; the S0 set is the real test. */

// Spelling-insensitive form of one word. Applied to message tokens and to lexicon words alike, so equality means "spelled differently, same word".
function canon(word: unknown): string {
  let w = String(word).toLowerCase();
  if (/[\u0080-\uffff]/.test(w)) return w.replace(/[\u0964\u0965]/g, '');   // Devanagari and other scripts are compared as written (a danda is punctuation)
  for (let pass = 0; pass < 6; pass++) {   // to a fixed point, so canon(canon(x)) === canon(x) by construction
    const before = w;
    w = w.replace(/ph/g, 'f').replace(/w/g, 'v').replace(/z/g, 'j').replace(/q/g, 'k');
    w = w.replace(/([bdgjkpt])h/g, '$1');                  // bhejo/bejo, dhan/dan, khata/kata, ghar/gar, thik/tik
    w = w.replace(/y(?=[aeiou])/g, 'i');                   // jayega/jaiega, kijiye/kijiie
    w = w.replace(/ai|au|ei|ae/g, m => (m === 'au' ? 'o' : 'e'));   // hai/he, aur/or, nahin/nahen, jaega/jega
    w = w.replace(/(.)\1+/g, '$1');                       // kaaro, karoo, jaldiii: after the rewrites, so that they cannot create new doubles
    if (w === before) break;
  }
  return w;
}

// "kyc update (karo|kro|kare)" -> every phrase it stands for, each an array of canonical words. Alternatives may be several words: "(ho jayega|ho gaya)".
// A group followed by ? is optional. Numbers are written \d+ and stand for any number.
function expandRaw(pattern: string, cap?: number): string[][] {
  const limit = cap || 2000, parts: string[][] = [];
  const re = /\(([^)]*)\)(\?)?|([^\s(]+)/g;
  for (let m = re.exec(pattern); m; m = re.exec(pattern)) {
    if (m[1] !== undefined) { const alts = m[1].split('|').map(x => x.trim()); if (m[2]) alts.push(''); parts.push(alts); } else parts.push([m[3] ?? '']);
  }
  let out: string[][] = [[]];
  for (const alts of parts) {
    const next: string[][] = [];
    for (const base of out) for (const a of alts) next.push(base.concat(a.split(/\s+/).filter(Boolean)));
    out = next;
    if (out.length > limit) throw new Error('hinglish: pattern expands to more than ' + limit + ' phrases: ' + pattern);
  }
  return out.filter(ws => ws.length);
}
const expand = (pattern: string, cap?: number): string[][] => expandRaw(pattern, cap).map(ws => ws.map(w => (w === '\\d+' ? w : canon(w))));

// id -> patterns. Words are written the common way; canon() absorbs the other spellings.
const LEX = {
  threat: ['account (band|block|freeze|suspend|bandh) (ho jayega|ho jaega|ho jayenge|ho jaye|ho gaya|ho gaya hai|hone vala hai|kar diya jayega|kiya jayega)', 'khata (band|block) (ho|kar|kiya)', '(block|band|suspend) ho (jayega|jaega|gaya|jayenge|jaenge|jaye|jayegi|gayi)',
    'connection (kat|cut|band) (jayega|jaega|diya jayega|jayegi|jaegi|diya jaega)', 'sim (band|block) ho (jayegi|jaegi|jayega|gayi|gaya)', 'card (band|block) ho (jayega|gaya|jayegi)', 'legal action (liya jayega|hoga|lenge|ki jayegi)',
    'giraftar (kiya jayega|kar liya jayega|ho jayenge|ho jaoge)', '(varna|nahi to|nahin to) (block|band|suspend|arrest|giraftar|fir|action)', 'penalty (lagega|lagegi|lagayi jayegi)',
    'account (block|band) (avutundi|avuthundi|avutadi|avutundhi)', 'block (avutundi|avuthundi|avutadi)', 'suspend (avutundi|avuthundi|avutadi)', 'connection (cut|disconnect) (avutundi|avuthundi|avutadi)'],
  urgency: ['(turant|turat|fauran|foran|jaldi|jaldi se|isi vakt|is vakt|isi samay|abhi ke abhi|abhi turant|aaj hi|aaj raat|aaj shaam)', '(\\d+|ek|do|teen) (ghante|ghanta|minute|min) (me|mein|ke andar|ke ander)', '24 (ghante|ghanto) (me|mein|ke andar)', '(ventane|ippude|ee roje|ee rojey)', '\\d+ (gantallo|gantalo)'],
  secrecy: ['kisi (ko|se) (mat|na|nahi|nahin) (batana|batao|bataiye|batayiye|bolna|kehna|kahna|bataye|batayen)', 'kisiko (mat|na|nahi) (batana|batao|bolna|kehna)', 'kisi ko bhi (mat|na|nahi) (batana|batao|batayen|bolna)',
    '(ghar valon|ghar valo|family|parivar|doston|dosto) (ko|se) (mat|na|nahi) (batana|batao|bolna|batayen)', 'chup (rehna|rahna|raho|rahiye|rahein)', 'raaz (rakhna|rakhiye|rakho)', '(evariki|evaritho) (cheppakandi|cheppavaddu|cheppoddu|cheppakudadu)'],
  stayOnCall: ['(call|phone) (mat|na) (kaato|kato|katna|kaatna|rakhna|rakhiye|rakho|disconnect karna|cut karna|cut karo)', 'call (disconnect|cut|band) (mat|na) (karna|karo|karein|kijiye)', 'video call (par|pe|per) (rahiye|rahna|bane rahiye|raho|rahein|rehna)',
    'line (par|pe|per) (rahiye|rahna|bane rahiye|raho|rehna)', 'camera (on|chalu) (rakhiye|rakhna|rakho|rakhein)', 'call (lo|lena) (aur|or) (mat|na) (kaato|rakho)'],
  clickLink: ['link (pe|par|per|ko) (click|tap|touch) (karo|kro|kare|karein|karen|kijiye|kijiyega|karna)', '(is|iss|neeche diye gaye|niche diye gaye|neeche diya gaya|niche diya gaya|upar diye gaye) link (pe|par|per) (click|tap|jaiye|jao|jaye|jakar|jaakar|ja kar)',
    'link (kholo|kholiye|open karo|open kijiye|par jao|pe jao)', 'click (karo|kro|kare|karein|kijiye) (abhi|turant)?', '(ee|ee link) link (ni|nu|ki)? (click|tap|open) (cheyyandi|cheyandi|cheyyali|cheyali)', 'link (click|tap|open) (cheyyandi|cheyandi|cheyyali|cheyali)'],
  kycAct: ['(update|verify|complete|pending|expire|expired|mandatory|incomplete|band|block)', '(karo|kro|kare|karein|karen|kijiye|kijiyega|karna|zaroori|jaruri|baki|baaki)', '(cheyyandi|cheyandi|cheyyali|cheyali|cheyyaali)'],
  prize: ['(aap|aapne|aapko|tum|tumne|tumhe) (jeet|jeeta|jita|jit) (gaye|gaya|liya|hai|gayi|chuke)', 'lottery (lagi|nikli|jeeti|jeet)', 'inaam (jeeta|mila|nikla|jeet)', 'kbc (lottery|inaam|vinner|winner)', 'lucky draw (me|mein|se)', 'cashback (mila|mil gaya|aaya|aa gaya)',
    'reward points (expire|khatam) ho', 'lottery (gelichaaru|gelichaaru|vachindi|tagilindi|gelchukunnaru)', 'prize (vachindi|gelichaaru|gelichaaru)'],
  taskJob: ['ghar baithe (\\d+)? (daily|roz|rozana)? (\\d+)? (kamao|kamaye|kamaiye|kamai|paise|paisa|income|earning)', '(daily|roz|rozana) \\d+ (kamao|kamaye|kamaiye|kamai)', '\\d+ (rupaye|rs) (daily|roz|rozana) (kamao|kamaye|kamai)', '(daily|roz|rozana) (kamao|kamaye|kamaiye|earn|paise)', 'paise kamao', 'part time (job|kaam)', 'work from home', 'video like karo (aur|or) (kamao|paise)', 'ghar se (kaam|kamai)',
    '(task|kaam) (complete|pura|poora) karo (aur|or) (paise|kamao|earn)', '(intlo|intilo) (undi|nunchi) (sampadinchandi|earn cheyyandi|sampadhinchandi)', 'daily (earn cheyyandi|sampadinchandi|sampadhinchandi)'],
  invest: ['guaranteed (return|returns|munafa|profit)', '(double|dugna|dugne|dugni) (paisa|paise|money)', '(paisa|paise) (double|dugna|dugne)', 'daily (munafa|profit)', 'pakka (munafa|profit|return)', 'risk free', 'sure shot'],
  authority: ['(giraftari|giraftar) warrant', 'warrant (jari|issue|nikla|hai)', 'aapke naam (par|pe|per) (case|fir|warrant|parcel|drugs|mamla)', '(adalat|sammans|samman) (notice|se|ka)', '(sarkari|sarkar) (adhikari|vibhag|notice)', '(income tax|customs|cyber|narcotics) (vibhag|cell|department)'],
  refund: ['refund (claim|lene|lena|milega|mil jayega|approve|approved|pending)', '(paise|paisa|rupaye) vapas (milenge|milega|aayenge|aa jayenge|aa jaenge|payenge)', 'cashback (claim|lo|le lo|lena)', 'tax refund (milega|mil jayega|approve)'],
  card: ['card (band|block) ho (jayega|gaya|jayegi)', 'points (expire|khatam) ho (jayenge|jayege|rahe|jaenge)', 'limit (badhao|badhane|badhana|increase) (ke liye|karo|kare)'],
  parcel: ['parcel (ruka|ruk gaya|pakda|atka|hold|rok liya|phasa)', 'customs (me|mein) (ruka|phasa|atka|pakda|hai)', 'courier (ruka|atka|fail|phasa)', 'delivery (fail|nahi hui)'],
  callback: ['(is|iss|neeche diye gaye|niche diye gaye) number (par|pe|per) (call|whatsapp|sampark|contact)', '(call|contact|sampark) (karo|kro|kare|karein|kijiye) (abhi|turant)?', 'whatsapp (karo|kare|karein|kijiye)'],
  payFirst: ['(fee|charge|charges|tax|deposit|amount|rupaye|paise) (bhejo|bhej do|bhejiye|jama karo|jama kare|jama karein|jama kijiye|deposit karo|transfer karo|pay karo|bharna hoga|dena hoga|dene honge|bharo)', '\\d+ (rs|rupaye|rupees)? (bhejo|bhej do|bhejiye|jama karo|jama kare|jama karein|deposit karo|transfer karo|pay karo|dena hoga|bharna hoga)'],
  payContext: ['(parcel|customs|prize|inaam|lottery|claim|refund|release|chhudane|chudane|loan|processing|clearance|registration|kbc|cashback)'],
  receivePin: ['(paise|paisa|rupaye) (receive|lene|milne) (karne )?ke liye (upi )?(pin|password) (dalo|daalo|dale|enter karo|enter kare|daliye|bharo)', '(request|collect request) (accept|approve) (karo|kare|kijiye|karein) (aur|or|to) (paise|paisa) (aayenge|milenge|aa jayenge)'],
  utility: ['(bijli|current|gas|pani) (ka )?(connection|supply|bill)? ?(kat|cut|band) (jayega|jaega|jayegi|jaegi|diya jayega|diya jaega|kar di jayegi|kar diya jayega)', 'bijli (ka )?connection (kat|band|cut) (jayega|jaega|diya jayega)', 'bill (pending|baki|baaki) (hai|he)'],
  // Hindi in Devanagari (what the reader returns for a Hindi screenshot)
  threatDev: ['(खाता|अकाउंट) (बंद|ब्लॉक) हो (जाएगा|जायेगा|गया|जाएगी|जायेगी)', '(बंद|ब्लॉक) हो (जाएगा|जायेगा|जाएगी|जायेगी|गया)', 'कनेक्शन (कट|बंद) (जाएगा|जायेगा|हो जाएगा)', '(वरना|नहीं तो) (ब्लॉक|बंद|गिरफ्तार|कार्रवाई)'],
  urgencyDev: ['(तुरंत|अभी|जल्दी|फौरन|आज ही|आज रात)'],
  secrecyDev: ['किसी (को|से) (न|नहीं|मत) (बताएं|बताना|बताइए|बताओ|बोलें|कहें)', 'चुप (रहें|रहना|रहो)'],
  clickLinkDev: ['लिंक (पर|पे) (क्लिक|टैप) (करें|करो|कीजिए)', 'क्लिक (करें|करो|कीजिए)'],
  prizeDev: ['(आप|आपने) (जीत|जीता) (गए|गया|लिया|चुके)', 'लॉटरी (लगी|निकली)', 'इनाम (जीता|मिला|निकला)'],
  authorityDev: ['(वारंट|गिरफ्तार|गिरफ्तारी|पुलिस|सीबीआई|अदालत)'],
  stayOnCallDev: ['वीडियो कॉल (पर|पे) (रहें|रहिए|रहो)', 'कॉल (न|मत) (काटें|काटना|रखें)'],
  kycActDev: ['(अपडेट|वेरीफाई|पेंडिंग|एक्सपायर|बंद|ब्लॉक|करें|करो|कीजिए|जरूरी|ज़रूरी)'],
  payFirstDev: ['(फीस|चार्ज|टैक्स|रुपये|पैसे) (भेजें|भेजो|जमा करें|जमा करो|देना होगा)'],
  mistake: ['(galti|ghalti) se', 'by mistake'],
  mistakeVerb: ['(chale gaye|chale gaya|chali gayi|aa gaye|aa gaya|aa gayi|bhej diye|bhej diya|transfer ho gaye|transfer ho gaya|ho gaye|ho gaya|bhej die|bhej diye hain|pahunch gaye|pahunch gaya)'],
  giveBack: ['(vapas|wapas) (kar|bhej|karo|bhejo|kijiye|bhej do|kar do|bhejiye|lauta|lautao|dedo|de do)', 'paise (vapas|wapas)', 'return (kar|karo|kijiye|kar do)'],
  hasVideo: ['(tumhari|aapki|teri|tumhare|aapke|tere|aapka) (private |personal |nude |gandi |purani )?(video|videos|photo|photos|pic|pics|tasveer|tasvir|chat|recording)', '(mere paas|maine|mere pas) (hai|he|record|recording|save)', '(video|photo|photos|pics) (hai|he) (mere|mere paas|mere pas)'],
  shareThreat: ['(viral|sab contacts|sabko|sab ko|saare contacts|family ko|dosto ko|doston ko|rishtedaaron ko|facebook|instagram|youtube|whatsapp group) (me|mein|par|pe|per|ko)? (bhej|daal|dikha|post|share|viral|upload)', '(bhej dunga|bhej dungi|bhej denge|daal dunga|daal dungi|dikha dunga|post kar dunga|share kar dunga|viral kar dunga|viral kar dungi|upload kar dunga)'],
  demand: ['(paise|paisa|rupaye|rupees|rs) (do|dena|bhejo|bhej do|dene honge|dene padenge|chahiye)', '(nahi to|nahin to|varna|warna)', '\\d+ (do|dena|bhejo|bhej do|rupaye|rs)'],
  scanReceive: ['qr (code )?(ko )?scan (karke|kar ke|karo|kare|karein|kijiye|krke)', 'scan (karke|kar ke|karo|kare|karein|kijiye|krke) (paise|paisa|cashback|rupaye)'],
  receiveWord: ['(receive|recieve|paise|paisa|cashback|rupaye|lo|le lo|lein|milenge|mil jayenge|aayenge|aa jayenge|claim)'],
  utilityPush: ['(aaj raat|aaj shaam|abhi|turant|isi vakt|tonight|today|aaj)', '\\d+ (ghante|ghanta|minute|min) (me|mein|ke andar)']
};

/** The name of a lexicon list. */
export type LexId = keyof typeof LEX;
/** One word of a prepared message: its text, where it sits in the original, and (once computed) its spelling-folded form. */
export interface Token { t: string; s: number; e: number; c?: string }
/** A message ready to search: the original text and its words. */
export interface PreparedMessage { text: string; tokens: Token[] }
/** One place a lexicon entry occurs: the matched text and its span in the original. */
export interface Hit { text: string; s: number; e: number }

const compiled: Partial<Record<LexId, Map<string, string[][]>>> = {};
function phrases(id: LexId): Map<string, string[][]> {
  const done = compiled[id];
  if (done) return done;
  const list = LEX[id] as readonly string[] | undefined;
  if (!list) throw new Error('hinglish: unknown lexicon ' + String(id));
  const byFirst = new Map<string, string[][]>();
  for (const pat of list) for (const ws of expand(pat)) {
    const first = ws[0];
    if (first === undefined) continue;
    const bucket = byFirst.get(first);
    if (bucket) bucket.push(ws); else byFirst.set(first, [ws]);
  }
  compiled[id] = byFirst;
  return byFirst;
}

// Wildcard-aware, spelling-insensitive word equality. `\d+` in an entry stands for a number. tok is a message token ({t}), w is a canonical lexicon word.
function sameWord(tokCanon: string | undefined, tokRaw: string, w: string): boolean {
  if (w === '\\d+') return /^\d+$/.test(tokRaw);
  return tokCanon === w;
}

// Every place a lexicon entry occurs in a prepared message ({text, tokens}), as { text, s, e }. Canonical forms are cached on the tokens.
function findAt(ctx: PreparedMessage, id: LexId): Hit[] {
  const tk = ctx.tokens, byFirst = phrases(id), hits: Hit[] = [];
  for (const t of tk) if (t.c === undefined) t.c = canon(t.t);
  for (let i = 0; i < tk.length; i++) {
    const tok = tk[i];
    if (!tok) continue;
    const firsts = byFirst.get(tok.c ?? '') || (/^\d+$/.test(tok.t) ? byFirst.get('\\d+') : null);
    if (!firsts) continue;
    for (const ws of firsts) {
      if (i + ws.length > tk.length) continue;
      let ok = true;
      for (let k = 0; k < ws.length && ok; k++) { const at = tk[i + k], word = ws[k]; ok = !!at && word !== undefined && sameWord(at.c, at.t, word); }
      const last = tk[i + ws.length - 1];
      if (ok && last) { hits.push({ text: ctx.text.slice(tok.s, last.e), s: tok.s, e: last.e }); break; }
    }
  }
  return hits;
}
const find = (ctx: PreparedMessage, id: LexId): string[] => findAt(ctx, id).map(h => h.text);

// How many lexicon lists have been compiled so far (the first message that needs a list compiles it; the page compiles the rest while idle).
const compiledCount = () => Object.keys(compiled).length;

export { canon, expand, expandRaw, LEX, find, findAt, phrases, compiledCount };
