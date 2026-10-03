'use strict';
/* Fetches the UCI SMS Spam Collection (CC BY 4.0) and verifies it against pinned hashes.
   The raw file holds real phone numbers and real people's texts, so it is never committed:
   data/ is gitignored and every run re-checks the hash. */
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), crypto = require('node:crypto');

const SOURCE = 'https://archive.ics.uci.edu/static/public/228/sms+spam+collection.zip';
const ZIP_SHA256 = '1587ea43e58e82b14ff1f5425c88e17f8496bfcdb67a583dbff9eefaf9963ce3';
const TXT_SHA256 = '7d039a24a6083ed9ef0f806ebad56bbb976e3aeb8de05669173bfdc4996c239d';
const DIR = path.join(__dirname, 'data');
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

// Minimal zip reader (stored or deflate entries), so there is no dependency on an unzip tool.
function extractEntry(zip, name) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = zip.readUInt16LE(eocd + 10); n > 0; n--) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = zip.readUInt16LE(p + 10), size = zip.readUInt32LE(p + 20), nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30), commentLen = zip.readUInt16LE(p + 32), local = zip.readUInt32LE(p + 42);
    const entryName = zip.toString('utf8', p + 46, p + 46 + nameLen);
    if (entryName === name) {
      if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('corrupt zip local header');
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`unsupported zip method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`"${name}" not found in zip`);
}

// Tab-separated "label<TAB>text" lines -> [{ y: boolean, text }]. Spam is the positive class.
function parseSms(txt) {
  return txt.split('\n').filter(l => l.length).map((line, i) => {
    const t = line.indexOf('\t'), label = line.slice(0, t);
    if (t < 0 || (label !== 'ham' && label !== 'spam')) throw new Error(`line ${i + 1}: expected "ham" or "spam" then a tab`);
    return { y: label === 'spam', text: line.slice(t + 1).replace(/\r$/, '') };
  });
}

async function load() {
  const file = path.join(DIR, 'SMSSpamCollection');
  if (fs.existsSync(file) && sha(fs.readFileSync(file)) === TXT_SHA256) return fs.readFileSync(file, 'utf8');
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const zip = Buffer.from(await res.arrayBuffer());
  if (sha(zip) !== ZIP_SHA256) throw new Error('downloaded zip does not match the pinned sha-256; refusing to use it');
  const txt = extractEntry(zip, 'SMSSpamCollection');
  if (sha(txt) !== TXT_SHA256) throw new Error('extracted file does not match the pinned sha-256');
  fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(file, txt);
  return txt.toString('utf8');
}

module.exports = { extractEntry, parseSms, load, TXT_SHA256, ZIP_SHA256, SOURCE };
