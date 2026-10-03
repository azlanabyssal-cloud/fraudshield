'use strict';
/* Data for the domain-name model. Two public sources, both fetched on demand, hash-checked against pinned digests, and never committed:
   - PhiUSIIL Phishing URL Dataset (Prasad and Chandra, 2024; UCI; CC BY 4.0): 235,795 addresses, label 0 = phishing, 1 = legitimate.
   - Tranco list 94GG2 (2026-10-02): the 1,000,000 most visited registered domains, combined from five providers. Used to put
     small, ordinary, honest websites on the legitimate side, which the first dataset does not contain.

   Three things about the first source decide how it must be used (measured, see ADR-0014):
   1. every legitimate address in it is exactly "https://www.<host>": 100% https, 100% "www", 0% with a path, a query or a trailing slash;
      phishing addresses vary on all of those. So only the host is kept, and "www" is stripped.
   2. phishing is concentrated on free hosting platforms (web.app, firebaseapp.com, repl.co...) with no legitimate tenants in the data,
      so a model would learn "a platform is phishing". Platform tenants are excluded; the rules judge them.
   3. a split by address would put the same name with different endings on both sides, so the split is by the owner's chosen name. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { extractEntry } = require('../benchmarks/fetch_sms.js');
const { parseCsv } = require('../../data_ops/holdout.js');
const Link = require('../../lib/linkcheck.js');
const { fnv } = require('../../lib/urlmodel.js');

const DEFAULT_DIR = process.env.FS_BENCH_DATA || path.join(__dirname, '..', 'benchmarks', 'data');
const SOURCES = {
  phiusiil: { url: 'https://archive.ics.uci.edu/static/public/967/phiusiil+phishing+url+dataset.zip', zipSha: '0a639fd03aea6308c5b1c10c92aa23c2ce1505447a9137271865cd0badc9a59a', entry: 'PhiUSIIL_Phishing_URL_Dataset.csv', file: 'PhiUSIIL_Phishing_URL_Dataset.csv', sha: 'a236549cd369cd80bd478ff8e1779cbf44c58d5c3f79f7a51a1adbed7d06d1c6' },
  tranco: { url: 'https://tranco-list.eu/download/94GG2/1000000', file: 'tranco_94GG2.csv', sha: 'c5a05417a5a7a816e55b4527e29fa95bce35e31b79664aacaa1c5a632d44167b', listId: '94GG2' }
};
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const PLATFORM_MIN_HOSTS = 50;                         // a registered domain that hosts this many distinct phishing addresses is a platform
const SPLIT = { train: 70, val: 85 };                  // by hash bucket of the name: 0-69 train, 70-84 validation, 85-99 test
// [rank upper bound, probability of keeping a domain]: the popular head is thinned and the long tail, where small honest sites live, is kept more
const TRANCO_KEEP = [[10000, 0.6], [100000, 0.22], [500000, 0.1], [1000000, 0.08]];

async function download(src, dir) {
  const file = path.join(dir, src.file);
  if (fs.existsSync(file) && sha(fs.readFileSync(file)) === src.sha) return file;
  const res = await fetch(src.url);
  if (!res.ok) throw new Error(`download failed for ${src.url}: HTTP ${res.status}`);
  let buf = Buffer.from(await res.arrayBuffer());
  if (src.zipSha) {
    if (sha(buf) !== src.zipSha) throw new Error(`${src.url}: downloaded zip does not match the pinned sha-256; refusing to use it`);
    buf = extractEntry(buf, src.entry);
  }
  if (sha(buf) !== src.sha) throw new Error(`${src.file}: content does not match the pinned sha-256; refusing to use it`);
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, buf);
  return file;
}

// "https://www.Example.com:8080/x?y" -> "example.com"; null for anything that is not an ordinary named host.
function hostOf(address) {
  let h;
  try { h = new URL(/^[a-z]+:\/\//i.test(address) ? address : 'http://' + address).hostname.toLowerCase().replace(/\.$/, ''); } catch (e) { return null; }
  if (h.startsWith('www.')) h = h.slice(4);
  if (!/^[a-z0-9.-]+$/.test(h) || h.indexOf('.') < 0 || /^\d+(\.\d+){3}$/.test(h)) return null;
  return h;
}
const splitOf = name => { const b = fnv('split:' + name, 7) % 100; return b < SPLIT.train ? 'train' : b < SPLIT.val ? 'val' : 'test'; };
const keepTranco = (reg, rank) => fnv('keep:' + reg, 3) % 10000 < TRANCO_KEEP.find(([bound]) => rank <= bound)[1] * 10000;

// Builds the labelled domains and the platform list. Pure given the two parsed inputs, so tests can feed small fixtures.
function build(phiRows, trancoLines, { platformMinHosts = PLATFORM_MIN_HOSTS } = {}) {
  const phishHosts = [], legitHosts = [];
  for (const r of phiRows) { const h = hostOf(r.url); if (h) (r.label === '0' ? phishHosts : legitHosts).push(h); }
  const tenants = new Map();
  for (const h of phishHosts) { const reg = Link.registrableDomain(h); (tenants.get(reg) || tenants.set(reg, new Set()).get(reg)).add(h); }
  const platforms = [...tenants].filter(([, set]) => set.size >= platformMinHosts).map(([reg]) => reg).sort();
  const platformSet = new Set(platforms);

  const labelled = new Map();                          // registered domain -> 1 phishing, 0 legitimate, null conflicting
  const note = (host, y, source) => {
    const reg = Link.registrableDomain(host);
    if (platformSet.has(reg)) return;
    const d = Link.splitDomain(reg);
    if (d.name.length < 3 || d.name.startsWith('xn--')) return;
    const prev = labelled.get(reg);
    if (prev === undefined) labelled.set(reg, { y, source, name: d.name, suffix: d.suffix });
    else if (prev.y !== y) prev.y = null;
  };
  phishHosts.forEach(h => note(h, 1, 'phiusiil'));
  legitHosts.forEach(h => note(h, 0, 'phiusiil'));
  let rank = 0;
  for (const line of trancoLines) {
    rank++;
    const dom = line.split(',')[1]; if (!dom) continue;
    const h = hostOf(dom); if (!h) continue;
    const reg = Link.registrableDomain(h);
    if (labelled.has(reg)) continue;
    if (keepTranco(reg, rank)) note(h, 0, 'tranco');
  }
  const rows = [];
  let conflicting = 0;
  for (const [reg, v] of labelled) {
    if (v.y === null) { conflicting++; continue; }
    rows.push({ reg, name: v.name, suffix: v.suffix, y: v.y, source: v.source, split: splitOf(v.name) });
  }
  rows.sort((a, b) => (a.reg < b.reg ? -1 : 1));       // a fixed order: nothing downstream depends on file order
  const count = f => rows.filter(f).length;
  return {
    rows, platforms,
    counts: {
      phishingAddresses: phishHosts.length, legitimateAddresses: legitHosts.length, platformsFound: platforms.length, conflictingDomains: conflicting,
      domains: rows.length, phishing: count(r => r.y === 1), legitimate: count(r => r.y === 0), legitimateFromTranco: count(r => r.y === 0 && r.source === 'tranco'),
      bySplit: Object.fromEntries(['train', 'val', 'test'].map(s => [s, { phishing: count(r => r.split === s && r.y === 1), legitimate: count(r => r.split === s && r.y === 0) }]))
    }
  };
}

// The artifacts that decided the design: how often each easy-to-read trait appears on each side of the raw data.
function artifactShares(phiRows) {
  const traits = {
    https: u => /^https:/i.test(u), www: u => /^[a-z]+:\/\/www\./i.test(u), path: u => /^[a-z]+:\/\/[^/?#]+\/[^?#]+/i.test(u),
    query: u => u.indexOf('?') >= 0, trailingSlash: u => u.endsWith('/'), bareHost: u => /^[a-z]+:\/\/[^/?#]+\/?$/i.test(u)
  };
  const out = {};
  for (const [name, test] of Object.entries(traits)) {
    out[name] = {};
    for (const [label, key] of [['0', 'phishing'], ['1', 'legitimate']]) {
      const side = phiRows.filter(r => r.label === label);
      out[name][key] = side.length ? Math.round(1000 * side.filter(r => test(r.url)).length / side.length) / 1000 : null;
    }
  }
  return out;
}

async function load({ dir = DEFAULT_DIR } = {}) {
  const phiFile = await download(SOURCES.phiusiil, dir), trFile = await download(SOURCES.tranco, dir);
  const table = parseCsv(fs.readFileSync(phiFile, 'utf8').replace(/^\uFEFF/, ''));
  const head = table[0], u = head.indexOf('URL'), l = head.indexOf('label');
  if (u < 0 || l < 0) throw new Error('expected URL and label columns');
  const phiRows = table.slice(1).filter(r => r.length > l).map(r => ({ url: r[u], label: String(r[l]).trim() }));
  const tranco = fs.readFileSync(trFile, 'utf8').split('\n').filter(Boolean);
  return { ...build(phiRows, tranco), artifacts: artifactShares(phiRows) };
}

module.exports = { load, build, artifactShares, hostOf, splitOf, SOURCES, SPLIT, PLATFORM_MIN_HOSTS, TRANCO_KEEP, sha };
