'use strict';
/* Guided, offline way to add one real message to the golden holdout.
   Usage: node data_ops/add_message.js [--file <csv>]      (or FS_GOLDEN; default data_ops/golden_holdout.csv)
   Nothing leaves this machine, the original text is never printed again or stored, and only the scrubbed row is written. */
const fs = require('node:fs'), path = require('node:path'), readline = require('node:readline');
const { COLUMNS, SCAM_CATEGORIES, SOURCES, LANGUAGES, toCsvLine, findPii } = require('./holdout.js');
const { scrub, maskTerms, suggestLanguage, suggestObfuscation } = require('./scrub.js');
const { buildRow } = require('./row_builder.js');

const args = process.argv.slice(2), fi = args.indexOf('--file');
const FILE = fi >= 0 ? args[fi + 1] : (process.env.FS_GOLDEN || path.join(__dirname, 'golden_holdout.csv'));
const out = s => process.stdout.write(s + '\n');
const fail = msg => { console.error('ABORTED: ' + msg); process.exit(1); };

const rl = readline.createInterface({ input: process.stdin }), lines = rl[Symbol.asyncIterator]();
async function next() { const r = await lines.next(); if (r.done) fail('input ended before the message was complete; nothing was written'); return r.value; }
async function ask(q, dflt) { process.stdout.write(`${q}${dflt !== undefined ? ` [${dflt}]` : ''}: `); const a = (await next()).trim(); return a === '' && dflt !== undefined ? String(dflt) : a; }
async function choose(q, options, dflt) {
  for (;;) { const a = await ask(`${q} (${options.join('/')})`, dflt); if (options.includes(a)) return a; out(`  please type one of: ${options.join(', ')}`); }
}

(async () => {
  out('Offline. Nothing leaves this machine. Add REAL messages only: never write, paraphrase or tidy one.');
  process.stdout.write('Paste the message, then press Enter on an empty line:\n');
  const raw = []; for (;;) { const l = await next(); if (l === '') break; raw.push(l); }
  if (!raw.length) fail('no message entered');

  const scrubbed = scrub(raw.join('\n'));
  let text = scrubbed.text;
  const replaced = scrubbed.replaced;
  const names = (await ask('Names still in the text? Type each exactly as written, comma-separated (blank = none)', '')).split(',');
  const addrs = (await ask('Street/flat/pincode that identifies a home? Same way (blank = none)', '')).split(',');
  const n1 = maskTerms(text, names, 'NAME'); const n2 = maskTerms(n1.text, addrs, 'ADDRESS');
  text = n2.text; if (n1.count) replaced.NAME = n1.count; if (n2.count) replaced.ADDRESS = n2.count;

  out('\nMasked: ' + (Object.entries(replaced).map(([k, v]) => `${v} x [${k}]`).join(', ') || 'nothing'));
  out('Scrubbed text, exactly as it will be stored:\n---\n' + text + '\n---');
  const residual = findPii(text);
  if (residual.length) { residual.forEach(r => console.error('  still unsafe: ' + r)); fail('personal data may remain; nothing was written'); }
  if (/https?:\/\/\S*\?/.test(text) || /\bwww\.\S*\?/.test(text)) out('WARNING: a URL has a query string. Replace any personal token in it by hand with [ID_NUMBER] before continuing (Ctrl+C to stop).');
  out('You are the last line of defence: names, addresses and anything identifying must be gone.');
  if ((await choose('Is the original a real message you received, or a public advisory quote?', ['y', 'n'], 'y')) !== 'y') fail('only real messages belong in the dataset; nothing was written');

  const language = await choose('Language', LANGUAGES, suggestLanguage(text));
  const isScam = (await choose('Is the sender trying to deceive for money, credentials or data?', ['y', 'n'])) === 'y';
  const category = isScam ? await choose('Category', SCAM_CATEGORIES) : 'safe';
  const source = await choose('Source', SOURCES);
  const today = new Date().toISOString().slice(0, 10);
  const date = await ask('Date received (YYYY-MM-DD, real date; do not guess)', today);
  const obfuscated = (await choose('Deliberate obfuscation (K Y C, p@nding, lookalike letters)?', ['y', 'n'], suggestObfuscation(text) ? 'y' : 'n')) === 'y';

  const existing = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '';
  const built = buildRow({ text, language, isScam, category, source, date, obfuscated }, existing, { today });
  if (built.errors.length) { built.errors.forEach(e => console.error('  ' + e)); fail('the row is invalid; nothing was written'); }
  fs.mkdirSync(path.dirname(path.resolve(FILE)), { recursive: true });
  if (!existing.trim()) fs.writeFileSync(FILE, toCsvLine(COLUMNS) + '\n');
  fs.appendFileSync(FILE, (existing.trim() && !existing.endsWith('\n') ? '\n' : '') + built.line + '\n');
  const s = built.stats;
  out(`\nAdded ${built.id} to ${FILE}`);
  out(`rows: ${s.rows} | language: ${LANGUAGES.map(l => `${l} ${s.language[l] || 0}`).join(', ')} | genuine: ${s.category.safe || 0} | obfuscated: ${s.obfuscated}`);
  out('Check progress with: npm run data:s0');
  rl.close();
})().catch(e => fail(e.message));
