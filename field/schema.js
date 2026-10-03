'use strict';
/* Survey schema and validation for the village fraud-awareness survey (APSCHE Community Service Project: structured
   questionnaire, baseline assessment, awareness programme outcomes). Pure functions: no file access.
   Privacy by design: no names, no phone numbers, no street addresses, no free text. Area is village or ward level only. */
const { parseCsv } = require('../data_ops/holdout.js');

const ENUMS = {
  respondent_type: ['household', 'shop'],
  age_band: ['18-29', '30-44', '45-59', '60+'],
  gender: ['f', 'm', 'o', 'na'],
  education: ['none', 'primary', 'secondary', 'degree'],
  occupation: ['farm', 'labour', 'shop', 'salaried', 'student', 'homemaker', 'retired', 'other'],
  language: ['te', 'en', 'hi', 'ur', 'other'],
  phone: ['smartphone', 'keypad', 'none'],
  yn: ['y', 'n'],
  amount_band: ['none', 'under_1k', '1k_10k', '10k_1l', 'over_1l'],
  reported_to: ['na', 'none', 'bank', '1930', 'police', 'portal', 'multiple'],
  reported_when: ['na', 'same_day', 'within_3_days', 'later', 'never'],
  channel: ['voice_note', 'in_person', 'poster', 'video', 'school', 'other']
};

const QUIZ = [   // each statement and its correct answer; stored per respondent as 1 (answered correctly) or 0
  { id: 'q1', en: 'A bank or the RBI will never ask you for your OTP.', correct: 'true' },
  { id: 'q2', en: 'To receive money by UPI you must scan a QR code or enter your UPI PIN.', correct: 'false' },
  { id: 'q3', en: 'A police or CBI officer can arrest you over a video call.', correct: 'false' },
  { id: 'q4', en: 'The helpline 1930 is free and works day and night.', correct: 'true' },
  { id: 'q5', en: 'Some investments can safely promise a fixed high return every month.', correct: 'false' }
];

const COLUMNS = ['id', 'date', 'surveyor', 'respondent_type', 'area', 'age_band', 'gender', 'education', 'occupation', 'language', 'phone',
  'uses_upi', 'suspicious_contact', 'lost_money', 'amount_band', 'reported_to', 'reported_when', 'family_victim', 'channel',
  'consent_verbal', 'talk_given', ...QUIZ.map(q => 'pre_' + q.id), ...QUIZ.map(q => 'post_' + q.id)];

const ENUM_BY_COLUMN = { respondent_type: 'respondent_type', age_band: 'age_band', gender: 'gender', education: 'education', occupation: 'occupation',
  language: 'language', phone: 'phone', uses_upi: 'yn', suspicious_contact: 'yn', lost_money: 'yn', amount_band: 'amount_band', reported_to: 'reported_to',
  reported_when: 'reported_when', family_victim: 'yn', channel: 'channel', consent_verbal: 'yn', talk_given: 'yn' };

function isRealDate(s, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && s <= today;
}

// Returns { errors, rows } where rows are objects keyed by column. Never throws on bad data.
function validateSurvey(csvText, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const errors = [];
  let table;
  try { table = parseCsv(csvText); } catch (e) { return { errors: [e.message], rows: [] }; }
  if (!table.length) return { errors: ['file is empty'], rows: [] };
  if (table[0].length !== COLUMNS.length || table[0].some((h, i) => h !== COLUMNS[i])) return { errors: [`header must be exactly: ${COLUMNS.join(',')}`], rows: [] };
  const rows = [], ids = new Set();
  table.slice(1).forEach((r, i) => {
    const line = i + 2, err = m => errors.push(`line ${line}: ${m}`);
    if (r.length !== COLUMNS.length) return err(`expected ${COLUMNS.length} columns, found ${r.length}`);
    const o = Object.fromEntries(COLUMNS.map((c, k) => [c, r[k].trim()]));
    if (!/^S-\d{3,}$/.test(o.id)) err(`id "${o.id}" must look like S-001`); else if (ids.has(o.id)) err(`duplicate id ${o.id}`); else ids.add(o.id);
    if (!isRealDate(o.date, today)) err(`date "${o.date}" must be a real YYYY-MM-DD date, not in the future`);
    if (!/^[A-Za-z]{2,4}$/.test(o.surveyor)) err('surveyor must be 2-4 initials');
    if (!/^[A-Za-z][A-Za-z .-]{1,38}$/.test(o.area)) err(`area "${o.area}" must be a village or ward name (letters only, no numbers: no house numbers or addresses)`);
    for (const [col, en] of Object.entries(ENUM_BY_COLUMN)) if (!ENUMS[en].includes(o[col])) err(`${col} "${o[col]}" must be one of ${ENUMS[en].join('/')}`);
    if (o.consent_verbal !== 'y') err('consent_verbal must be "y": a response without consent must not be recorded');
    for (const q of QUIZ) {
      const pre = o['pre_' + q.id], post = o['post_' + q.id];
      if (!['0', '1'].includes(pre)) err(`pre_${q.id} must be 0 or 1`);
      if (o.talk_given === 'y' ? !['0', '1'].includes(post) : post !== '') err(`post_${q.id} must be ${o.talk_given === 'y' ? '0 or 1' : 'empty when no talk was given'}`);
    }
    if (o.lost_money === 'n' && (o.amount_band !== 'none' || o.reported_to !== 'na' || o.reported_when !== 'na')) err('lost_money is n, so amount_band must be none and reported_to / reported_when must be na');
    if (o.lost_money === 'y' && (o.amount_band === 'none' || o.reported_to === 'na' || o.reported_when === 'na')) err('lost_money is y, so amount_band, reported_to and reported_when must be filled');
    if (o.reported_to === 'none' && !['never'].includes(o.reported_when)) err('reported_to is none, so reported_when must be never');
    rows.push(o);
  });
  return { errors, rows };
}

module.exports = { ENUMS, QUIZ, COLUMNS, validateSurvey, isRealDate };
