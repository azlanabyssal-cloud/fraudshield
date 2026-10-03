/* FraudShield domain-name model. A small logistic regression that reads only the part of an address the owner chose (the
   registered name and its ending) and says how much it resembles the domains behind reported phishing.

   What it is not: it never sees the scheme, the path, the query, "www" or a subdomain. Public phishing datasets are full of
   artifacts there (in the one used here every legitimate address is exactly "https://www.<host>"), and a model that learns them
   scores near 100% in a lab and is useless on a real link. It also cannot see the page, the registration date or the
   certificate, which is where most of the signal in phishing detection lives. Measured honestly it is a weak detector, and
   it is used only as a soft warning: it can lift "unverified" to "suspicious", never to "scam". See ADR-0014.

   Training (mlops/urlmodel/train.js) and the browser run this same file, so a feature can never differ between the two. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./linkcheck.js'));
  else root.FraudShieldUrlModel = factory(root.FraudShieldLink);
}(typeof self !== 'undefined' ? self : this, function (Link) {
'use strict';

const KEYS = ['verify', 'secure', 'login', 'signin', 'account', 'update', 'support', 'bank', 'kyc', 'pay', 'refund', 'claim', 'reward', 'wallet', 'confirm', 'alert', 'service', 'online', 'official', 'customer', 'care', 'help', 'free', 'bonus', 'offer', 'gift', 'prize', 'loan', 'invest', 'crypto', 'trade', 'coin'];
const BRANDS = ['sbi', 'hdfc', 'icici', 'axis', 'paytm', 'phonepe', 'gpay', 'google', 'amazon', 'flipkart', 'netflix', 'microsoft', 'apple', 'facebook', 'instagram', 'whatsapp', 'irctc', 'airtel', 'jio', 'paypal', 'binance', 'kotak', 'pnb', 'canara', 'bob'];
const ENGINEERED = ['length', 'digits', 'digitShare', 'hyphens', 'entropy', 'vowelShare', 'consonantRun', 'digitRun', 'keywords', 'brands', 'suffixChars', 'suffixLabels', 'mixesDigitsAndLetters', 'fewDistinctChars', 'hyphenParts'];

const fnv = (s, seed) => { let h = (2166136261 ^ seed) >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };

// The numbers the bins are cut from. Pure functions of the name and ending.
function engineered(name, suffix) {
  const L = name.length, counts = {};
  for (const ch of name) counts[ch] = (counts[ch] || 0) + 1;
  let entropy = 0; for (const k in counts) { const p = counts[k] / L; entropy -= p * Math.log2(p); }
  const digits = (name.match(/\d/g) || []).length, vowels = (name.match(/[aeiou]/g) || []).length;
  const run = re => Math.max(0, ...(name.match(re) || []).map(m => m.length));
  return [L, digits, digits / Math.max(L, 1), (name.match(/-/g) || []).length, entropy, vowels / Math.max(L, 1), run(/[^aeiou0-9-]+/g), run(/\d+/g),
    KEYS.filter(k => name.includes(k)).length, BRANDS.filter(b => name.includes(b)).length, suffix.length, suffix ? suffix.split('.').length : 0,
    digits > 0 && /[a-z]/.test(name) ? 1 : 0, Object.keys(counts).length <= 3 && L > 3 ? 1 : 0, name.split('-').filter(Boolean).length];
}

const binOf = (edges, x) => { let i = 0; while (i < edges.length && x > edges[i]) i++; return i; };   // edges are ascending; the last bin is open

// Feature layout: [0, 2^hashBits) the name's character n-grams; then one block per engineered number (binned); then the ending.
function layout(spec) {
  const H = 1 << spec.hashBits, offsets = []; let at = H;
  for (const edges of spec.bins) { offsets.push(at); at += edges.length + 1; }
  return { H, offsets, tldAt: at, size: at + spec.tlds.length + 1 };
}

function features(name, suffix, spec) {
  const lay = layout(spec), idx = [], val = [];
  const s = '^' + name + '$', seen = new Set();
  for (let n = spec.ngram[0]; n <= spec.ngram[1]; n++) for (let i = 0; i + n <= s.length; i++) { const g = s.slice(i, i + n); if (!seen.has(g)) { seen.add(g); idx.push(fnv(g, 0) & (lay.H - 1)); } }
  const norm = 1 / Math.sqrt(Math.max(idx.length, 1));
  for (let k = 0; k < idx.length; k++) val.push(norm);
  const eng = engineered(name, suffix);
  eng.forEach((x, i) => { idx.push(lay.offsets[i] + binOf(spec.bins[i], x)); val.push(1); });
  const t = spec.tlds.indexOf(suffix); idx.push(lay.tldAt + (t < 0 ? spec.tlds.length : t)); val.push(1);
  return { idx, val, size: lay.size };
}

// Which addresses the model may speak about. IP addresses, one-word hosts and tenants of a shared hosting platform are out of
// scope: the name there is chosen by the platform or is a number, so the model has nothing to say, and the rules take over.
function inScope(host, model) {
  if (!host || !/^[a-z0-9.-]+$/.test(host) || /^\d+(\.\d+){3}$/.test(host) || host.indexOf('.') < 0) return null;
  const reg = Link.registrableDomain(host);
  if (model && model.platforms && model.platforms.indexOf(reg) >= 0) return null;
  const d = Link.splitDomain(host);
  if (d.name.length < 3 || d.name.startsWith('xn--')) return null;
  return d;
}

function logit(model, f) {
  const w = model._w;
  let z = model.bias / model.scale;
  for (let k = 0; k < f.idx.length; k++) z += (w.get(f.idx[k]) || 0) * f.val[k];
  return z;
}

// Turns the stored sparse weights into a lookup once, the first time a model is used.
function prepare(model) {
  if (model._w) return model;
  const w = new Map();
  model.ngram.idx.forEach((i, k) => w.set(i, model.ngram.q[k] / model.scale));
  const lay = layout(model.spec);
  model.eng.forEach((q, k) => w.set(lay.H + k, q / model.scale));
  model.tld.forEach((q, k) => w.set(lay.tldAt + k, q / model.scale));
  model._w = w; return model;
}

// score(host, model) -> null when out of scope, else { score, probability, band: 'high' | 'elevated' | 'none', name, suffix }
function score(host, model) {
  if (!model) return null;
  prepare(model);
  const d = inScope(String(host).toLowerCase().replace(/^www\./, ''), model);
  if (!d) return null;
  const z = logit(model, features(d.name, d.suffix, model.spec));
  const p = 1 / (1 + Math.exp(-(model.calibration.a * z + model.calibration.b)));
  const band = z >= model.thresholds.high.score ? 'high' : z >= model.thresholds.elevated.score ? 'elevated' : 'none';
  return { score: z, probability: p, band, name: d.name, suffix: d.suffix, card: model.card || null };
}

// A half-downloaded or corrupted file must never be installed: a model with a missing weight table would score every name as
// harmless. Throws a precise error instead, so the caller can say that the check is not running. Nothing is changed on failure.
function validate(m) {
  const bad = why => { throw new Error('urlmodel: ' + why); };
  const num = x => typeof x === 'number' && Number.isFinite(x);
  if (!m || typeof m !== 'object') bad('not an object');
  if (!num(m.scale) || m.scale <= 0 || !num(m.bias)) bad('scale or bias is not a usable number');
  const sp = m.spec;
  if (!sp || !Number.isInteger(sp.hashBits) || sp.hashBits < 4 || sp.hashBits > 22) bad('spec.hashBits');
  if (!Array.isArray(sp.ngram) || sp.ngram.length !== 2 || !sp.ngram.every(Number.isInteger) || sp.ngram[0] < 1 || sp.ngram[1] < sp.ngram[0]) bad('spec.ngram');
  if (!Array.isArray(sp.bins) || sp.bins.length !== ENGINEERED.length || !sp.bins.every(b => Array.isArray(b) && b.every(num) && b.every((x, i) => i === 0 || x >= b[i - 1]))) bad('spec.bins');
  if (!Array.isArray(sp.tlds) || !sp.tlds.every(t => typeof t === 'string')) bad('spec.tlds');
  const H = 1 << sp.hashBits;
  if (!m.ngram || !Array.isArray(m.ngram.idx) || !Array.isArray(m.ngram.q) || m.ngram.idx.length !== m.ngram.q.length || !m.ngram.idx.length) bad('ngram weights are missing or ragged');
  if (!m.ngram.idx.every(i => Number.isInteger(i) && i >= 0 && i < H) || !m.ngram.q.every(num)) bad('ngram weights are out of range');
  const engLen = sp.bins.reduce((a, b) => a + b.length + 1, 0);
  if (!Array.isArray(m.eng) || m.eng.length !== engLen || !m.eng.every(num)) bad('engineered-feature weights do not match the bins');
  if (!Array.isArray(m.tld) || m.tld.length !== sp.tlds.length + 1 || !m.tld.every(num)) bad('ending weights do not match the list of endings');
  if (!m.calibration || !num(m.calibration.a) || !num(m.calibration.b)) bad('calibration');
  const th = m.thresholds;
  if (!th || !th.high || !th.elevated || !num(th.high.score) || !num(th.elevated.score) || th.elevated.score > th.high.score) bad('thresholds');
  return m;
}

let installed = null;
const install = model => {
  if (model) validate(model);   // throws before anything is touched: a bad file leaves the analyzer on its rules, and the caller knows
  installed = model ? prepare(model) : null;
  // The analyzer asks for the model's opinion through this one hook. If scoring itself ever throws, the answer is "no opinion", never a crash.
  Link.setScorer(installed ? host => { try { return score(host, installed); } catch (e) { return null; } } : null);
  return installed;
};
const current = () => installed;

// In Node the shipped model loads itself; in a browser the page fetches data/urlmodel.json and calls install().
if (typeof module === 'object' && module.exports) {
  try { install(JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'urlmodel.json'), 'utf8'))); } catch (e) { installed = null; }
}

return { score, install, validate, current, features, engineered, layout, inScope, fnv, KEYS, BRANDS, ENGINEERED, binOf };
}));
