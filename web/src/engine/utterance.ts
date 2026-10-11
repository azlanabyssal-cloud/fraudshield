/* Is this text a sentence that stopped in the middle?
   A browser's speech recogniser decides for itself when you have finished, and it often decides during a breath: "What is the main purpose of" arrives as a complete
   result. Answering it gave "I couldn't quite match that", which sounds like the tool failing when the person simply had not finished. A sentence that ends on a word that
   cannot end a sentence ("of", "the", "and", "kya ka") is held and the microphone is reopened so the rest can be added. The same check lets the assistant say "that looks
   cut off" instead of guessing. Deliberately conservative: only function words that cannot end a sentence count, never a content word. */

// Words that cannot end a sentence: articles, "of", conjunctions, helping verbs, possessives, question words, and the Hindi postpositions. "this", "it", "that", "you", "me" can ("what is this"),
// and so can "do" ("what should I do"), "not" ("safe or not") and "why" ("tell me why"), so they are not here ("kya" and "hai" can end a Hindi sentence too).
const FIRM = new Set(['of', 'the', 'a', 'an', 'and', 'or', 'but', 'so', 'if', 'as', 'than', 'then', 'because', 'when', 'while', 'whether', 'is', 'are', 'was', 'were', 'am', 'be', 'been', 'my', 'your', 'our', 'their', 'his', 'her', 'its', 'some', 'any', 'can', 'could', 'will', 'would', 'should', 'what', 'whats', 'how', 'who', 'whom', 'whose', 'which', 'where', 'very', 'just', 'also', 'um', 'uh', 'umm', 'hmm',
  'ka', 'ki', 'ke', 'ko', 'se', 'ne', 'mein', 'par', 'aur', 'ya', 'lekin', 'kyunki', 'agar', 'toh', 'jo', 'jab', 'kaun', 'kaise', 'kyun', 'kab', 'kahan',
  '\u0915\u093e', '\u0915\u0940', '\u0915\u0947', '\u0915\u094b', '\u0938\u0947', '\u0928\u0947', '\u092e\u0947\u0902', '\u092a\u0930', '\u0914\u0930', '\u092f\u093e', '\u0932\u0947\u0915\u093f\u0928', '\u0905\u0917\u0930', '\u0924\u094b', '\u091c\u094b']);
// English can strand a preposition at the end of a question: "what is this for", "what is it about", "who made this for". So these end a sentence only inside a question word's sentence.
const STRANDING = new Set(['for', 'about', 'with', 'from', 'in', 'on', 'at', 'to', 'by', 'into', 'without', 'over', 'under']);
const WH = new Set(['what', 'whats', 'who', 'whom', 'whose', 'which', 'where', 'how', 'why', 'kya', 'kis', 'kisse', 'kiske', 'kiska', 'kiski']);
const TRAILING = new Set([...FIRM, ...STRANDING]);
const LONE = new Set(['what', 'how', 'why', 'who', 'which', 'where', 'when', 'is', 'are', 'can', 'do', 'does', 'tell', 'explain', 'show', 'i', 'my', 'the', 'a', 'please', 'um', 'uh', 'umm', 'hmm', 'so', 'okay', 'and']);
const words = (text: unknown): string[] => (String(text == null ? '' : text).toLowerCase().match(/[a-z0-9]+(?:[.'-][a-z0-9]+)*|[ऀ-ॣ०-ॿ]+/g) || []);

// true when the text stops where a sentence cannot: on a function word, a trailing comma or ellipsis, or a single question word.
export function isIncomplete(text: unknown): boolean {
  const t = String(text == null ? '' : text).trim();
  if (!t) return false;
  if (/(,|\.{2,}|…|-|:|;)\s*$/.test(t)) return true;
  const w = words(t);
  if (!w.length) return false;
  const last = (w[w.length - 1] ?? '').replace(/'/g, '');
  if (w.length === 1) return LONE.has(w[0] ?? '');
  if (FIRM.has(last)) return true;
  return STRANDING.has(last) && !w.slice(0, 3).some(x => WH.has(x));
}

export { TRAILING };
