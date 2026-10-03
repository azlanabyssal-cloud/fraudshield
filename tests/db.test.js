'use strict';
// Real PostgreSQL (PGlite = Postgres 18 compiled to WASM): constraints, Row-Level Security, kappa.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const h = require('../data_ops/holdout.js');

const SCHEMA = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');

async function fresh() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(`insert into annotators values ('azlan','labeler'), ('friend','labeler'), ('lead','adjudicator')`);
  return db;
}
const asRole = async (db, role, who) => {
  await db.exec('reset role');
  await db.query("select set_config('app.who', $1, false)", [who || '']);
  await db.exec(`set role ${role}`);
};
const WORDS = ['apple', 'bridge', 'candle', 'dragon', 'engine', 'forest', 'garden', 'harbor', 'island', 'jungle', 'kettle', 'lantern'];
async function addMessage(db, i, over = {}) {
  const m = { id: 'M' + i, text: `fixture sentence about ${WORDS[i % WORDS.length]} ${WORDS[(i * 7 + 3) % WORDS.length]} only`,
    lang: 'en', src: 'sms', date: '2026-09-01', obf: false, by: 'azlan', ...over };
  await db.query(
    `insert into messages (id, raw_text_scrubbed, language_tag, source_platform, date_received, contains_obfuscation, created_by)
     values ($1,$2,$3,$4,$5,$6,$7)`, [m.id, m.text, m.lang, m.src, m.date, m.obf, m.by]);
  return m.id;
}
const label = (db, id, who, scam, cat) =>
  db.query('insert into labels (message_id, annotator_id, is_scam, attack_category) values ($1,$2,$3,$4)', [id, who, scam, cat]);

test('PII check: SQL and JavaScript implementations agree on one corpus (they must never drift)', async () => {
  const db = await fresh();
  const corpus = [
    'call 9876543210 now', 'call +91 98765 43210', 'call 98765-43210 now', 'call 98765 43210', 'call 0987 654 3210',
    'acct 123456789012', 'aadhaar 1234 5678 9012', 'ref 12 34 56 78 only',
    'pay to scammer@ybl', 'pay x@okicici now', 'mail me a.b@gmail.com', 'dm @someone', 'user99@newbank', 'pay john.doe@somebank',
    'your kyc p@nding, upd@te now', 'my PAN ABCDE1234F', 'my PAN abcde1234f',
    'Call [PHONE] or pay [UPI]. Rs 1,00,000 debited on 12/10/2025. Use code [OTP]. Dial 1930.',
    'call [PHONNE] now', 'code [OTP] valid for 10 minutes', 'आपका खाता बंद हो जाएगा 1930 पर कॉल करें',
    'Rs500 only', 'OTP123456 received', 'win Rs 25 lakh send fee', 'a@b', '@', 'x@'
  ];
  const disagreements = [];
  for (const t of corpus) {
    const sqlClean = (await db.query('select cardinality(pii_check($1)) = 0 as ok', [t])).rows[0].ok;
    const jsClean = h.findPii(t).length === 0;
    if (sqlClean !== jsClean) disagreements.push(`${JSON.stringify(t)} sql=${sqlClean} js=${jsClean}`);
  }
  assert.deepEqual(disagreements, []);
});

test('the UPI suffix list in SQL equals the one in JavaScript', () => {
  const sql = SCHEMA.split('suffixes text[] := array[')[1].split(']')[0];
  const sqlSet = new Set([...sql.matchAll(/'([a-z]+)'/g)].map(m => m[1]));
  assert.deepEqual([...sqlSet].sort(), [...h.UPI_SUFFIXES].sort());
});

test('the dedup normaliser in SQL equals the one in JavaScript', async () => {
  const db = await fresh();
  for (const t of ['Your A/C 12 is BLOCKED  today [PHONE]', 'win\tRs  500 [UPI]  now', 'आपका खाता 1930', '  spaced   out  1 2 3 ']) {
    const sql = (await db.query('select normalize_for_dedup($1) as n', [t])).rows[0].n;
    assert.equal(sql, h.normalizeForDedup(t), JSON.stringify(t));
  }
});

test('constraints reject personal data, bad values, near-duplicates and inconsistent labels', async () => {
  const db = await fresh();
  await addMessage(db, 1);
  await assert.rejects(addMessage(db, 2, { text: 'call 9876543210 right now please' }), /messages_no_pii/);
  // obf:true isolates the PII rule (otherwise the '@' obfuscation rule also fires, and Postgres reports it first)
  await assert.rejects(addMessage(db, 3, { text: 'pay to scammer@ybl right now please', obf: true }), /messages_no_pii/);
  await assert.rejects(addMessage(db, 4, { lang: 'te' }), /language_tag/);
  await assert.rejects(addMessage(db, 5, { date: '2999-01-01' }), /date_received/);
  await assert.rejects(addMessage(db, 6, { text: 'short' }), /raw_text_scrubbed/);
  await assert.rejects(addMessage(db, 7, { text: 'your kyc p@nding update now', obf: false }), /messages_at_needs_obfuscation/);
  await addMessage(db, 8, { text: 'your kyc p@nding update now', obf: true });
  await assert.rejects(addMessage(db, 9, { text: `fixture  sentence about ${WORDS[1]} ${WORDS[10]} only`.replace(/\d/g, '') }), /messages_dedup|duplicate/);
  await assert.rejects(label(db, 'M1', 'azlan', true, 'safe'), /check/);
  await assert.rejects(label(db, 'M1', 'azlan', false, 'upi_collect'), /check/);
});

test('blind labeling: a labeler can neither see nor forge another annotator\'s labels', async () => {
  const db = await fresh();
  const id = await addMessage(db, 1);
  await asRole(db, 'labeler', 'azlan');
  await label(db, id, 'azlan', true, 'upi_collect');
  assert.equal((await db.query('select * from labels')).rows.length, 1);

  await asRole(db, 'labeler', 'friend');
  assert.equal((await db.query('select * from labels')).rows.length, 0, 'friend must not see azlan\'s label');
  await assert.rejects(label(db, id, 'azlan', false, 'safe'), /row-level security/);   // cannot forge someone else's
  await label(db, id, 'friend', false, 'safe');                                         // can add their own
  assert.equal((await db.query('select * from labels')).rows.length, 1);
  await assert.rejects(db.query("update labels set is_scam = true where annotator_id = 'friend'"), /permission denied/);
  await assert.rejects(db.query('delete from labels'), /permission denied/);

  await asRole(db, 'adjudicator', 'lead');
  assert.equal((await db.query('select * from labels')).rows.length, 2, 'adjudicator sees both');
});

test('a labeler cannot read adjudications, splits, or the final labels', async () => {
  const db = await fresh();
  const id = await addMessage(db, 1);
  await db.exec('reset role');
  await label(db, id, 'azlan', true, 'job_fraud'); await label(db, id, 'friend', true, 'job_fraud');
  await db.exec(`insert into splits values ('M1','s0')`);
  await asRole(db, 'labeler', 'azlan');
  await assert.rejects(db.query('select * from splits'), /permission denied/);
  await assert.rejects(db.query('select * from adjudications'), /permission denied/);
  await assert.rejects(db.query('select * from final_labels'), /permission denied/);
  await assert.rejects(db.query('select * from needs_adjudication'), /permission denied/);
});

test('Cohen\'s kappa matches a hand-computed value (po=0.8, pe=0.5, kappa=0.6)', async () => {
  const db = await fresh();
  const a = [1, 1, 1, 1, 0, 0, 0, 0, 1, 0];
  const b = [1, 1, 1, 0, 0, 0, 0, 1, 1, 0];
  for (let i = 0; i < 10; i++) {
    const id = await addMessage(db, i + 20);
    await label(db, id, 'azlan', !!a[i], a[i] ? 'other_scam' : 'safe');
    await label(db, id, 'friend', !!b[i], b[i] ? 'other_scam' : 'safe');
  }
  await asRole(db, 'adjudicator', 'lead');
  const k = Number((await db.query("select cohen_kappa('azlan','friend') as k")).rows[0].k);
  assert.ok(Math.abs(k - 0.6) < 1e-9, `kappa was ${k}`);
  await asRole(db, 'labeler', 'azlan');
  assert.equal((await db.query("select cohen_kappa('azlan','friend') as k")).rows[0].k, null, 'blind: a labeler gets no agreement figure');
});

test('final labels: unanimous counts, disagreement waits for adjudication, adjudication overrides', async () => {
  const db = await fresh();
  const [x, y, z] = [await addMessage(db, 1), await addMessage(db, 2), await addMessage(db, 3)];
  await label(db, x, 'azlan', true, 'digital_arrest'); await label(db, x, 'friend', true, 'digital_arrest');
  await label(db, y, 'azlan', true, 'digital_arrest'); await label(db, y, 'friend', true, 'kyc_pan_block');
  await label(db, z, 'azlan', true, 'loan_app');       // only one labeler so far
  const status = async () => Object.fromEntries((await db.query('select id, status from final_labels order by id')).rows.map(r => [r.id, r.status]));
  assert.deepEqual(await status(), { M1: 'unanimous', M2: 'pending', M3: 'pending' });
  assert.deepEqual((await db.query('select message_id from needs_adjudication')).rows, [{ message_id: 'M2' }]);
  await db.exec(`insert into adjudications values ('M2','lead',true,'kyc_pan_block','claimed account block, asked for PAN via link', now())`);
  assert.deepEqual(await status(), { M1: 'unanimous', M2: 'adjudicated', M3: 'pending' });
  assert.equal((await db.query('select count(*)::int c from needs_adjudication')).rows[0].c, 0);
});

test('exported rows pass the JavaScript CSV validator (database and tooling agree)', async () => {
  const db = await fresh();
  for (let i = 0; i < 4; i++) {
    const id = await addMessage(db, 40 + i, { lang: ['en', 'hi', 'hinglish', 'en'][i], text: `unique fixture ${WORDS[i]} regarding ${WORDS[i + 4]} matters` });
    const scam = i % 2 === 0;
    await label(db, id, 'azlan', scam, scam ? 'job_fraud' : 'safe'); await label(db, id, 'friend', scam, scam ? 'job_fraud' : 'safe');
    await db.query("insert into splits values ($1,'s0')", [id]);
  }
  const rows = (await db.query('select * from export_rows($1)', ['s0'])).rows;
  assert.equal(rows.length, 4);
  const csv = [h.COLUMNS.join(','), ...rows.map(r => h.toCsvLine(h.COLUMNS.map(c => r[c])))].join('\n');
  const result = h.validateRows(h.parseCsv(csv), { today: '2026-10-03' });
  assert.deepEqual(result.errors, []);
});
