'use strict';
// The documents are part of the product: every link must go somewhere, every command must exist, every number that is quoted must still be true.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DOCS = ['README.md', 'docs/ARCHITECTURE.md', 'docs/BENCHMARKS.md', 'docs/PRIVACY.md', 'docs/OBSERVABILITY.md', 'docs/DECISIONS.md', 'mlops/README.md'];
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const pkg = JSON.parse(read('package.json'));

test('every relative link in the documents points at a file that exists (anchors and web links aside)', () => {
  const broken = [];
  for (const doc of DOCS) {
    const base = path.dirname(path.join(ROOT, doc));
    for (const m of read(doc).matchAll(/\]\(([^)\s]+)\)/g)) { const href = m[1]; if (/^(https?:|mailto:|#)/.test(href)) continue; const file = path.resolve(base, href.split('#')[0]); if (!fs.existsSync(file)) broken.push(`${doc}: ${href}`); }
  }
  assert.deepEqual(broken, []);
});

test('every `npm run` command the documents mention is a real script', () => {
  const missing = [];
  for (const doc of DOCS) for (const m of read(doc).matchAll(/npm run ([a-z][a-z0-9:-]*)/g)) if (!pkg.scripts[m[1]]) missing.push(`${doc}: npm run ${m[1]}`);
  assert.deepEqual(missing, []);
});

test('the number of ADRs, tests and the results quoted at the top of the README match the repository', () => {
  const adrs = (read('docs/DECISIONS.md').match(/^## ADR-\d{4}:/gm) || []).length, words = { 22: 'twenty-two', 23: 'twenty-three', 24: 'twenty-four' };
  assert.ok(read('README.md').includes(words[adrs] || '??'), `README says a number of ADRs other than ${adrs}`); assert.ok(read('docs/ARCHITECTURE.md').includes(`(${adrs} ADRs)`), 'ARCHITECTURE.md ADR count');
  const ids = [...read('docs/DECISIONS.md').matchAll(/^## ADR-(\d{4}):/gm)].map(m => +m[1]); ids.forEach((id, i) => assert.equal(id, i + 1, 'ADRs are numbered in order without gaps'));
  const lin = JSON.parse(read('mlops/lineage.json')); assert.ok(read('README.md').includes(lin.model.sha256.slice(0, 12)), 'the model hash quoted in the README is the shipped one'); assert.ok(read('docs/BENCHMARKS.md').includes(lin.model.sha256.slice(0, 12)));
  for (const f of ['scripts/browser/pages.js', 'scripts/browser/ocr.js', 'scripts/browser/speech.js', 'scripts/browser/qr.js', 'scripts/browser/latency.js', 'scripts/qr_eval.js']) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
});

test('the privacy document lists every key the page stores, and the erase button removes exactly those', () => {
  const doc = read('docs/PRIVACY.md'), src = read('script.js');
  for (const key of ['fs_cb_state', 'fs_ops_v1', 'fs_voice_consent_v1', 'fs_cb_seen']) { assert.ok(doc.includes(key), `${key} is documented`); assert.ok(src.includes(key), `${key} is used`); }
  const erased = [...(src.match(/const LOCAL_KEYS = \[([^\]]*)\], PERSISTENT_KEYS = \[([^\]]*)\]/) || []).slice(1).join(',').matchAll(/'([a-z_0-9]+)'/g)].map(m => m[1]).concat(src.includes('PERSISTENT_KEYS = [VOICE_CONSENT_KEY') ? ['fs_voice_consent_v1'] : []);
  assert.deepEqual(erased.sort(), ['fs_cb_seen', 'fs_cb_state', 'fs_ops_v1', 'fs_voice_consent_v1']);
  for (const m of src.matchAll(/(?:sessionStorage|localStorage)\.(?:getItem|setItem)\('([a-z_0-9]+)'/g)) assert.ok(doc.includes(m[1]), `${m[1]} is stored but not in PRIVACY.md`);
});

test('every diagram in the architecture document is well-formed: no double quotes inside a label, balanced brackets, a known diagram type (the real parser is run by `npm run audit:docs`)', () => {
  const blocks = [...read('docs/ARCHITECTURE.md').matchAll(/```mermaid\n([\s\S]*?)```/g)].map(m => m[1]);
  assert.ok(blocks.length >= 3, 'the document has its diagrams');
  for (const code of blocks) {
    assert.match(code.trim(), /^(flowchart|graph|sequenceDiagram|stateDiagram|classDiagram)\b/);
    for (const line of code.split('\n')) { const bracketed = line.match(/\[[^\]]*\]/g) || []; for (const label of bracketed) assert.ok(!/["]/.test(label.slice(1, -1)), `a double quote inside a label breaks the parser: ${label}`); }
    for (const [open, close] of [['[', ']'], ['(', ')'], ['{', '}']]) assert.equal(code.split(open).length, code.split(close).length, `unbalanced ${open}${close} in a diagram`);
  }
});

test('no file in the repository carries the name of an AI assistant or product: the project is the author\'s own work and says so (checked on every push)', () => {
  const words = new RegExp(['cla' + 'ude', 'anthr' + 'opic', 'chat' + 'gpt', 'gem' + 'ini', 'co' + 'pilot', 'open' + 'ai', 'perplex' + 'ity', 'deep' + 'seek'].join('|'), 'i'), skip = new Set(['node_modules', '.git']), hits = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (path.relative(ROOT, full) === path.join('mlops', 'benchmarks', 'data')) continue;   // downloaded public datasets, git-ignored: URLs and domain names, not project content
      if (e.isDirectory()) walk(full);
      else if (/\.(?:js|json|md|html|css|txt|yml|yaml|svg|csv|webmanifest)$/.test(e.name) && words.test(fs.readFileSync(full, 'utf8'))) hits.push(path.relative(ROOT, full));
    }
  }(ROOT));
  assert.deepEqual(hits, []);
});
