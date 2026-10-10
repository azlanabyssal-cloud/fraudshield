'use strict';
// What is published must be exactly what the site needs: complete (nothing a page refers to is missing) and clean (no developer file, no source of truth for tests,
// no label-store schema). Both directions are checked against the real repository.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { JSDOM } = require('jsdom');
const A = require('../scripts/assemble_site.js');
const { execFileSync } = require('node:child_process');

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: A.ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
const shipped = new Set(A.plan(tracked));
const PAGES = ['index', 'tips', 'data', 'report', 'about', 'assistant'].map(p => p + '.html');

test('the plan ships the six pages, the service worker and the manifest, and nothing from the developer directories', () => {
  for (const f of [...PAGES, 'sw.js', 'script.js', 'style.css', 'manifest.json', 'data/urlmodel.json']) assert.ok(shipped.has(f), f);
  for (const f of shipped) assert.doesNotMatch(f, /^(tests|docs|mlops|data_ops|db|field|scripts|brand|partials|web|\.github)\//, f);
  for (const f of ['package.json', 'package-lock.json', 'README.md', 'SECURITY.md', '.npmrc', 'eslint.config.js', 'data/campaign.json', 'data/cases.json', 'data/stats.json']) assert.ok(!shipped.has(f), f + ' is not published');
});

test('every local file a page, the stylesheets or the service worker refers to is in what ships', () => {
  const missing = [];
  const want = (from, ref) => {
    if (!ref || /^(https?:|data:|mailto:|tel:|#|javascript:)/i.test(ref)) return;
    const rel = path.posix.normalize(path.posix.join(path.posix.dirname(from), ref.split('#')[0].split('?')[0]));
    if (rel === '.' || rel === '' || rel.endsWith('/')) return;
    if (!shipped.has(rel)) missing.push(`${from} -> ${rel}`);
  };
  for (const page of PAGES) {
    const d = new JSDOM(fs.readFileSync(path.join(A.ROOT, page), 'utf8')).window.document;
    d.querySelectorAll('[src],[href],[poster]').forEach(e => { for (const a of ['src', 'href', 'poster']) if (e.hasAttribute(a)) want(page, e.getAttribute(a)); });
  }
  for (const css of ['style.css', 'about.css', 'hero-scene.css', 'motion.css', 'fonts/fonts.css']) {
    for (const m of fs.readFileSync(path.join(A.ROOT, css), 'utf8').matchAll(/url\(\s*['"]?([^'")\s]+)/g)) want(css, m[1]);
  }
  const sw = fs.readFileSync(path.join(A.ROOT, 'sw.js'), 'utf8');
  for (const m of sw.matchAll(/'\.\/([^']*)'/g)) want('sw.js', m[1]);
  for (const i of JSON.parse(fs.readFileSync(path.join(A.ROOT, 'manifest.json'), 'utf8')).icons) want('manifest.json', i.src);
  assert.deepEqual([...new Set(missing)], []);
});

test('assembling writes those files and no others, and stays well inside what a Pages site can hold', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-site-'));
  const r = A.assemble(out);
  const got = []; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : got.push(path.relative(out, path.join(d, e.name))); })(out);
  assert.deepEqual(got.sort(), [...shipped].sort());
  assert.equal(r.files, shipped.size); assert.ok(r.bytes < 60 * 1048576, `${(r.bytes / 1048576).toFixed(1)} MB`);
  fs.rmSync(out, { recursive: true, force: true });
});
