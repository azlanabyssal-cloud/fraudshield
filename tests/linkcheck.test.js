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

test('short brand names are matched as names, not as letters: ordinary words that happen to contain them are left alone', () => {
  // each of these was a real false alarm on a legitimate domain in the training split of the phishing corpus
  for (const host of ['mytrainingsitepro.xyz', 'namibia-tracks-and-trails.com', 'traingon.top', 'sbis.link', 'cbinsights.com', 'turbi.com', 'rbitech.io', 'strait-trading.top', 'cabinet-sbirt.org', 'bhimrao-college.top', 'epfoundation.xyz']) {
    const r = L.analyzeUrl('https://' + host + '/'); assert.notEqual(r.level, 'scam', host); assert.ok(!r.codes.includes('impersonation'), `${host}: ${r.codes}`);
  }
  // and the real imitations are still caught, with or without separators
  for (const host of ['sbi-kyc-update.top', 'sbikyc.xyz', 'sbi2kyc.top', 'hdfcbank-login.xyz', 'hdfc-netbanking.top', 'trai-gov-notice.top', 'rbi-refund.xyz', 'cbi-case-status.top', 'epfo-claim.top']) {
    const r = L.analyzeUrl('https://' + host + '/'); assert.equal(r.level, 'scam', host + ' ' + r.codes);
  }
});

test('a brand\'s own regional sites and unusual endings are not accused, while a real hijack of the same official name still is', () => {
  for (const host of ['amazon.com.au', 'amazon.com.br', 'amazon.de', 'amazon.co.uk', 'www.amazon.co.jp']) assert.equal(L.analyzeUrl('https://' + host + '/').level, 'official', host);
  assert.equal(L.analyzeUrl('https://amazon.care/').level, 'suspicious', 'the ending is not a pressure word');
  for (const host of ['amazon.com.attacker.xyz', 'amazon.com.verify-now.top', 'sbi.co.in.kyc-update.xyz', 'hdfcbank.com.secure-login.top']) assert.equal(L.analyzeUrl('https://' + host + '/').level, 'scam', host);
  assert.equal(L.analyzeUrl('https://hdfc-care.top/').level, 'scam', 'but "care" inside the name still counts');
});

test('a brand name merely inside a longer label is a warning, and becomes a scam only with more evidence beside it', () => {
  assert.equal(L.analyzeUrl('https://amazonia-travel.com/').level, 'suspicious'); assert.equal(L.analyzeUrl('https://amazonia-travel.top/').level, 'suspicious');
  assert.equal(L.analyzeUrl('https://hdfcbank.xyz/').level, 'scam', 'the bank\'s own name on a cheap ending');
  assert.equal(L.analyzeUrl('https://hdfcbank.net/').level, 'suspicious', 'the bank\'s own name alone is a warning, not yet an accusation');
});

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

test('splitDomain finds the name the owner chose, in any country\'s suffix', () => {
  for (const [host, name, suffix, subs] of [['www.example.com', 'example', 'com', ['www']], ['shop.sbi.co.in', 'sbi', 'co.in', ['shop']], ['paytm-kyc.com.br', 'paytm-kyc', 'com.br', []], ['a.b.ravi.co.uk', 'ravi', 'co.uk', ['a', 'b']], ['bank.in', 'bank', 'in', []], ['sbi.bank.in', 'sbi', 'bank.in', []], ['x.ac.jp', 'x', 'ac.jp', []], ['localhost', 'localhost', '', []], ['co.uk', 'co', 'uk', []]]) {
    const d = L.splitDomain(host); assert.equal(d.name, name, host); assert.equal(d.suffix, suffix, host); assert.deepEqual(JSON.parse(JSON.stringify(d.subdomains)), subs, host);
  }
  assert.equal(L.registrableDomain('login.hdfc-bank.com.br'), 'hdfc-bank.com.br'); assert.equal(L.registrableDomain('a.b.c.example.co.za'), 'example.co.za');
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

/* ---------- red-team pass: gaps found by attacking the analyzer ---------- */
const lv = u => L.analyzeUrl(u);
const pay = u => L.analyzePayload(u);

test('a brand named in a short folder of someone else\'s address is how a phishing kit is laid out, and is flagged; news about the brand is not', () => {
  for (const u of ['https://evil-shop.com/sbi/kyc-update', 'https://mysite.in/hdfcbank/login.php', 'https://example.org/paytm/refund?id=1', 'https://random.xyz/icici-netbanking', 'https://sites.google.com/view/sbi-kyc', 'https://linktr.ee/sbi.kyc']) {
    const r = lv(u); assert.equal(r.level, 'suspicious', u); assert.ok(r.codes.includes('brand-in-path') || r.codes.includes('official-in-query'), u);
  }
  for (const u of ['https://news.example.com/blog/how-sbi-protects-you', 'https://www.thehindu.com/business/sbi-profit/', 'https://economictimes.indiatimes.com/sbi-kyc-fraud-warning', 'https://www.thehindu.com/topic/sbi', 'https://www.sbi.co.in/web/personal-banking', 'https://www.google.com/search?q=sbi+login']) assert.notEqual(lv(u).level, 'suspicious', u);
  assert.notEqual(lv('https://evil-shop.com/sbi/kyc-update').level, 'scam', 'a path alone never makes a scam verdict');
});

test('a link that forwards to another address is judged by where it ends up, and the worse verdict wins', () => {
  const wrapped = lv('https://www.google.com/url?q=https://sbi-kyc-update.tk/login'); assert.equal(wrapped.level, 'scam'); assert.ok(wrapped.codes.includes('forwards-to')); assert.equal(wrapped.forwardsTo, 'sbi-kyc-update.tk'); assert.match(wrapped.reasons[0], /only a doorway/);
  const bank = lv('https://sbi.co.in/login?next=https://evil-claim.tk'); assert.notEqual(bank.level, 'official', 'a real bank page that sends you elsewhere is not "official"'); assert.ok(bank.codes.includes('forwards-to'));
  assert.equal(lv('https://accounts.google.com/signin?continue=https://mail.google.com').level, 'unverified', 'forwarding to something harmless does not raise it');
  assert.equal(lv('https://www.bing.com/search?q=https://sbi.co.in').codes.includes('forwards-to'), false, 'a search for an address is not a forward');
  const deep = lv('https://a.example/r?u=' + encodeURIComponent('https://b.example/r?u=' + encodeURIComponent('https://c.example/r?u=https://sbi-kyc.tk/')));
  assert.ok(deep.codes.includes('forwards-to'), 'two hops are followed'); assert.doesNotThrow(() => lv('https://a.example/?u=https://a.example/?u=https://a.example/?u=https://a.example/?u=https://a.example/'), 'and a long chain stops');
  assert.equal(lv('https://abc.top/?redirect=sbi.co.in').level, 'suspicious', 'an official address tucked into a query value');
});

test('a backslash in the address, or invisible characters inside it, are called out; invisible characters at the ends (a chat-app artefact) are ignored', () => {
  assert.equal(lv('https://sbi.co.in\\@evil.com').level, 'scam'); assert.ok(lv('https://sbi.co.in\\@evil.com').codes.includes('backslash'));
  assert.equal(lv('https://sbi.co.in/a\\b').level, 'official', 'a backslash in the path is harmless');
  for (const u of ['https://sbi\u200b.co.in', 'https://sbi.co.in/\u202egpj.exe']) { const r = lv(u); assert.equal(r.level, 'scam', JSON.stringify(u)); assert.ok(r.codes.includes('hidden-characters')); }
  assert.equal(lv('\u200ehttps://www.irctc.co.in/\u200b').level, 'official'); assert.equal(lv('https://www.irctc.co.in/\u200b').level, 'official');
});

test('UPI codes: parameter names are case-insensitive, a payee named like bank support is flagged, two payees are flagged, and payment-app links are read like UPI codes', () => {
  assert.deepEqual(pay('UPI://PAY?PA=SHOP@OKAXIS&PN=Ravi&AM=250').codes, ['amount']);
  const imp = pay('upi://pay?pa=sbi.support.helpline@ybl&pn=SBI%20Support&am=1'); assert.equal(imp.level, 'scam'); assert.ok(imp.codes.includes('payee-impersonation'));
  for (const ok of ['upi://pay?pa=paytmqr281005050101abc@paytm&pn=Ravi%20Kirana&am=250', 'upi://pay?pa=rahul@sbi&pn=Rahul%20Kumar', 'upi://pay?pa=sbicard@sbi&pn=SBI%20Card']) assert.ok(!pay(ok).codes.includes('payee-impersonation'), ok);
  const dup = pay('upi://pay?pa=shop@okaxis&PA=evil@ybl&am=10'); assert.ok(dup.codes.includes('duplicate-pa')); assert.notEqual(dup.level, 'unverified'); assert.ok(pay('upi://pay?pa=a@ybl&am=1&am=9999').codes.includes('duplicate-am'));
  assert.ok(!pay('upi://pay?pa=shop@okaxis&pa=shop@okaxis&am=10').codes.includes('duplicate-pa'), 'the same value twice is only repetition');
  assert.equal(pay('upi:pay?pa=shop@okaxis&pn=Shop').kind, 'upi');
  for (const u of ['paytmmp://pay?pa=shop@ybl&am=100', 'phonepe://pay?pa=shop@ybl&am=100', 'tez://upi/pay?pa=shop@okaxis&am=1', 'gpay://upi/pay?pa=shop@okaxis&am=1']) { const r = pay(u); assert.equal(r.kind, 'upi', u); assert.ok(r.codes.includes('app-link')); }
  assert.equal(pay('paytmmp://pay?pa=refund@ybl&pn=Refund&am=500').level, 'scam'); assert.equal(pay('bhim://nothing').kind, 'text', 'a deep link with no payment inside is just text');
});

test('fuzz: 40,000 hostile strings through the link, payload and message analyzers never throw, always return a level, and never take long', () => {
  const M = require('../lib/msgcheck.js'), C = require('../lib/core.js');
  let seed = 42; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296, pick = a => a[Math.floor(rnd() * a.length)];
  const frag = ['http://', 'https://', '//', 'www.', 'sbi', '.co.in', '.com', '@', ':', '%', '%2e', '%00', '\\', '\u202e', '\u200b', 'xn--', '-', '.', '..', '/', '?', '=', '&', '#', '[', ']', '::1', '192.168.0.1', 'login', 'kyc', '\u0000', '\n', ' ', '日本', 'ｓｂｉ', 'a'.repeat(70), '9999999999', '%zz', '?u=https://x.y', '?next=https://sbi.co.in', 'upi://pay?pa=', 'am=', '&pn=', 'javascript:', 'data:', 'paytmmp://', 'accidentally ', 'scan the qr to receive '];
  const t0 = Date.now(); let worst = 0;
  for (let i = 0; i < 10000; i++) {
    let str = ''; for (let j = 0, k = 1 + Math.floor(rnd() * 9); j < k; j++) str += pick(frag) + (rnd() < 0.3 ? String.fromCharCode(32 + Math.floor(rnd() * 0xD000)) : '');
    for (const f of [x => L.analyzeUrl(x), x => L.analyzePayload(x), x => M.analyzeMessage(x), x => C.findLinkIn(x)]) { const a = Date.now(); const r = f(str); worst = Math.max(worst, Date.now() - a); if (r && r.level !== undefined) assert.ok(['scam', 'suspicious', 'unverified', 'official', 'nothing'].includes(r.level), str); }
  }
  assert.ok(worst < 100, `slowest single call ${worst} ms`); assert.ok(Date.now() - t0 < 20000);
  for (const bomb of ['accidentally '.repeat(20000), 'scan '.repeat(30000) + 'qr', 'have your '.repeat(15000), 'https://x.com/' + 'sbi/'.repeat(20000) + 'login', 'https://x.com/?' + 'u=https://a.b&'.repeat(5000)]) { const a = Date.now(); M.analyzeMessage(bomb); L.analyzeUrl(bomb); assert.ok(Date.now() - a < 500, 'no catastrophic backtracking'); }
});
