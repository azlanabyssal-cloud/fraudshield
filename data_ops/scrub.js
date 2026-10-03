'use strict';
/* Offline scrubber for the golden holdout. Pure functions: no file, network or process access.
   It replaces personal tokens with the placeholders the SOP allows and changes nothing else
   (typos, obfuscation, URLs, amounts, emoji, Devanagari and spacing are preserved byte for byte).
   Names and addresses cannot be found reliably, so they are masked only when the labeler types them (maskTerms).
   Digit-run and UPI/email logic mirrors findPii on purpose, so nothing the validator rejects slips through. */
const { UPI_SUFFIXES, findPii } = require('./holdout.js');

const DIGIT_RUN = /\+?\d(?:[ -]?\d){8,}/g;   // same shape as findPii's 9+ digit rule, plus a leading +

function classifyDigits(raw) {
  const plus = raw.startsWith('+'), d = raw.replace(/\D/g, ''), n = d.length;
  const mobile = s => s.length === 10 && /^[6-9]/.test(s);
  if (plus && n >= 10 && n <= 14) return 'PHONE';
  if (mobile(d)) return 'PHONE';
  if (n === 12 && d.startsWith('91') && mobile(d.slice(2))) return 'PHONE';
  if (d.startsWith('0') && n >= 10 && n <= 13) return 'PHONE';              // 0 + mobile, or an STD landline
  if (/^1(800|860)/.test(d) && n >= 10 && n <= 11) return 'PHONE';          // toll-free
  if (n === 12) return 'ID_NUMBER';                                          // Aadhaar-shaped
  if (n === 15 || n === 16) return 'CARD';
  return 'ACCOUNT';
}

function scrub(input) {
  const replaced = {};
  const note = k => { replaced[k] = (replaced[k] || 0) + 1; return `[${k}]`; };
  let t = input;

  // 1. one-time codes: only digits that directly follow the code word ("OTP is 482913"), never "OTP expires in 10 minutes"
  t = t.replace(/\b(otp|one[- ]time[- ](?:password|passcode|code)|verification code|cvv)(\s*(?:is|number|no\.?|code)?\s*[:=-]?\s*)(\d{3,8})\b/gi,
    (_, word, gap) => word + gap + note('OTP'));

  // 2a. handles are taken whole: the validator stops at "_", but "[HANDLE]_63" would still leak part of the name
  t = t.replace(/(^|[^A-Za-z0-9._-])@([A-Za-z0-9._]+)/g, (_, pre, h) => pre + note('HANDLE') + (h.match(/\.+$/)?.[0] || ''));

  // 2b. UPI IDs and emails (same decision rules as findPii)
  t = t.replace(/([A-Za-z0-9._-]*)@([A-Za-z0-9.-]*)/g, (whole, left, right, idx, str) => {
    const tail = right.match(/[.-]+$/)?.[0] || '', core = tail ? right.slice(0, -tail.length) : right;
    const startsWord = idx === 0 || /[^A-Za-z0-9._-]/.test(str[idx - 1]);
    if (left === '' && startsWord && right !== '') return note('HANDLE') + tail;
    if (left !== '' && (UPI_SUFFIXES.has(core.toLowerCase()) || /[\d._-]/.test(left) || core.includes('.'))) return note(core.includes('.') ? 'EMAIL' : 'UPI') + tail;
    return whole;   // "p@nding" style obfuscation is signal and stays
  });

  // 3. PAN, and masked partial account numbers (a visible suffix still identifies the account)
  t = t.replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, () => note('PAN'));
  t = t.replace(/(?:[Xx*•]{2,}[ -]?)+\d{2,6}\b/g, () => note('ACCOUNT'));

  // 4. any run of 9+ digits, classified as phone / Aadhaar-shaped id / card / account (a best guess; the human reviews)
  t = t.replace(DIGIT_RUN, raw => note(classifyDigits(raw)));

  return { text: t, replaced, residual: findPii(t) };
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Masks terms the labeler typed (names, street addresses). Case-insensitive, anywhere in the text.
function maskTerms(text, terms, placeholder) {
  if (!['NAME', 'ADDRESS'].includes(placeholder)) throw new RangeError('placeholder must be NAME or ADDRESS');
  let count = 0, t = text;
  for (const term of terms.map(x => x.trim()).filter(Boolean)) {
    if (term.length < 2) throw new RangeError(`term "${term}" is too short to mask safely`);
    t = t.replace(new RegExp(escapeRe(term), 'gi'), () => { count++; return `[${placeholder}]`; });
  }
  return { text: t, count };
}

// Suggestions only: the labeler decides.
function suggestLanguage(text) {
  const letters = text.match(/\p{L}/gu) || [];
  const deva = letters.filter(c => /\p{Script=Devanagari}/u.test(c));   // letters only: vowel marks would inflate the share
  if (letters.length && deva.length / letters.length > 0.3) return 'hi';
  if (deva.length) return 'hinglish';
  const romanHindi = /\b(aap|aapka|aapki|apna|apni|kripya|turant|jaldi|paise|paisa|khata|band|hai|hain|karo|kare|bhejein|dhanyawad|namaste|ji)\b/gi;
  return (text.match(romanHindi) || []).length >= 2 ? 'hinglish' : 'en';
}

function suggestObfuscation(text) {
  return /[A-Za-z][@$][A-Za-z]/.test(text) || /[\u200b-\u200d\ufeff]/.test(text) || /\b(?:[A-Za-z][ .\-_]){2,}[A-Za-z]\b/.test(text)
    || (/[A-Za-z]/.test(text) && /[Ѐ-ӿͰ-Ͽ]/.test(text));
}

module.exports = { scrub, maskTerms, suggestLanguage, suggestObfuscation, classifyDigits };
