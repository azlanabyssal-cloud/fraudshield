'use strict';
// Writes a header-only CSV. It never writes data: every row must come from a real message.
const fs = require('node:fs');
const path = require('node:path');
const { COLUMNS, toCsvLine } = require('./holdout.js');

const out = process.argv[2] || path.join(__dirname, 'golden_holdout_template.csv');
if (fs.existsSync(out) && path.basename(out) !== 'golden_holdout_template.csv') {
  console.error(`Refusing to overwrite existing ${out}`);
  process.exit(1);
}
fs.writeFileSync(out, toCsvLine(COLUMNS) + '\n');
console.log(`Wrote header-only template: ${out}`);
