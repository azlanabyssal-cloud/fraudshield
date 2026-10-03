'use strict';
// Guards the claims register (docs/CLAIMS.md): removed claims must not return, and legal
// sections may only be cited if they are listed as verified.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const shipped = ['index.html', 'tips.html', 'data.html', 'report.html', 'assistant.html', 'script.js', 'lib/core.js'];

const REMOVED = [
  [/zero liability process/i, 'RBI zero liability is not general (C-01)'],
  [/27 October 2023|October 27, 2023/, 'Mann Ki Baat was 27 October 2024 (C-02)'],
  [/above 12%|more than about 12%|returns above 12/i, 'invented 12% investment threshold'],
  [/below ten percent|sixty minutes maximum/i, 'unsourced recovery statistic'],
  [/only within the first hour/i, 'unsourced absolute time limit'],
  [/IT Act Section 66E/i, '66E confidentiality claim is unsupported (C-12)'],
  [/Sections? 294(\/| and )77/i, '294/77 deepfake mapping is unsupported (C-12)'],
  [/Sections 336\/338/i, '336/338 forgery mapping is unverified (C-12)'],
  [/is prosecuted as|are prosecuted (as|under)/i, 'charges are decided by police and courts'],
  [/Doordarshan National/i, 'fabricated broadcast credit'],
  [/in January 2026 alone/i, 'the CFCFRMS figure is cumulative (C-08)'],
  [/industry-funded|automatic payouts/i, 'unsourced description of the RBI compensation scheme (C-06)'],
  [/MuleHunter\.AI<\/h3>\s*<p class="cm-card__stat">₹9,518/, 'the 9,518 Cr figure belongs to Suspect Registry + MuleHunter together (C-15)'],
  [/completely confidential|100% confid|guarantee[sd]? complete|cannot reveal your identity|under any circumstance|guaranteed by law/i, 'absolute legal/confidentiality promise we cannot make (C-13)']
];

test('removed claims do not return', () => {
  for (const f of shipped) {
    const text = read(f);
    for (const [re, why] of REMOVED) assert.doesNotMatch(text, re, `${f}: ${why}`);
  }
});

test('BNS sections in user-facing text are only those verified in the register', () => {
  const verified = new Set(['111', '308', '318', '319']);
  for (const f of shipped) {
    for (const m of read(f).matchAll(/BNS Sections? (\d+)/g)) {
      assert.ok(verified.has(m[1]), `${f} cites BNS Section ${m[1]}, which is not verified in docs/CLAIMS.md`);
    }
  }
});

test('the register lists its verified section numbers and the pending RBI amendment', () => {
  const reg = read('docs/CLAIMS.md');
  for (const n of ['318', '319', '308', '111']) assert.match(reg, new RegExp(n));
  assert.match(reg, /C-06/);
  assert.match(reg, /Removed \(were shipped/);
});
