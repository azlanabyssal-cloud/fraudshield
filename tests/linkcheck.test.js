'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { domainToASCII, domainToUnicode } = require('node:url');
const L = require('../lib/linkcheck.js');

const level = s => L.analyzeUrl(s).level;
const table = (rows) => rows.forEach(([url, want, why]) => assert.equal(level(url), want, `${url} (${why})`));

test('official addresses are recognised, including .bank.in, .fin.in and government domains', () => table([
  ['https://www.sbi.co.in/web/personal-banking', 'official', 'SBI'], ['https://onlinesbi.sbi/', 'official', 'SBI online'], ['https://sbi.bank.in/', 'official', '.bank.in is bank-only'],
  ['https://hdfcbank.bank.in/login', 'official', '.bank.in'], ['https://somelender.fin.in/', 'official', '.fin.in is for financial institutions'], ['https://cybercrime.gov.in/Webform/Crime_AuthoLogin.aspx', 'official', 'portal'],
  ['https://digilocker.gov.in/', 'official', 'gov.in is restricted'], ['https://www.epfindia.gov.in/', 'official', 'EPFO'], ['https://www.irctc.co.in/nget/train-search', 'official', 'IRCTC'],
  ['https://www.flipkart.com/offers', 'official', 'Flipkart'], ['paytm.com', 'official', 'bare domain']]));

test('scam patterns: hidden destination, hijacked official names, lookalikes with pressure words, raw IPs, code links', () => table([
  ['http://sbi.co.in@evil.com/login', 'scam', 'userinfo trick'], ['http://192.168.4.20/login', 'scam', 'raw IP'], ['http://0x7f.0.0.1/', 'scam', 'hex IP is normalised to a raw IP'],
  ['https://evilsbi.co.in.attacker.xyz', 'scam', 'official name inside another domain'], ['https://sbi.co.in.kyc-update.xyz', 'scam', 'official domain as a subdomain'],
  ['https://login.hdfcbank.com.verify-now.top/otp', 'scam', 'official domain hijacked'], ['sbi-kyc-update.tk', 'scam', 'brand + kyc + free TLD'], ['https://hdfc-secure-login.com', 'scam', 'brand + pressure words'],
  ['https://sbiyono-update.com', 'scam', 'brand glued to another word'], ['http://paytm-kyc-update.in/verify?otp=1', 'scam', 'brand + kyc'], ['https://amaz0n-india-refund.xyz/claim', 'scam', 'leet brand + refund'],
  ['https://trai-gov.in.verify-sim.top', 'scam', 'government lookalike'], ['http://rto-challan-pay.top/echallan.apk', 'scam', 'apk + pressure + cheap TLD'], ['javascript:alert(1)', 'scam', 'code, not a website'],
  ['https://union-bank.com/netbanking', 'suspicious', 'brand name only, no pressure words']]));

test('weak signals alone are only "suspicious", and an unknown address is "unverified", never "official" or "scam"', () => table([
  ['https://hdfcbnak.com/netbanking', 'suspicious', 'misspelled brand'], ['https://example.com/app.apk', 'suspicious', 'app-file download'],
  ['https://random-shop.com', 'unverified', 'nothing to go on'], ['https://example.info', 'unverified', 'an ending alone proves nothing'], ['https://my-local-sweets.club', 'unverified', 'an ending alone proves nothing'],
  ['https://bit.ly/3abc', 'unverified', 'shortened'], ['https://www.google.com/search?q=sbi', 'unverified', 'brand only in the query'], ['https://axis-physio.com', 'unverified', 'not a bank name']]));

test('well-known honest sites are never called a scam', () => {
  const honest = ['google.com', 'youtube.com', 'wikipedia.org', 'zomato.com', 'swiggy.com', 'myntra.com', 'bookmyshow.com', 'makemytrip.com', 'jio.com', 'airtel.in', 'mygov.in', 'umang.gov.in', 'parivahan.gov.in', 'nsdl.co.in', 'bseindia.com', 'nseindia.com',
    'zerodha.com', 'groww.in', 'github.com', 'microsoft.com', 'apple.com', 'amazon.in', 'hotstar.com', 'olacabs.com', 'uber.com', 'ndtv.com', 'thehindu.com', 'timesofindia.indiatimes.com', 'ugc.gov.in', 'jntua.ac.in', 'gprec.ac.in', 'nptel.ac.in',
    'swayam.gov.in', 'india.gov.in', 'incometax.gov.in', 'epfindia.gov.in', 'uidai.gov.in', 'cowin.gov.in', 'nic.in', 'iitm.ac.in', 'drive.google.com/file/d/abc/view', 'maps.app.goo.gl/xyz', 'whatsapp.com', 'telegram.org', 'razorpay.com', 'phonepe.com', 'ncert.nic.in', 'gem.gov.in'];
  for (const h of honest) assert.notEqual(level(h), 'scam', `${h} must never be called a scam`);
});

test('every verdict explains itself, and no verdict ever says an address is "safe"', () => {
  for (const u of ['https://www.sbi.co.in', 'sbi-kyc-update.tk', 'https://random-shop.com', 'https://bit.ly/x', 'http://1.2.3.4/', 'javascript:1', 'https://sbi.bank.in']) {
    const r = L.analyzeUrl(u);
    assert.ok(L.LEVELS.includes(r.level) && r.headline && r.reasons.length >= 1, u);
    assert.doesNotMatch([r.headline, ...r.reasons].join(' '), /\b(is|are|looks|seems|appears)\s+(totally |completely |perfectly )?safe\b|\b100% safe\b|\bsafe to (click|open|pay|use|visit)\b/i, u);
  }
});

test('analysis is total: no input, however hostile, throws, and the result shape never changes', () => {
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789-._:/?#@%[]<>"\' \t\n\\ünаоеіβ日本あ😀xn--';
  for (let i = 0; i < 3000; i++) {
    let s = ''; const n = Math.floor(rnd() * 70); for (let k = 0; k < n; k++) s += alphabet[Math.floor(rnd() * alphabet.length)];
    for (const r of [L.analyzeUrl(s), L.analyzeUpi('upi://pay?' + s), L.analyzePayload(s)]) {
      assert.ok(L.LEVELS.includes(r.level), JSON.stringify(s)); assert.equal(typeof r.headline, 'string'); assert.ok(Array.isArray(r.reasons));
    }
  }
  assert.doesNotThrow(() => { L.analyzeUrl(null); L.analyzeUrl(undefined); L.analyzeUrl(12345); L.analyzeUrl('x'.repeat(100000)); L.analyzeUrl('https://' + 'a.'.repeat(5000) + 'com'); });
});

test('punycode decoding agrees with Node on random internationalised names', () => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  const pools = ['абвгдеёжзийклмнопрстуфхцчшщыэюя', 'αβγδεζηθικλμνξοπρστυφχψω', 'äöüßéèêñçøåæ', 'अआइईउऊएऐओऔकखगघचछजझटठडढणतथदधनपफबभमयरलवशषसह', '日本語中文한국어', 'abcdefghijklmnopqrstuvwxyz0123456789'];
  for (let i = 0; i < 400; i++) {
    const pool = Array.from(pools[Math.floor(rnd() * pools.length)]); let label = ''; const n = 2 + Math.floor(rnd() * 9);
    for (let k = 0; k < n; k++) label += pool[Math.floor(rnd() * pool.length)] + (rnd() < 0.15 ? 'a' : '');
    const ascii = domainToASCII(label + '.com'); if (!ascii.includes('xn--')) continue;
    assert.equal(L.hostToUnicode(ascii), domainToUnicode(ascii), ascii);
  }
  assert.equal(L.hostToUnicode('xn--mnchen-3ya.de'), 'münchen.de'); assert.equal(L.hostToUnicode('www.example.com'), 'www.example.com');
  for (const bad of ['xn--bad!label.com', 'xn--.com', 'xn--a-.com', 'xn--zzzzzzzzzzzzzzzzzzzz.com', 'xn--\u00fc.com']) assert.equal(L.hostToUnicode(bad), bad, 'malformed label stays as it was: ' + bad);
});

test('an internationalised name that imitates a brand with look-alike letters is caught', () => {
  const ascii = domainToASCII('hdfcbаnk-login.com');   // the "а" is Cyrillic
  assert.match(ascii, /xn--/); const r = L.analyzeUrl('https://' + ascii + '/netbanking');
  assert.equal(r.level, 'scam'); assert.ok(r.codes.includes('homoglyph') || r.codes.includes('mixed-script'), r.codes.join());
});

test('edit distance counts a swap of neighbouring letters as one edit', () => {
  assert.equal(L.damerau('hdfcbank', 'hdfcbnak', 2), 1); assert.equal(L.damerau('hdfcbank', 'hdfcbank', 2), 0); assert.equal(L.damerau('icicibank', 'icicibanc', 2), 1);
  assert.equal(L.damerau('paytm', 'phonepe', 1), 2, 'beyond the cap it reports cap + 1'); assert.equal(L.damerau('a', 'abcdef', 2), 3);
});

test('registrable domain handles India-specific suffixes', () => {
  for (const [host, want] of [['www.sbi.co.in', 'sbi.co.in'], ['a.b.c.example.com', 'example.com'], ['x.hdfcbank.bank.in', 'hdfcbank.bank.in'], ['cybercrime.gov.in', 'cybercrime.gov.in'], ['evil.co.in', 'evil.co.in'], ['example.com', 'example.com']]) assert.equal(L.registrableDomain(host), want, host);
});

/* ---------- UPI payloads ---------- */
const upi = q => L.analyzeUpi('upi://pay?' + q);

test('a UPI QR always states the one fact that defeats the "scan to receive" scam', () => {
  for (const q of ['pa=shop@oksbi&pn=Ravi+Stores&am=120', 'pa=x@ybl', 'pa=refund@ybl&pn=Refund+Desk&tn=claim+refund']) assert.ok(upi(q).reasons[0].includes('only ever sends money out'), q);
});

test('UPI payloads: pretext words are a scam, auto-debit mandates and bad payees are flagged, a plain payment is unverified', () => {
  assert.equal(upi('pa=refund.desk@ybl&pn=Prize+Desk&tn=claim+your+refund&am=5000').level, 'scam');
  assert.equal(upi('pa=winner@okaxis&tn=lottery+reward').level, 'scam');
  assert.equal(L.analyzeUpi('upi://mandate?pa=ravi.k@ybl&am=999').level, 'suspicious', 'an auto-debit request is never a plain payment');
  assert.equal(L.analyzeUpi('upi://mandate?pa=x@ybl&tn=refund+claim').level, 'scam', 'auto-debit dressed up as a refund');
  assert.equal(L.analyzeUpi('upi://mandate?pa=notavpa&am=999').level, 'scam', 'auto-debit to a malformed payee');
  assert.equal(upi('pa=notavpa&am=10').level, 'suspicious');
  assert.equal(upi('pa=ravi.stores@oksbi&pn=Ravi+Stores').level, 'unverified');
  assert.equal(upi('pa=ravi.stores@oksbi&pn=Ravi+Stores&am=120').level, 'unverified');
  assert.match(upi('pa=ravi.stores@oksbi&pn=Ravi+Stores&am=120').reasons.join(' '), /already filled in \(120 rupees\)/);
});

test('payload router: web addresses, UPI links, phone numbers and plain text each go to the right place', () => {
  assert.equal(L.analyzePayload('https://sbi.co.in').kind, 'url'); assert.equal(L.analyzePayload('upi://pay?pa=a@ybl').kind, 'upi'); assert.equal(L.analyzePayload('sbi-kyc.tk').kind, 'url');
  assert.equal(L.analyzePayload('tel:+911234567890').kind, 'other'); assert.equal(L.analyzePayload('WIFI:S:home;T:WPA;P:secret;;').kind, 'other'); assert.equal(L.analyzePayload('hello there').kind, 'text');
  assert.equal(L.analyzePayload('javascript:alert(1)').level, 'scam');
  assert.equal(L.analyzePayload('ravi@ybl').kind, 'upi'); assert.equal(L.analyzePayload('9876543210').kind, 'phone'); assert.equal(L.analyzePayload('+91 98765 43210').kind, 'phone');
  assert.equal(L.analyzePayload('ravi.kumar@gmail.com').kind, 'other', 'a normal email is not a website');
  for (const trick of ['http://sbi.co.in@evil.com', 'sbi.co.in@evil.com', 'https://hdfcbank.com@secure-pay.top/login', 'www.sbi.co.in@evil.com']) {
    const r = L.analyzePayload(trick); assert.equal(r.kind, 'url', trick); assert.equal(r.level, 'scam', trick);
  } assert.equal(L.analyzePayload('').kind, 'text');
});
