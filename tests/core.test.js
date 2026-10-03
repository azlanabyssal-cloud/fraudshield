'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../lib/core.js');

test('detectIntent routes real scam phrasing', () => {
  assert.equal(core.detectIntent('someone from CBI said I am under digital arrest'), 'Digital Arrest');
  assert.equal(core.detectIntent('he asked for my OTP'), 'OTP Scam');
  assert.equal(core.detectIntent('scan this QR code to receive money'), 'UPI Fraud');
  assert.equal(core.detectIntent('guaranteed returns on crypto scheme'), 'Investment Scam');
  assert.equal(core.detectIntent('they are threatening to leak my private photo'), 'Sextortion');
});

test('detectIntent does not fire on substrings of ordinary words (regression)', () => {
  assert.equal(core.detectIntent('that was a stupid idea'), null);   // "upi"
  assert.equal(core.detectIntent('I missed my train'), null);        // "trai"
  assert.equal(core.detectIntent('we ate hotpot'), null);            // "otp"
  assert.equal(core.detectIntent('the building was denuded'), null); // "nude"
});

test('invest stem still matches inflections', () => {
  assert.equal(core.detectIntent('I am investing in a new scheme'), 'Investment Scam');
  assert.equal(core.detectIntent('my investment is stuck'), 'Investment Scam');
});

test('isGeneralMoneyLoss', () => {
  assert.equal(core.isGeneralMoneyLoss('my money is gone from bank so how can i get back ?/'), true);
  assert.equal(core.isGeneralMoneyLoss('I got scammed yesterday'), true);
  assert.equal(core.isGeneralMoneyLoss('what is the weather'), false);
});

test('findLinkIn', () => {
  assert.equal(core.findLinkIn('visit https://sbi-kyc.tk/login now'), 'https://sbi-kyc.tk/login');
  assert.equal(core.findLinkIn('go to www.example.com please'), 'www.example.com');
  assert.equal(core.findLinkIn('no link in this sentence'), null);
});

test('checkLink verdicts', () => {
  assert.equal(core.checkLink('https://www.sbi.co.in').verdict, 'safe');
  assert.equal(core.checkLink('https://cybercrime.gov.in/report').verdict, 'safe');
  assert.equal(core.checkLink('sbi-kyc-update.tk').verdict, 'danger');
  assert.equal(core.checkLink('http://192.168.4.20/login').verdict, 'danger');
  assert.equal(core.checkLink('https://hdfc-secure-login.com').verdict, 'danger');
  assert.equal(core.checkLink('https://bit.ly/3abc').verdict, 'caution');
  assert.equal(core.checkLink('https://random-shop.com').verdict, 'caution');
});

test('checkLink does not trust a look-alike that merely ends with a safe domain name', () => {
  assert.notEqual(core.checkLink('https://evilsbi.co.in.attacker.xyz').verdict, 'safe');
  assert.notEqual(core.checkLink('https://notrbi.org.in.example.com').verdict, 'safe');
});

test('extractIntroducedName', () => {
  assert.equal(core.extractIntroducedName('hey i am azlan'), 'Azlan');
  assert.equal(core.extractIntroducedName("I'm Priya"), 'Priya');
  assert.equal(core.extractIntroducedName('i am worried about this call'), null);
  assert.equal(core.extractIntroducedName('nothing here'), null);
});

test('matchSmallTalk', () => {
  assert.ok(core.matchSmallTalk('hello'));
  assert.ok(core.matchSmallTalk('what are the good habits??'));
  assert.equal(core.matchSmallTalk('bye').noMenu, true);
  assert.equal(core.matchSmallTalk('asdkjh qwe'), null);
});

test('inflected forms of stem keywords still match (recall regression from whole-word matching)', () => {
  assert.equal(core.detectIntent('he is blackmailing me'), 'Sextortion');
  assert.equal(core.detectIntent('she was blackmailed'), 'Sextortion');
  assert.equal(core.detectIntent('they sent nudes'), 'Sextortion');
  assert.equal(core.detectIntent('my pics were morphing'), 'Sextortion');
});

test('stems do not over-match unrelated words', () => {
  assert.equal(core.detectIntent('morphine tablets after surgery'), null);
  assert.equal(core.detectIntent('the nudity debate'), null);
});

test('user-hosted Google content is never called safe (forms/sites are the top phishing hosts)', () => {
  for (const u of ['https://docs.google.com/forms/d/e/abc/viewform', 'https://sites.google.com/view/sbi-kyc-update', 'https://drive.google.com/file/d/x']) {
    assert.notEqual(core.checkLink(u).verdict, 'safe', u);
  }
});

test('"@" in the authority part of a URL is danger (userinfo trick)', () => {
  assert.equal(core.checkLink('http://sbi.co.in@evil.com/login').verdict, 'danger');
  assert.equal(core.checkLink('https://www.sbi.co.in').verdict, 'safe');
});

test('no browser file uses regex lookbehind (a SyntaxError on Safari before 16.4 would break the whole page)', () => {
  const fs = require('node:fs'), path = require('node:path'), root = path.join(__dirname, '..');
  const files = ['script.js', 'sw.js', ...fs.readdirSync(path.join(root, 'lib')).filter(f => f.endsWith('.js')).map(f => 'lib/' + f)];
  for (const f of files) {
    const code = fs.readFileSync(path.join(root, f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(code, /\(\?<[!=]/, f + ' uses regex lookbehind');
  }
});
