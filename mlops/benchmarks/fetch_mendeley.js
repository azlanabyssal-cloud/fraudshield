'use strict';
/* Fetches the Mendeley "SMS Phishing Dataset for Machine Learning and Pattern Recognition" (CC BY 4.0, Mishra and Soni)
   and verifies it against the publisher's own SHA-256. Never committed: it holds real phone numbers. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { extractEntry } = require('./fetch_sms.js');
const { parseCsv } = require('../../data_ops/holdout.js');

const SOURCE = 'https://data.mendeley.com/public-files/datasets/f45bkkt8pr/files/edb361de-918d-469f-9106-e84823830665/file_downloaded';
const ZIP_SHA256 = '9bbf3188fdad81495d8e82825648b9b63b53fc86841a3d26c02629990b233cc3';   // published by Mendeley
const CSV_SHA256 = '649844f1c62a6b27e145eaf17a65f7010c56c390e11a794ea8329993a05ba71e';
const DEFAULT_DIR = process.env.FS_BENCH_DATA || path.join(__dirname, 'data');
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

// The source mixes case ("Smishing"/"smishing", "Spam"/"spam"), so labels are normalised here, once.
function parseMendeley(csvText) {
  const rows = parseCsv(csvText);
  const header = rows[0].map(h => h.trim().toUpperCase());
  const li = header.indexOf('LABEL'), ti = header.indexOf('TEXT');
  if (li < 0 || ti < 0) throw new Error('expected LABEL and TEXT columns');
  return rows.slice(1).map((r, i) => {
    const label = String(r[li]).trim().toLowerCase();
    if (!['ham', 'spam', 'smishing'].includes(label)) throw new Error(`row ${i + 2}: unknown label "${r[li]}"`);
    return { label, text: r[ti] };
  });
}

async function load({ dir = DEFAULT_DIR } = {}) {
  const file = path.join(dir, 'Dataset_5971.csv');
  if (fs.existsSync(file) && sha(fs.readFileSync(file)) === CSV_SHA256) return fs.readFileSync(file, 'utf8');
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const zip = Buffer.from(await res.arrayBuffer());
  if (sha(zip) !== ZIP_SHA256) throw new Error('downloaded zip does not match the publisher\'s sha-256; refusing to use it');
  const csv = extractEntry(zip, 'Dataset_5971.csv');
  if (sha(csv) !== CSV_SHA256) throw new Error('extracted file does not match the pinned sha-256');
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, csv);
  return csv.toString('utf8');
}

module.exports = { parseMendeley, load, SOURCE, ZIP_SHA256, CSV_SHA256 };
