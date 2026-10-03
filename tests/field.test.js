'use strict';
// Survey rows below are fabricated for testing. Real responses are never committed (field/survey.csv is gitignored).
const test = require('node:test');
const assert = require('node:assert/strict');
const { COLUMNS, QUIZ, validateSurvey } = require('../field/schema.js');
const { analyze, awarenessGain, markdown, cell, MIN_CELL } = require('../field/analyze.js');
const { toCsvLine } = require('../data_ops/holdout.js');

const TODAY = '2026-10-03';
const base = { id: 'S-001', date: '2026-05-03', surveyor: 'AZ', respondent_type: 'shop', area: 'Balaji Nagar', age_band: '30-44', gender: 'm', education: 'secondary', occupation: 'shop',
  language: 'te', phone: 'smartphone', uses_upi: 'y', suspicious_contact: 'y', lost_money: 'n', amount_band: 'none', reported_to: 'na', reported_when: 'na', family_victim: 'n', channel: 'in_person',
  consent_verbal: 'y', talk_given: 'y' };
QUIZ.forEach(q => { base['pre_' + q.id] = '0'; base['post_' + q.id] = '1'; });
const csv = (...rows) => [COLUMNS.join(','), ...rows.map(r => toCsvLine(COLUMNS.map(c => (r[c] === undefined ? '' : r[c]))))].join('\n');
const row = (o = {}, n = 1) => ({ ...base, id: 'S-' + String(n).padStart(3, '0'), ...o });
const check = (...rows) => validateSurvey(csv(...rows), { today: TODAY });

test('a clean row passes and a file with the exact header is required', () => {
  assert.deepEqual(check(row()).errors, []);
  assert.match(validateSurvey('id,date\n', { today: TODAY }).errors[0], /header must be exactly/);
  assert.match(validateSurvey('', { today: TODAY }).errors[0], /empty/);
});

test('privacy by design: no consent, house-number areas, bad dates and free text are all refused', () => {
  assert.match(check(row({ consent_verbal: 'n' })).errors.join(), /without consent must not be recorded/);
  assert.match(check(row({ area: '12-3/4 Balaji Nagar' })).errors.join(), /no house numbers or addresses/);
  assert.match(check(row({ area: '' })).errors.join(), /village or ward/);
  assert.match(check(row({ date: '2026-12-31' })).errors.join(), /not in the future/);
  assert.match(check(row({ date: '2026-02-30' })).errors.join(), /real YYYY-MM-DD/);
  assert.match(check(row({ surveyor: 'Azlan Ahmed' })).errors.join(), /2-4 initials/);
  assert.equal(COLUMNS.some(c => /name|phone_number|address|note|comment/i.test(c) && c !== 'phone'), false, 'the schema collects no names, numbers, addresses or free text');
});

test('answers must come from the allowed lists, ids must be unique, and lost-money answers must be consistent', () => {
  assert.match(check(row({ gender: 'x' })).errors.join(), /gender/);
  assert.match(check(row({ id: 'S-001' }), row({ id: 'S-001' }, 2)).errors.join(), /duplicate id/);
  assert.match(check(row({ id: '7' })).errors.join(), /must look like S-001/);
  assert.match(check(row({ lost_money: 'n', amount_band: '1k_10k' })).errors.join(), /lost_money is n/);
  assert.match(check(row({ lost_money: 'y', amount_band: 'none' })).errors.join(), /lost_money is y/);
  assert.match(check(row({ lost_money: 'y', amount_band: '1k_10k', reported_to: 'none', reported_when: 'later' })).errors.join(), /reported_to is none/);
  assert.deepEqual(check(row({ lost_money: 'y', amount_band: '1k_10k', reported_to: '1930', reported_when: 'same_day' })).errors, []);
});

test('before/after answers: post answers exist only for people who attended the talk', () => {
  assert.match(check(row({ talk_given: 'n' })).errors.join(), /empty when no talk was given/);
  assert.deepEqual(check(row({ talk_given: 'n', post_q1: '', post_q2: '', post_q3: '', post_q4: '', post_q5: '' })).errors, []);
  assert.match(check(row({ pre_q1: '2' })).errors.join(), /pre_q1 must be 0 or 1/);
});

test('awareness gain: exact McNemar on paired answers, hand-worked', () => {
  // 20 attendees; q1: 12 wrong->right, 0 right->wrong, 8 unchanged. p = 2 * 0.5^12
  const rows = [];
  for (let i = 0; i < 20; i++) { const r = row({}, i + 1); QUIZ.forEach(q => { r['pre_' + q.id] = '1'; r['post_' + q.id] = '1'; }); if (i < 12) r.pre_q1 = '0'; rows.push(r); }
  const { errors, rows: parsed } = check(...rows); assert.deepEqual(errors, []);
  const g = awarenessGain(parsed), q1 = g.perQuestion[0];
  assert.equal(g.attended, 20); assert.deepEqual([q1.improved, q1.worsened], [12, 0]); assert.ok(Math.abs(q1.p - 2 * Math.pow(0.5, 12)) < 1e-12);
  assert.equal(g.perQuestion[1].improved, 0); assert.equal(g.perQuestion[1].p, 1);   // no change: nothing to test
  assert.ok(Math.abs(g.meanPre - (5 - 12 / 20)) < 1e-12); assert.equal(g.meanPost, 5);
  assert.equal(awarenessGain(parsed.map(r => ({ ...r, talk_given: 'n' }))).attended, 0);
});

test('shares carry a Wilson interval and small cells are hidden', () => {
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(row({ suspicious_contact: i < 30 ? 'y' : 'n' }, i + 1));
  const a = analyze(check(...rows).rows);
  assert.equal(a.n, 40); assert.equal(a.suspiciousContact.k, 30); assert.ok(a.suspiciousContact.lo < 0.75 && a.suspiciousContact.hi > 0.75);
  assert.equal(cell(0), '0'); assert.equal(cell(MIN_CELL - 1), `<${MIN_CELL}`); assert.equal(cell(MIN_CELL), String(MIN_CELL));
  const few = analyze(check(row({ lost_money: 'y', amount_band: '1k_10k', reported_to: '1930', reported_when: 'same_day' }), row({}, 2), row({}, 3)).rows);
  const md = markdown(few);
  assert.match(md, /convenience sample/); assert.ok(!/\b1 who lost money\b/.test(md), 'a count of 1 must not be printed');
  assert.match(md, /<5/);
});

test('the report text names its own limits and prints no raw respondent data', () => {
  const rows = []; for (let i = 0; i < 12; i++) rows.push(row({ area: 'Ambedkar Nagar' }, i + 1));
  const md = markdown(analyze(check(...rows).rows));
  assert.match(md, /not a random sample of the village/); assert.ok(!/Ambedkar|S-0\d\d/.test(md), 'no area or id in the report');
});
