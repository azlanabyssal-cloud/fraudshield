'use strict';
// The message check is a rule list, so it is tested the way a rule list should be: a table of hand-written scams across every
// family and language, a table of genuine messages it must leave alone, and properties that no rule change may break.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lib/msgcheck.js');
const core = require('../lib/core.js');

const run = s => M.analyzeMessage(s);
const flagged = r => r.level === 'scam' || r.level === 'suspicious';

// Written from the patterns documented on tips.html and in public advisories; none is copied from a benchmark.
const SCAMS = [
  ['kyc link', 'Dear customer, your KYC expires today. Update now at bankkyc-verify.xyz or your account will be blocked.', 'scam', 'kyc'],
  ['kyc no link', 'SBI alert: your KYC is pending and your account will be blocked tonight. Call 9876501234 to update immediately.', 'scam', 'kyc'],
  ['kyc hindi', 'आपका केवाईसी आज समाप्त हो रहा है। अभी अपडेट करें, वरना खाता बंद हो जाएगा।', 'suspicious', 'kyc'],
  ['kyc obfuscated', 'K Y C pending. Upd@te now or acc0unt will be blocked, click here', 'scam', 'kyc'],
  ['digital arrest', 'This is the Cyber Crime Branch. A parcel in your name has illegal items. Stay on this video call. Do not tell anyone.', 'scam', 'arrest'],
  ['cbi call', 'CBI officer here. There is an arrest warrant against you. Do not disconnect the call and keep your camera on.', 'scam', 'arrest'],
  ['trai sim', 'TRAI notice: your SIM will be blocked within 2 hours. Press 1 to speak to the officer. Do not tell anyone.', 'scam', 'arrest'],
  ['otp ask', 'Sir your refund is ready. Please share your OTP with our agent to receive it.', 'suspicious', 'otp'],
  ['otp ask hinglish', 'otp bhejo jaldi warna account band ho jayega', 'suspicious', 'otp'],
  ['cvv ask', 'To keep your card active, send me your card number and CVV now', 'scam', 'otp'],
  ['upi collect', 'You have a pending payment of ₹5,000. Approve the request in your UPI app to receive it.', 'suspicious', 'upi'],
  ['upi pin receive', 'To receive your cashback enter UPI PIN to receive the amount', 'suspicious', 'upi'],
  ['task job', 'Part-time job: earn ₹500 per task. Deposit ₹5,000 first to unlock higher earnings.', 'scam', 'fee'],
  ['like and earn', 'Like and earn daily 3000 rupees from home. Join our telegram task group.', 'suspicious', 'job'],
  ['registration fee', 'Congratulations, you are selected. Pay registration fee of Rs 1500 to confirm your job.', 'suspicious', 'fee'],
  ['investment vip', 'Join our VIP group. Guaranteed 40% monthly returns. Limited seats.', 'suspicious', 'invest'],
  ['investment double', 'Invest 10000 and double your money in 30 days. Risk free. Insider tip from our expert.', 'scam', 'invest'],
  ['lottery', 'Congratulations! You have won Rs 25,00,000 in the KBC lucky draw. Contact our manager to claim. Pay processing fee of Rs 2,500.', 'scam', 'fee'],
  ['prize', 'You are the winner of a lucky draw. Reply now to claim your gift.', 'suspicious', 'prize'],
  ['parcel fee', 'Your parcel is held at customs. Pay ₹49 to release it: parcel-fee.top/pay', 'scam', 'fee'],
  ['delivery failed', 'Delivery failed, address incomplete. Update address within 24 hours: courier-india.xyz/update', 'scam', 'parcel'],
  ['power', 'Your power will be disconnected tonight at 9:30 pm. Pay ₹10 on this link to avoid disconnection.', 'suspicious', 'contact'],
  ['card points', 'Your credit card reward points will expire today. Redeem your points now: hdfc-rewards-claim.top', 'scam', 'card'],
  ['card block', 'Your credit card will be blocked today. Share OTP to verify immediately.', 'scam', 'otp'],
  ['apk', 'RTO challan pending. Install this app to pay: echallan-pay.top/echallan.apk', 'scam', 'app'],
  ['anydesk', 'For refund processing please install AnyDesk and tell me the code shown', 'suspicious', 'app'],
  ['quicksupport', 'Our executive will help you. Download QuickSupport and share the 9 digit code.', 'suspicious', 'app'],
  ['refund link', 'Claim your refund now at upi-refund-claim.tk/login', 'scam', 'refund'],
  ['hindi lottery', 'बधाई हो! आपने लॉटरी जीती है। अभी इनाम पाने के लिए संपर्क करें', 'suspicious', 'prize'],
  ['secrecy only plus authority', 'Police case registered. Do not tell anyone, even family, or you will be arrested. Immediately pay the fine.', 'scam', 'arrest']
];

const GENUINE = [
  ['login otp', '123456 is your OTP for login to HDFC NetBanking. Do not share it with anyone. -HDFC Bank'],
  ['delivery otp', 'Your Amazon delivery OTP is 4821. Share it with the delivery agent only when you receive the parcel.'],
  ['debit alert', 'Rs 2,000.00 debited from A/c XX1234 on 03-Oct-26 to VPA shop@oksbi. If not you, call 1930 or your bank.'],
  ['credit alert', 'Rs 45,000 credited to your A/c XX9876 on 01-Oct. Avl Bal Rs 61,240. -SBI'],
  ['bill', 'Your electricity bill of Rs 840 is due on 10 Oct. You can pay in the official app or at the counter.'],
  ['shipped', 'Your order has been shipped and will arrive by Tuesday. Track it in the Flipkart app.'],
  ['irctc', 'PNR 4521896321: your ticket is confirmed. Train 12723 departs 18:25 from Kurnool. Happy journey.'],
  ['appointment', 'Your appointment with Dr Rao is confirmed for 10 Oct at 4:30 pm. Reply 1 to cancel.'],
  ['friend', 'Call me when you are free, we need to talk about the lab record before Monday.'],
  ['meeting', 'Meeting at 5 pm tomorrow, join on the video call link I sent in the group.'],
  ['wedding', 'Congratulations on your marriage! Wishing you both a lifetime of happiness.'],
  ['promotion', 'Congratulations on your promotion, you earned it. Let us celebrate on Saturday.'],
  ['kyc done', 'Your KYC has been updated successfully. Thank you for banking with us.'],
  ['kyc branch', 'Your KYC documents are due for renewal. Please visit your nearest branch with Aadhaar and PAN.'],
  ['never share', 'Never share your OTP, PIN or password with anyone, including bank staff.'],
  ['bank warning', 'Bank will never ask you to share OTP, CVV or PIN over a call or SMS. Report suspicious calls on 1930.'],
  ['dont share', "Don't share your UPI PIN with anybody. Staying alert keeps your money safe."],
  ['hindi warning', 'किसी के साथ अपना ओटीपी साझा न करें। बैंक कभी ओटीपी नहीं मांगता।'],
  ['news', 'CBI arrests two officials in a bribery case, officials said on Friday.'],
  ['awareness question', 'What is a digital arrest and how do people fall for it?'],
  ['statement', 'Your account statement for September is available in the app. Download it from the Statements tab.'],
  ['resume', 'Please share your resume at hr@example.com before Friday for the campus drive.'],
  ['assignment', 'Send me the assignment PDF tonight, I will submit it tomorrow morning.'],
  ['recharge', 'Recharge of Rs 299 successful for 9876501234. Validity 28 days. Thank you.'],
  ['salary', 'Your salary for September has been credited. Payslip is available on the HR portal.'],
  ['college', 'Fee payment last date is 15 Oct. Pay through the college portal gprec.ac.in to avoid the late fee.'],
  ['food', 'Your Swiggy order is out for delivery. The delivery partner will call you on arrival.'],
  ['otp use', 'Use 482910 as your OTP to log in. It is valid for 10 minutes.'],
  ['cashback', 'You received a cashback of Rs 25 on your last recharge. Check your wallet balance in the app.'],
  ['link official', 'Download your admit card from https://www.nptel.ac.in/ before the exam.']
];

test('hand-written scams in English, Hinglish and Hindi are caught, at the right strength and in the right family', () => {
  for (const [name, text, minLevel, family] of SCAMS) {
    const r = run(text), rank = { nothing: 0, suspicious: 1, scam: 2 };
    assert.ok(rank[r.level] >= rank[minLevel], `${name}: expected at least "${minLevel}", got "${r.level}" (score ${r.score}: ${r.codes.join(', ')})`);
    assert.ok(r.codes.length >= 1 && r.evidence.length >= 1, name + ' explains itself');
    const families = r.evidence.map(e => e.family); assert.ok(families.includes(family) || r.family === family, `${name}: expected family "${family}", got ${families.join(',')}`);
  }
});

test('genuine messages, including real bank warnings and OTP texts, are left alone', () => {
  const wrong = GENUINE.map(([name, text]) => [name, run(text)]).filter(([, r]) => flagged(r)).map(([name, r]) => `${name} -> ${r.level} (${r.codes.join(', ')})`);
  assert.deepEqual(wrong, []);
});

test('"do not share your OTP" is the bank doing its job; "share your OTP" is the scam. The same words, opposite meaning', () => {
  for (const secret of ['OTP', 'PIN', 'password', 'CVV', 'Aadhaar number', 'card number']) {
    for (const warn of [`Do not share your ${secret} with anyone.`, `Never share your ${secret}.`, `Don't share your ${secret} with anybody`, `Please do not share your ${secret}`, `The bank will never ask you to share your ${secret}.`]) {
      assert.equal(run(warn).level, 'nothing', warn);
    }
    const asks = c => c.includes('ask-secret') || c.includes('ask-credential');
    assert.ok(asks(run(`Please share your ${secret} now`).codes), secret);
    assert.ok(asks(run(`send me your ${secret}`).codes), secret);
  }
});

test('every verdict quotes words that are really in the message', () => {
  for (const [, text] of SCAMS) {
    const r = run(text), norm = core.normalize(text).toLowerCase().replace(/(\d),(?=\d)/g, '$1');
    for (const e of r.evidence) for (const part of e.quote.split(' … ')) assert.ok(norm.includes(part.toLowerCase()) || e.id.startsWith('link-'), `"${part}" is not in: ${text}`);
  }
});

test('it never calls a message genuine, safe or legitimate, not even when it finds nothing', () => {
  const bad = /\b(?:is|looks|seems|appears|are)\s+(?:totally |completely |perfectly )?(?:safe|genuine|legit|legitimate|real|authentic)\b/i;
  for (const [, text] of [...SCAMS, ...GENUINE]) { const r = run(text); assert.doesNotMatch([r.headline, ...r.next].join(' '), bad, text); }
  const none = run(GENUINE[0][1]); assert.equal(none.level, 'nothing'); assert.match(none.next.join(' '), /does not make it genuine/);
});

test('obfuscation does not hide a scam: spaced letters, swapped characters, zero-width characters and look-alike letters', () => {
  const base = 'Your account will be blocked today. Share your OTP immediately';
  assert.ok(flagged(run(base)));
  for (const t of ['Your account will be blocked today. Share your O T P immediately', 'Your account will be blocked today. Share your 0TP immediately', 'Your acc​ount will be bl​ocked today. Sh​are your OTP immediately', 'Your account will be blocked today. Shаre your ОTP immediately']) {
    assert.ok(flagged(run(t)), JSON.stringify(t));
  }
});

test('adding words to a message never lowers its score (the rules only ever add evidence)', () => {
  const rnd = (seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)(5);
  const pool = [...SCAMS, ...GENUINE].map(x => x[1]);
  for (let i = 0; i < 3000; i++) {
    const a = pool[Math.floor(rnd() * pool.length)], b = pool[Math.floor(rnd() * pool.length)];
    assert.ok(run(a + ' ' + b).score >= run(a).score, `appending "${b}" to "${a}"`);
  }
});

test('the analysis is total: any input, however hostile or long, returns a well-formed result quickly', () => {
  const rnd = (seed => () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296)(9);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz ABC0123456789₹@$%.,:/\\-_\n\t​￿оеаकखगघ😀';
  for (let i = 0; i < 2000; i++) {
    let s = ''; const n = Math.floor(rnd() * 120); for (let k = 0; k < n; k++) s += alphabet[Math.floor(rnd() * alphabet.length)];
    const r = run(s); assert.ok(M.LEVELS.includes(r.level) && typeof r.headline === 'string' && Array.isArray(r.next) && Array.isArray(r.evidence) && Number.isFinite(r.score), JSON.stringify(s));
  }
  for (const v of [null, undefined, 42, {}, [], '', '   ', '\n\n']) assert.equal(run(v).level, 'nothing');
  const t0 = Date.now(); run(SCAMS.map(s => s[1]).join(' ').repeat(40)); run('a '.repeat(60000)); assert.ok(Date.now() - t0 < 1500, 'a 100,000-character paste does not hang the page');
});

test('every scam family points at a chat flow that exists, and every rule has a family that can answer', () => {
  const intents = Object.keys(core.CHAT_INTENT_KEYWORDS);
  for (const [family, info] of Object.entries(M.FAMILIES)) { assert.ok(intents.includes(info.intent), `${family} -> ${info.intent}`); assert.ok(info.next.length >= 1 && info.name); }
  for (const rule of M.RULES) { assert.ok(M.FAMILIES[rule.family], rule.id); assert.ok(rule.label.length > 20 && [1, 2, 3, 5].includes(rule.w)); }
});

test('a link inside the message is judged by the link analyzer and outweighs the wording', () => {
  assert.equal(run('Hi, see https://sbi-kyc-update.tk/login').level, 'scam');
  assert.equal(run('Download the form from https://www.nptel.ac.in/downloads').level, 'nothing');
  const r = run('Update here http://sbi.co.in@evil.com/login'); assert.equal(r.level, 'scam'); assert.ok(r.link && r.link.level === 'scam'); assert.ok(r.next.some(l => /link/i.test(l)));
  assert.equal(run('Your order is out. Track at https://random-shop.com/track').level, 'nothing', 'one unverified link alone is not an accusation');
  for (const text of ['Dear customer, your KYC expires today. Update now at bankkyc-verify.xyz or your account will be blocked.', 'Hi, see https://sbi-kyc-update.tk/login']) {
    const said = run(text).next.filter(l => /\blink\b/i.test(l)).length; assert.equal(said, 1, 'the link warning is given once, not twice: ' + text);
  }
});

test('a scammer cannot buy an exemption: "delivery agent" excuses an OTP ask only in the same sentence', () => {
  assert.equal(run('Share the OTP with the delivery agent when he arrives.').level, 'nothing');
  assert.ok(flagged(run('Please share your OTP to claim the refund. Your delivery agent will call.')), 'a separate sentence is no excuse');
  assert.ok(flagged(run('Share your OTP now. Thanks, delivery agent')));
});

test('the thresholds: one strong sign is "suspicious", it takes two signs of weight to say "scam"', () => {
  assert.equal(run('Please share your OTP').level, 'suspicious');
  assert.equal(run('Please share your CVV').level, 'scam', 'a CVV is never to be handed over, so one sign is enough');
  assert.equal(run('Please share your OTP, urgent, account will be blocked').level, 'scam');
  assert.equal(run('urgent').level, 'nothing'); assert.equal(run('your account will be blocked').level, 'nothing');
  assert.equal(M.SCAM_AT > M.SUSPICIOUS_AT, true);
  const edge = run('Please share your OTP, urgent'); assert.equal(edge.score, 4); assert.equal(edge.level, 'suspicious', 'one point short of the scam line is still only "suspicious"');
  assert.equal(run('Please share your OTP, urgent, your account will be blocked').score, 5);
  const busy = run('urgent, immediately, last chance, act now, hurry'); assert.equal(busy.score, 1); assert.equal(busy.level, 'nothing', 'deadline words do not stack into an accusation');
  const claims = run('guaranteed returns, double your money, risk free'); assert.equal(claims.score, 5); assert.equal(claims.level, 'scam', 'separate strong claims of one kind do stack');
});

/* ---------- four more Indian scam families, each with the honest look-alike that must be left alone ---------- */
test('electricity or SIM cut-off pressure, wrong-transfer "return it", sextortion and "scan to receive" are caught', () => {
  const caught = [
    ['utility', 'URGENT: Your electricity connection will be disconnected tonight at 9:30 pm. Call 98XXXXXX01 now to update bill.'],
    ['utility', 'Dear consumer your power supply will be disconnected today. Contact officer on 9876543210 to update your bill'],
    ['misdirected', 'Sir I accidentally sent Rs 5000 to your PhonePe. Please return it, I am in a hospital emergency.'],
    ['misdirected', 'Bhai galti se tumhare account me 5000 chale gaye, wapas bhej do plz'],
    ['misdirected', 'I mistakenly transferred money to your account, kindly return the amount'],
    ['sextortion', 'I have recorded your video. Pay Rs 30,000 or I will send it to all your contacts.'],
    ['sextortion', 'We have your private photos. Send money unless you want us to share them with your family and friends'],
    ['upi', 'You have received Rs 10,000 cashback on PhonePe. Scan this QR to accept the money.'],
    ['upi', 'To receive your refund amount scan the QR code below']
  ];
  for (const [family, text] of caught) { const v = M.analyzeMessage(text); assert.ok(v.level !== 'nothing', text); assert.ok(v.codes.length && v.family === family || v.evidence.some(e => e.family === family), `${family}: ${text}`); }
  assert.equal(M.analyzeMessage('I have recorded your video. Pay Rs 30,000 or I will send it to all your contacts.').level, 'scam', 'sextortion is conclusive on its own');
});

test('the look-alikes stay quiet: a planned power cut, a bill reminder, a friend with your photos, a file sent by mistake, a boarding-pass code, a third party who will return money', () => {
  for (const text of [
    'Planned maintenance: power supply will be disconnected 10am to 2pm tomorrow in your area. Sorry for the inconvenience.',
    'Your electricity bill of Rs 1,450 is due on 12-Oct. Failing which supply will be disconnected. Pay at the official portal or app. Helpline 1912',
    'I have your photos from the wedding, will share with everyone in the family group',
    'I have your video from the trip, I will send it to all the friends who came',
    'I accidentally sent you the file, send it back please',
    'Hi, I accidentally paid the wrong amount in the hotel bill, they will return it by evening',
    'Scan the code at the gate to get your boarding pass',
    'Scan this QR code to download the app and receive updates',
    'Your gas cylinder booking is confirmed. It will be delivered tomorrow. Delivery code 4521.'
  ]) assert.equal(M.analyzeMessage(text).level, 'nothing', text);
});

test('each new rule needs both of its signs: one alone does not fire it', () => {
  const fires = (id, text) => M.analyzeMessage(text).codes.includes(id);
  assert.ok(!fires('sextortion', 'I have recorded your video.')); assert.ok(!fires('sextortion', 'Pay money or I will send it to all your contacts.'));
  assert.ok(fires('sextortion', 'I got your videos, pay up or else I will send them to everyone'));
  assert.ok(!fires('wrong-transfer', 'Please return it.')); assert.ok(!fires('wrong-transfer', 'I accidentally sent Rs 500 to you'));
  assert.ok(!fires('qr-receive', 'Scan the QR code to pay Rs 500.')); assert.ok(fires('qr-receive', 'Scan the QR code to receive your Rs 500 cashback'));
  assert.ok(!fires('utility-cutoff', 'Your electricity will be disconnected for maintenance.')); assert.ok(!fires('utility-cutoff', 'Call 9876543210 about your bill'));
  for (const f of ['sextortion', 'misdirected', 'utility']) assert.ok(M.FAMILIES[f].next.length >= 1);
});
