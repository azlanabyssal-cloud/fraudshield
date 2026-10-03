'use strict';
/* Turns validated survey rows into the tables a CSP report needs. Pure functions; the CLI at the bottom does the I/O.
   Every proportion carries a 95% Wilson interval, awareness gain is tested with exact McNemar on paired answers, and
   small cells are suppressed (a count under 5 identifies people in a village).
   This is a convenience sample of the people who answered the door: it describes them, not the whole village. */
const { wilson, mcnemarExact } = require('../mlops/metrics.js');
const { QUIZ } = require('./schema.js');

const MIN_CELL = 5;
const pct = c => c.n === 0 ? 'n/a' : `${(100 * c.value).toFixed(0)}% (${(100 * c.lo).toFixed(0)}-${(100 * c.hi).toFixed(0)})`;
const cell = n => (n > 0 && n < MIN_CELL ? `<${MIN_CELL}` : String(n));
const share = (rows, pred) => wilson(rows.filter(pred).length, rows.length);

function distribution(rows, col) {
  const out = {};
  rows.forEach(r => { out[r[col]] = (out[r[col]] || 0) + 1; });
  return out;
}

// Paired before/after answers for people who attended a talk. b = wrong then right, c = right then wrong.
function awarenessGain(rows) {
  const talk = rows.filter(r => r.talk_given === 'y');
  const perQuestion = QUIZ.map(q => {
    let b = 0, c = 0, preRight = 0, postRight = 0;
    talk.forEach(r => {
      const pre = r['pre_' + q.id] === '1', post = r['post_' + q.id] === '1';
      if (pre) preRight++; if (post) postRight++;
      if (!pre && post) b++; else if (pre && !post) c++;
    });
    return { id: q.id, statement: q.en, n: talk.length, pre: wilson(preRight, talk.length), post: wilson(postRight, talk.length), improved: b, worsened: c, p: mcnemarExact(b, c) };
  });
  const score = (r, p) => QUIZ.reduce((s, q) => s + Number(r[p + q.id]), 0);
  const mean = (p) => (talk.length ? talk.reduce((s, r) => s + score(r, p), 0) / talk.length : null);
  return { attended: talk.length, meanPre: mean('pre_'), meanPost: mean('post_'), perQuestion };
}

function analyze(rows) {
  const n = rows.length;
  const lost = rows.filter(r => r.lost_money === 'y');
  return {
    n,
    respondentType: distribution(rows, 'respondent_type'),
    language: distribution(rows, 'language'),
    smartphone: share(rows, r => r.phone === 'smartphone'),
    usesUpi: share(rows, r => r.uses_upi === 'y'),
    suspiciousContact: share(rows, r => r.suspicious_contact === 'y'),
    lostMoney: share(rows, r => r.lost_money === 'y'),
    familyVictim: share(rows, r => r.family_victim === 'y'),
    amongLost: { n: lost.length, amount: distribution(lost, 'amount_band'), reportedWhen: distribution(lost, 'reported_when'), reportedTo: distribution(lost, 'reported_to') },
    knowsHelplineBefore: share(rows, r => r.pre_q4 === '1'),
    meanScoreBefore: n ? rows.reduce((s, r) => s + QUIZ.reduce((a, q) => a + Number(r['pre_' + q.id]), 0), 0) / n : null,
    gain: awarenessGain(rows),
    preferredChannel: distribution(rows, 'channel')
  };
}

function markdown(a) {
  const dist = o => Object.entries(o).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${cell(v)}`).join(', ') || 'none';
  const L = [];
  L.push(`**Respondents:** ${a.n} (${dist(a.respondentType)}). Languages: ${dist(a.language)}.`);
  L.push('', '| Measure | Share (95% interval) |', '|---|---|',
    `| Has a smartphone | ${pct(a.smartphone)} |`, `| Uses UPI | ${pct(a.usesUpi)} |`, `| Received a suspicious call or message | ${pct(a.suspiciousContact)} |`,
    `| Lost money to fraud | ${pct(a.lostMoney)} |`, `| A family member lost money | ${pct(a.familyVictim)} |`, `| Knew 1930 is free and 24x7, before the talk | ${pct(a.knowsHelplineBefore)} |`);
  if (a.amongLost.n) L.push('', `Among the ${cell(a.amongLost.n)} who lost money: amount ${dist(a.amongLost.amount)}; reported to ${dist(a.amongLost.reportedTo)}; reported ${dist(a.amongLost.reportedWhen)}.`);
  const g = a.gain;
  if (g.attended) {
    L.push('', `**Awareness talk, ${g.attended} attendees answered the same 5 statements before and after** (mean score ${g.meanPre.toFixed(2)} to ${g.meanPost.toFixed(2)} out of ${QUIZ.length}).`,
      '', '| Statement | Right before | Right after | Learned | Slipped | Exact McNemar p |', '|---|---|---|---|---|---|');
    g.perQuestion.forEach(q => L.push(`| ${q.statement} | ${pct(q.pre)} | ${pct(q.post)} | ${q.improved} | ${q.worsened} | ${q.p.toFixed(4)} |`));
  }
  L.push('', `Counts under ${MIN_CELL} are hidden to protect respondents. This is a convenience sample of people who were home or in the shop, not a random sample of the village; the intervals show sampling noise only, not that bias.`);
  return L.join('\n');
}

module.exports = { analyze, awarenessGain, markdown, MIN_CELL, cell };

if (require.main === module) {
  const fs = require('node:fs');
  const { validateSurvey } = require('./schema.js');
  const file = process.argv[2] || process.env.FS_SURVEY || require('node:path').join(__dirname, 'survey.csv');
  if (!fs.existsSync(file)) { console.error(`no survey file at ${file}`); process.exit(1); }
  const { errors, rows } = validateSurvey(fs.readFileSync(file, 'utf8'));
  if (errors.length) { errors.slice(0, 30).forEach(e => console.error('error: ' + e)); console.error(`FAILED: ${errors.length} problem(s); fix them before analysing`); process.exit(1); }
  console.log(markdown(analyze(rows)));
}
