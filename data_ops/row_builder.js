'use strict';
// Builds and validates one dataset row against the existing file. Pure: the caller does the reading and writing.
const { COLUMNS, parseCsv, toCsvLine, validateRows } = require('./holdout.js');

const nextId = rows => `GH-${String(rows.slice(1).reduce((m, r) => Math.max(m, Number((/^GH-(\d+)$/.exec(r[0]) || [])[1] || 0)), 0) + 1).padStart(4, '0')}`;

// existingCsv: the current file contents ('' for a new file). Returns { line, id, errors, rows } and never throws on bad input.
function buildRow(f, existingCsv, { today } = {}) {
  const existing = existingCsv.trim() ? parseCsv(existingCsv) : [COLUMNS];
  const before = validateRows(existing, { today });
  if (before.errors.length) return { errors: ['the existing file is already invalid, fix it first: ' + before.errors[0]], rows: existing };
  const id = nextId(existing);
  const row = [id, f.text, f.language, f.isScam ? '1' : '0', f.isScam ? f.category : 'safe', f.source, f.date, f.obfuscated ? 'true' : 'false'];
  const after = validateRows([...existing, row], { today });
  return { line: toCsvLine(row), id, errors: after.errors, rows: [...existing, row], stats: after.stats };
}

module.exports = { buildRow, nextId };
