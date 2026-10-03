'use strict';
// Usage: node data_ops/validate_csv.js [file.csv] [--stage=s0|s1] [--final (= --stage=s1)] [--report]
// Exit code 0 = clean, 1 = problems found, 2 = could not read the file.
const fs = require('node:fs');
const path = require('node:path');
const { parseCsv, validateRows, finalChecks, TARGET_MIX } = require('./holdout.js');

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const file = args.find(a => !a.startsWith('--')) || path.join(__dirname, 'golden_holdout_template.csv');

let text;
try { text = fs.readFileSync(file, 'utf8'); } catch (e) { console.error(`Cannot read ${file}: ${e.message}`); process.exit(2); }

let rows;
try { rows = parseCsv(text); } catch (e) { console.error(`${file}: ${e.message}`); process.exit(1); }

const { errors, warnings, stats } = validateRows(rows);
const stageArg = args.find(a => a.startsWith('--stage='));
const stage = stageArg ? stageArg.split('=')[1] : (flags.has('--final') ? 's1' : null);
const finals = stage ? finalChecks(stats, stage) : [];

if (flags.has('--report') && stats) {
  const pct = n => (stats.rows ? (100 * n / stats.rows).toFixed(1) : '0.0') + '%';
  console.log(`rows: ${stats.rows}`);
  console.log('language: ' + Object.keys(TARGET_MIX).map(l => `${l} ${stats.language[l] || 0} (${pct(stats.language[l] || 0)}, target ${TARGET_MIX[l]}%)`).join(' | '));
  console.log('category: ' + Object.entries(stats.category).map(([k, v]) => `${k}=${v}`).join(' '));
  console.log('source:   ' + Object.entries(stats.source).map(([k, v]) => `${k}=${v}`).join(' '));
  console.log(`obfuscated: ${stats.obfuscated} (${pct(stats.obfuscated)})`);
  if (stats.dates.length) console.log(`dates: ${stats.dates.slice().sort()[0]} to ${stats.dates.slice().sort().pop()}`);
}
warnings.forEach(w => console.warn('warning: ' + w));
errors.slice(0, 50).forEach(e => console.error('error: ' + e));
if (errors.length > 50) console.error(`... and ${errors.length - 50} more errors`);
finals.forEach(p => console.error('final-check: ' + p));

if (errors.length || finals.length) {
  console.error(`FAILED: ${errors.length} error(s)` + (finals.length ? `, ${finals.length} final-check problem(s)` : ''));
  process.exit(1);
}
console.log(`OK: ${file} (${stats.rows} rows)`);
