(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FraudShieldLink = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /* Link and QR-payload analysis. Pure functions, shared by the browser and Node, no network access.

     Principles:
     - A "scam" verdict needs specific, checkable evidence (a hidden destination, an official name hijacked inside another
       domain, a lookalike paired with an action word, a raw IP, an app-file download). Weak signals alone only ever give
       "suspicious". A link we cannot judge is "unverified", never "safe": a clean-looking address proves nothing.
     - Every verdict carries the reasons that produced it, so a person can check them.
     - "official" means the address belongs to a known official domain; it is not a promise about the page's content. */

  const LEVELS = ['scam', 'suspicious', 'unverified', 'official'];

  // brand -> tokens that appear in lookalike hosts, and the registrable domains that really belong to it
  const BRANDS = [
    { name: 'State Bank of India', tokens: ['sbi', 'onlinesbi', 'yono'], domains: ['sbi.co.in', 'onlinesbi.sbi', 'sbicard.com'] },
    { name: 'HDFC Bank', tokens: ['hdfc', 'hdfcbank'], domains: ['hdfcbank.com', 'hdfc.com', 'hdfclife.com', 'hdfcsec.com', 'hdfcergo.com', 'hdfcfund.com'] },
    { name: 'ICICI Bank', tokens: ['icici', 'icicibank'], domains: ['icicibank.com', 'icicisecurities.com', 'icicilombard.com', 'iciciprulife.com', 'icicidirect.com'] },
    { name: 'Axis Bank', tokens: ['axisbank'], domains: ['axisbank.com'] },
    { name: 'Kotak Mahindra Bank', tokens: ['kotak'], domains: ['kotak.com', 'kotaksecurities.com'] },
    { name: 'Punjab National Bank', tokens: ['pnbindia', 'netpnb'], domains: ['pnbindia.in', 'netpnb.com'] },
    { name: 'Bank of Baroda', tokens: ['bankofbaroda'], domains: ['bankofbaroda.in', 'bankofbaroda.com'] },
    { name: 'Canara Bank', tokens: ['canarabank'], domains: ['canarabank.com', 'canarabank.in'] },
    { name: 'Union Bank of India', tokens: ['unionbank'], domains: ['unionbankofindia.co.in'] },
    { name: 'Paytm', tokens: ['paytm'], domains: ['paytm.com', 'paytmbank.com'] },
    { name: 'PhonePe', tokens: ['phonepe'], domains: ['phonepe.com'] },
    { name: 'NPCI / BHIM', tokens: ['npci', 'bhim'], domains: ['npci.org.in', 'bhimupi.org.in'] },
    { name: 'Reserve Bank of India', tokens: ['rbi'], domains: ['rbi.org.in'] },
    { name: 'UIDAI (Aadhaar)', tokens: ['uidai', 'aadhaar', 'aadhar'], domains: ['uidai.gov.in'] },
    { name: 'Income Tax Department', tokens: ['incometax', 'incometaxindia'], domains: ['incometax.gov.in', 'incometaxindia.gov.in'] },
    { name: 'EPFO', tokens: ['epfo', 'epfindia'], domains: ['epfindia.gov.in', 'epfo.gov.in'] },
    { name: 'IRCTC', tokens: ['irctc'], domains: ['irctc.co.in'] },
    { name: 'India Post', tokens: ['indiapost'], domains: ['indiapost.gov.in'] },
    { name: 'TRAI', tokens: ['trai'], domains: ['trai.gov.in'] },
    { name: 'CBI', tokens: ['cbi'], domains: ['cbi.gov.in'] },
    { name: 'National Cyber Crime Portal', tokens: ['cybercrime'], domains: ['cybercrime.gov.in'] },
    { name: 'Amazon', tokens: ['amazon'], domains: ['amazon.in', 'amazon.com'] },
    { name: 'Flipkart', tokens: ['flipkart'], domains: ['flipkart.com'] },
    { name: 'WhatsApp', tokens: ['whatsapp'], domains: ['whatsapp.com'] }
  ];
  const OFFICIAL_DOMAINS = BRANDS.flatMap(b => b.domains.map(d => ({ domain: d, brand: b.name })));

  // Multi-label public suffixes that matter for India, so "co.in" is not mistaken for a registrable domain.
  const MULTI_SUFFIX = new Set(['co.in', 'org.in', 'net.in', 'gov.in', 'nic.in', 'ac.in', 'res.in', 'edu.in', 'firm.in', 'gen.in', 'ind.in', 'mil.in', 'bank.in', 'fin.in',
    'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'co.nz', 'co.za', 'com.br', 'com.sg', 'com.my', 'com.pk', 'com.bd', 'co.id', 'com.np']);

  const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 'cutt.ly', 'rebrand.ly', 'is.gd', 'shorturl.at', 'tiny.cc', 'ow.ly', 'buff.ly', 'rb.gy', 's.id', 'v.gd', 't.ly', 'shorturl.asia', 'bitly.ws', 'tr.ee', 'lnkd.in', 'qr.ae', 'urlz.fr', 'tiny.one']);
  const FREE_TLDS = new Set(['tk', 'ml', 'ga', 'cf', 'gq']);                                                  // free, long abused
  const CHEAP_TLDS = new Set(['xyz', 'top', 'icu', 'click', 'live', 'shop', 'site', 'online', 'buzz', 'cyou', 'sbs', 'cfd', 'vip', 'link', 'support']);
  const ACTION_WORDS = ['kyc', 'verify', 'verification', 'update', 'login', 'signin', 'secure', 'security', 'account', 'support', 'care', 'helpline', 'refund', 'reward', 'rewards', 'claim',
    'prize', 'lottery', 'winner', 'bonus', 'cashback', 'block', 'blocked', 'suspend', 'suspended', 'expire', 'expired', 'otp', 'unlock', 'activate', 'parcel', 'customs', 'challan', 'pan', 'aadhaar'];
  const PRETEXT_WORDS = ['refund', 'prize', 'lottery', 'reward', 'rewards', 'cashback', 'gift', 'winner', 'kyc', 'claim', 'receive', 'bonus', 'loan', 'job', 'salary', 'lucky', 'jackpot'];

  // lookalike letters from other scripts -> the Latin letter they imitate
  const CONFUSABLE = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'һ': 'h', 'к': 'k', 'м': 'm', 'т': 't', 'в': 'b', 'н': 'h', 'ԁ': 'd', 'ӏ': 'l',
    'ο': 'o', 'α': 'a', 'ν': 'v', 'ι': 'i', 'ρ': 'p', 'τ': 't', 'ε': 'e', 'κ': 'k', 'υ': 'u', 'ı': 'i', 'ł': 'l', 'ɡ': 'g', '0': 'o', '1': 'l' };

  /* ---------- small, pure helpers ---------- */
  // RFC 3492 punycode decoding, so "xn--" hosts can be examined as the characters a person would actually see.
  function punycodeDecode(input) {
    const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700; let n = 128, i = 0, bias = 72;
    const out = [], basic = input.lastIndexOf('-');
    for (let j = 0; j < Math.max(basic, 0); j++) { if (input.charCodeAt(j) >= 0x80) throw new RangeError('not basic'); out.push(input.charCodeAt(j)); }
    const digit = c => (c >= 48 && c < 58 ? c - 22 : c >= 65 && c < 91 ? c - 65 : c >= 97 && c < 123 ? c - 97 : base);
    const adapt = (delta, count, first) => { let k = 0; delta = first ? Math.floor(delta / damp) : delta >> 1; delta += Math.floor(delta / count); for (; delta > ((base - tMin) * tMax) >> 1; k += base) delta = Math.floor(delta / (base - tMin)); return Math.floor(k + (base - tMin + 1) * delta / (delta + skew)); };
    for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length;) {
      const old = i;
      for (let w = 1, k = base; ; k += base) {
        if (idx >= input.length) throw new RangeError('bad input');
        const d = digit(input.charCodeAt(idx++));
        if (d >= base) throw new RangeError('bad digit');
        i += d * w; const t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
        if (d < t) break; w *= base - t;
      }
      const len = out.length + 1; bias = adapt(i - old, len, old === 0); n += Math.floor(i / len); i %= len;
      out.splice(i++, 0, n);
    }
    if (!out.length || out.every(c => c < 0x80)) throw new RangeError('not an internationalised label');   // IDNA: an "xn--" label must hide at least one non-ASCII letter
    return String.fromCodePoint(...out);
  }

  function hostToUnicode(host) {
    return host.split('.').map(l => { if (!l.startsWith('xn--')) return l; try { return punycodeDecode(l.slice(4)); } catch (e) { return l; } }).join('.');
  }

  // Optimal-string-alignment distance (counts a swap of two neighbouring letters as one edit), capped for speed.
  function damerau(a, b, cap) {
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[a.length][b.length];
  }

  function registrableDomain(host) {
    const labels = host.split('.');
    if (labels.length <= 2) return host;
    const last2 = labels.slice(-2).join('.');
    return MULTI_SUFFIX.has(last2) ? labels.slice(-3).join('.') : last2;
  }
  const isOfficial = host => OFFICIAL_DOMAINS.find(o => host === o.domain || host.endsWith('.' + o.domain)) || null;
  const mixesScripts = s => /[a-z]/i.test(s) && /[Ͱ-ϿЀ-ӿ]/.test(s);
  const fold = s => Array.from(s).map(c => CONFUSABLE[c] || c).join('');
  // letter runs and digit runs: "sbi2kyc-up" -> sbi, 2, kyc, up   (no regex lookbehind: it breaks Safari before 16.4)
const parts = s => s.match(/[a-z]+|\d+/gi) || [];

  /* ---------- URL analysis ---------- */
  function result(level, headline, reasons, extra) { return { kind: 'url', level, headline, reasons, ...extra }; }

  function analyzeUrl(raw) {
    const input = String(raw == null ? '' : raw).trim().replace(/^[<"'([]+|[>"')\].,;!]+$/g, '');
    if (!input) return result('unverified', "That doesn't look like a link I can check.", ["If it's a phone number or UPI ID, search it online with the word \"scam\": many are already reported."], { codes: ['empty'] });

    const scheme = (/^([a-z][a-z0-9+.-]*):/i.exec(input) || [])[1];
    if (scheme && !/^https?$/i.test(scheme) && !/^[a-z0-9.-]+:\d+/i.test(input)) {
      const s = scheme.toLowerCase();
      if (s === 'javascript' || s === 'data' || s === 'vbscript') return result('scam', 'This is not a web address: it is code.', ['A link that starts with "' + s + ':" runs instructions in your browser instead of opening a website. Genuine banks and offices never send one.'], { codes: ['code-scheme'], scheme: s });
      if (s === 'upi') return analyzeUpi(input);
      return result('unverified', 'This is a "' + s + ':" link, not a website.', ['It opens another app on your phone. Check who sent it and what it asks you to do before you tap.'], { codes: ['other-scheme'], scheme: s });
    }

    let url;
    try { url = new URL(/^https?:\/\//i.test(input) ? input : 'http://' + input); } catch (e) { url = null; }
    if (!url || !url.hostname || !/[.:]/.test(url.hostname) || /\s/.test(input)) return result('unverified', "That doesn't look like a link I can check.", ["If it's a phone number or UPI ID, search it online with the word \"scam\": many are already reported."], { codes: ['unparseable'] });

    const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    const uni = hostToUnicode(host), registrable = registrableDomain(host);
    const path = decodeURIComponentSafe(url.pathname + url.search).toLowerCase();
    const tld = host.split('.').pop();
    const reasons = [], codes = []; let strong = false, weak = 0, brand = null;
    const flag = (code, text, isStrong, w) => { codes.push(code); reasons.push(text); if (isStrong) strong = true; else weak += w || 1; };

    if (url.username || url.password) flag('userinfo', 'Everything before the "@" is decoration. The browser goes to the address after it, so a link can look like a bank while taking you elsewhere.', true);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || /^\[/.test(url.host)) flag('raw-ip', 'It points at a raw IP address, not a name. Real banks and government sites do not send people to bare numbers.', true);

    const hostParts = uni.split('.');
    const nonLatin = hostParts.some(l => /[^\u0020-\u007e]/.test(l));   // anything outside plain printable ASCII
    const govIn = /(^|\.)(gov|nic)\.in$/.test(host);   // gov.in and nic.in are restricted to government bodies
    const official = isOfficial(host) || (govIn ? { brand: 'Government of India', domain: registrableDomain(host) } : null);

    // .bank.in and .fin.in can only be registered by banks and financial institutions, through one government-authorised registrar.
    const regRestricted = /(^|\.)(bank|fin)\.in$/.test(host);

    if (!official && !regRestricted) {
      // 1. an official domain's name used inside someone else's host: "sbi.co.in.attacker.xyz"
      const embedded = OFFICIAL_DOMAINS.find(o => (host.includes('.' + o.domain + '.') || host.startsWith(o.domain + '.') || host.includes(o.domain + '-')) && registrable !== registrableDomain(o.domain));
      if (embedded) { brand = embedded.brand; flag('embedded-official', 'It contains the real address of ' + embedded.brand + ' (' + embedded.domain + ') but belongs to a different domain (' + registrable + '). Only what comes right before the last two parts counts.', true); }

      // 2. a brand name inside the host: lookalike
      const labelsNoSuffix = hostParts.slice(0, hostParts.length - (MULTI_SUFFIX.has(hostParts.slice(-2).join('.')) ? 2 : 1));
      const bits = labelsNoSuffix.flatMap(l => [l, l.replace(/-/g, ''), ...parts(l)]);
      const folded = bits.map(fold);
      for (const b of BRANDS) {
        if (b.domains.some(d => registrable === d)) continue;
        const hit = b.tokens.some(t => {
          const test = x => (t.length >= 4 ? x.includes(t) : (x === t || (x.startsWith(t) && x.length <= t.length + 7) || (x.endsWith(t) && x.length <= t.length + 7)));
          return bits.some(test) || folded.some(test);
        });
        const fuzzy = !hit && b.tokens.some(t => t.length >= 6 && [...bits, ...folded].some(x => x.length >= 6 && damerau(x, t, 1) <= 1));
        if (hit || fuzzy) {
          brand = brand || b.name;
          if (nonLatin && folded.some(x => b.tokens.some(t => x.includes(t))) && !bits.some(x => b.tokens.some(t => x.includes(t)))) flag('homoglyph', 'The letters imitate "' + b.tokens[0] + '" using look-alike characters from another alphabet, a trick to pass for ' + b.name + '.', true);
          else flag(fuzzy ? 'typosquat' : 'impersonation', (fuzzy ? 'It looks like a misspelling of ' : 'It uses the name of ') + b.name + ' but is not their real address' + (b.domains[0] ? ' (' + b.domains[0] + ').' : '.'), false, 3);
          break;
        }
      }
      if (nonLatin && mixesScripts(uni.split('.').join(''))) flag('mixed-script', 'The address mixes letters from different alphabets, which is how look-alike addresses are built.', false, 3);
    }

    if (!official && !regRestricted) {
      if (FREE_TLDS.has(tld)) flag('free-tld', 'The ending ".' + tld + '" is a free domain type that scam sites have used heavily.', false, 2);
      else if (CHEAP_TLDS.has(tld)) flag('cheap-tld', 'The ending ".' + tld + '" is cheap to register and common on scam sites (many honest sites use it too).', false, 1);
      const hits = ACTION_WORDS.filter(w => bits_of(host).includes(w) || new RegExp('(^|[^a-z])' + w + '([^a-z]|$)').test(path));
      if (hits.length) flag('action-words', 'It uses pressure words (' + hits.slice(0, 3).join(', ') + ') of the kind used to rush people into acting.', false, 1);
      const label = registrable.split('.')[0];
      if ((label.match(/-/g) || []).length >= 3) flag('hyphens', 'The domain chains several hyphenated words together, a common pattern in throwaway scam domains.', false, 1);
      if (hostParts.length - registrable.split('.').length >= 3) flag('deep-subdomain', 'It stacks many sub-domains in front of the real domain, which hides who it belongs to.', false, 1);
      if (/\.apk(\?|$)/i.test(url.pathname)) flag('apk', 'It downloads an app file (.apk) directly. Fake bank, challan and KYC apps are spread this way; install apps only from the Play Store or App Store.', false, 3);
      if (url.protocol === 'http:' && (hits_exist(path) || weak >= 2)) flag('no-tls', 'It is not an encrypted (https) link.', false, 1);
    }

    const shortened = SHORTENERS.has(host);
    if (shortened) { codes.push('shortener'); reasons.push("A shortened link hides the real destination, and scammers use shorteners for exactly that. Don't open it unless you completely trust who sent it."); }

    // ----- verdict -----
    const impersonating = codes.includes('impersonation') || codes.includes('typosquat');
    let level, headline;
    if (official) { level = 'official'; headline = 'This is an official address (' + official.brand + ', ' + host + ').'; reasons.unshift('It matches a known official domain. That says nothing about a message that carries it: type the address yourself next time, and never share an OTP or PIN.'); }
    else if (regRestricted && !strong) { level = 'official'; headline = 'This ends in .' + (/\.fin\.in$/.test(host) ? 'fin.in' : 'bank.in') + ', an address only registered financial institutions can get (' + host + ').'; reasons.unshift('The RBI required banks to move to .bank.in and other financial institutions to .fin.in, through one authorised registrar. A scammer cannot register one. It still pays to type the address yourself, and never share an OTP or PIN.'); }
    else if (strong || (impersonating && weak >= 4) || weak >= 6) { level = 'scam'; headline = 'This looks like a scam link.'; }
    else if (impersonating || weak >= 2 || (nonLatin && codes.includes('mixed-script'))) { level = 'suspicious'; headline = 'This link has warning signs.'; }
    else { level = 'unverified'; headline = shortened ? 'This is a shortened link: the real destination is hidden.' : "I can't confirm this address (" + host + ') either way.'; if (!shortened) reasons.push('Nothing here proves it is genuine or fake. When in doubt, go to the site by typing its address yourself instead of clicking.'); }
    return result(level, headline, reasons, { codes, host, registrable, brand, score: weak, strong, shortened });
  }

  function bits_of(host) { return host.split(/[^a-z0-9]+/i).flatMap(p => [p, ...parts(p)]).map(x => x.toLowerCase()); }
  function hits_exist(path) { return ACTION_WORDS.some(w => new RegExp('(^|[^a-z])' + w + '([^a-z]|$)').test(path)); }
  function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  /* ---------- UPI QR payloads ---------- */
  const UPI_TRUTH = 'Scanning a UPI QR code or tapping a UPI link only ever sends money out of your account. A QR code can never receive money for you, so anyone who asks you to scan one to receive a refund or prize is scamming you.';

  function analyzeUpi(raw) {
    let url;
    try { url = new URL(String(raw).trim()); } catch (e) { return { kind: 'upi', level: 'unverified', headline: "That doesn't look like a payment code I can read.", reasons: [UPI_TRUTH], codes: ['unparseable'] }; }
    const action = (url.hostname || '').toLowerCase(), q = url.searchParams;
    const payee = (q.get('pa') || '').trim(), name = (q.get('pn') || '').trim(), amount = (q.get('am') || '').trim(), note = (q.get('tn') || '').trim();
    const reasons = [], codes = []; let strong = false, weak = 0;
    const text = (name + ' ' + note + ' ' + payee).toLowerCase();
    const pretext = PRETEXT_WORDS.filter(w => new RegExp('(^|[^a-z])' + w + '([^a-z]|$)').test(text));

    if (action === 'mandate' || /mandate/.test(action)) { codes.push('mandate'); reasons.push('This sets up a repeat (auto-debit) payment from your account, not a one-time payment. Do not approve it unless you started a subscription yourself.'); weak += 3; }
    else if (action !== 'pay') { codes.push('unknown-action'); reasons.push('This is an unusual payment code (' + (action || 'unknown') + ').'); weak += 1; }
    if (!/^[a-z0-9._-]{2,}@[a-z][a-z0-9]{1,}$/i.test(payee)) { codes.push('bad-payee'); reasons.push(payee ? 'The payee address "' + payee + '" is not in the normal name@bank form.' : 'There is no payee address in this code.'); weak += 2; }
    if (pretext.length) { codes.push('pretext'); reasons.push('The payee or note uses ' + pretext.slice(0, 3).join(', ') + ': words scammers use to make you pay when you were promised money.'); strong = true; }
    if (amount && action === 'pay') { codes.push('amount'); reasons.push('The amount is already filled in (' + amount + (q.get('cu') && q.get('cu') !== 'INR' ? ' ' + q.get('cu') : ' rupees') + '). Check it before you pay: scams often pre-fill a sum.'); weak += 1; }
    reasons.unshift(UPI_TRUTH);
    const who = (name ? name + ' ' : '') + (payee ? '(' + payee + ')' : '');
    let level, headline;
    if (strong || weak >= 4) { level = 'scam'; headline = 'This QR code looks like a scam' + (who ? ': it would pay ' + who + '.' : '.'); }
    else if (weak >= 2) { level = 'suspicious'; headline = 'This payment code has warning signs' + (who ? ': it would pay ' + who + '.' : '.'); }
    else { level = 'unverified'; headline = 'This QR code will send money out of your account' + (who ? ' to ' + who : '') + '. I cannot tell whether the payee is genuine.'; }
    return { kind: 'upi', level, headline, reasons, codes, payee, name, amount, note, action };
  }

  /* ---------- what was inside a QR code or message ---------- */
  function analyzePayload(text) {
    const s = String(text == null ? '' : text).trim();
    if (/^upi:\/\//i.test(s)) return analyzeUpi(s);
    if (/^[a-z0-9._-]{2,}@[a-z][a-z0-9]{1,}$/i.test(s)) return analyzeUpi('upi://pay?pa=' + encodeURIComponent(s));   // a bare payment address such as name@bank
    if (/^(\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}$/.test(s) || /^(\+|00)\d[\d\s-]{7,14}$/.test(s)) {
      return { kind: 'phone', level: 'unverified', headline: "This is a phone number. I can't tell whether it is genuine.", codes: ['phone'],
        reasons: ['No tool can verify a caller from a number alone, and numbers are easy to fake. Police, CBI, courts and banks do not demand money or an OTP over a call. If the caller does, hang up and call 1930.'] };
    }
    // an address whose "name" part ends like a web address (sbi.co.in@evil.com) is the hidden-destination trick, not an email
    if (/^[^\s@/:?#]+@[^\s@/:?#]+\.[a-z]{2,}$/i.test(s) && !/\.(com|in|net|org|gov|edu|co|bank|fin|sbi)$/i.test(s.split('@')[0])) {
      return { kind: 'other', level: 'unverified', headline: 'This is an email address, not a website.', codes: ['other-email'], reasons: ['Check who gave it to you and what they want. Banks do not ask for an OTP, PIN or password by email.'] };
    }
    if (/^(https?:\/\/|www\.)/i.test(s) || /^([a-z0-9.-]+@)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i.test(s) || /^(javascript|data|vbscript):/i.test(s)) return analyzeUrl(s);
    const m = /^(tel|sms|smsto|mailto|geo|wifi|begin:vcard)/i.exec(s);
    if (m) {
      const k = m[1].toLowerCase();
      const what = k === 'tel' ? 'a phone number' : /^sms/.test(k) ? 'a text message to send' : k === 'mailto' ? 'an email address' : k === 'wifi' ? 'Wi-Fi details' : k === 'geo' ? 'a map location' : 'a contact card';
      return { kind: 'other', level: 'unverified', headline: 'This code contains ' + what + ', not a website.', reasons: ['Check who gave you this code and what it asks you to do before you act on it.'], codes: ['other-' + k] };
    }
    return { kind: 'text', level: 'unverified', headline: 'This code holds plain text.', reasons: ['"' + s.slice(0, 160) + '"'], codes: ['text'], text: s };
  }

  return { LEVELS, BRANDS, OFFICIAL_DOMAINS, analyzeUrl, analyzeUpi, analyzePayload, registrableDomain, hostToUnicode, punycodeDecode, damerau, UPI_TRUTH };
}));
