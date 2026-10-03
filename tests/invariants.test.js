'use strict';
// Guards for promises the product makes to users and for deployment mistakes
// that have bitten this project before. If one of these fails, fix the code or
// change the promise deliberately — do not just edit the test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const pages = ['index.html', 'tips.html', 'data.html', 'report.html', 'assistant.html'];

// No third-party script is allowed on any page. Chart.js and the OCR engine are vendored locally at a pinned version;
// adding any other external script needs a conscious decision and a pinned, hash-checked local copy instead.
const ALLOWED_EXTERNAL_SCRIPTS = [];

test('no page loads an unexpected third-party script', () => {
  for (const page of pages) {
    const srcs = [...read(page).matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
    for (const src of srcs.filter(s => /^https?:\/\//.test(s))) {
      assert.ok(ALLOWED_EXTERNAL_SCRIPTS.includes(src), `${page} loads unapproved script ${src}`);
    }
  }
});

test('script.js never fetches code or models from a CDN (OCR is bundled locally)', () => {
  assert.doesNotMatch(read('script.js'), /https?:\/\/[^'"\s]*(cdn|jsdelivr|unpkg|cdnjs)[^'"\s]*/i);
});

test('speech recognition stays off in V1 (it streams audio to a third party)', () => {
  assert.match(read('script.js'), /voiceInput:\s*false/);
});

test('every page loads lib/core.js before script.js', () => {
  for (const page of pages) {
    const html = read(page);
    const core = html.indexOf('lib/core.js');
    const main = html.indexOf('src="script.js"');
    assert.ok(core !== -1 && main !== -1 && core < main, `${page}: core.js must precede script.js`);
  }
});

test('OCR bundle is complete and language data is real gzip', () => {
  const dir = 'vendor/tesseract';
  for (const f of ['tesseract.min.js', 'worker.min.js', 'tesseract-core-lstm.wasm.js',
    'tesseract-core-simd-lstm.wasm.js', 'lang/eng.traineddata.gz', 'lang/hin.traineddata.gz']) {
    assert.ok(fs.existsSync(path.join(root, dir, f)), `missing ${dir}/${f}`);
  }
  for (const l of ['eng', 'hin']) {
    const b = fs.readFileSync(path.join(root, dir, 'lang', `${l}.traineddata.gz`));
    assert.equal(b[0], 0x1f); assert.equal(b[1], 0x8b); // gzip magic bytes
  }
});

test('service worker precache only lists files that exist (a missing one fails install)', () => {
  const precache = read('sw.js').split('PRECACHE_URLS = [')[1].split('];')[0];
  const files = [...precache.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]);
  assert.ok(files.length > 5, 'precache list unexpectedly small');
  for (const f of files) assert.ok(fs.existsSync(path.join(root, f)), `sw.js precaches missing file ${f}`);
});

test('manifest icons and every local asset referenced by pages exist', () => {
  const manifest = JSON.parse(read('manifest.json'));
  for (const i of manifest.icons) assert.ok(fs.existsSync(path.join(root, i.src)), `missing icon ${i.src}`);
  for (const page of pages) {
    for (const m of read(page).matchAll(/(?:href|src)="((?!https?:|tel:|#|mailto:)[^"]+)"/g)) {
      const f = m[1].split(/[?#]/)[0];
      if (!f) continue;
      assert.ok(fs.existsSync(path.join(root, f)), `${page} references missing ${f}`);
    }
  }
});

test('HTML pages have balanced structural tags', () => {
  for (const page of pages) {
    const h = read(page);
    for (const t of ['div', 'section', 'nav', 'footer', 'head', 'body']) {
      const open = (h.match(new RegExp(`<${t}[\\s>]`, 'g')) || []).length;
      const close = (h.match(new RegExp(`</${t}>`, 'g')) || []).length;
      assert.equal(open, close, `${page}: <${t}> ${open} open vs ${close} close`);
    }
  }
});

// Product rule (docs/SPEC.md section 4, ADR-0007): a false "safe" is the most expensive error,
// so no user-facing text may promise safety.
test('no page or script promises safety', () => {
  const banned = /(100% safe|completely safe|totally safe|definitely safe|guaranteed safe|is safe to (click|open|pay|share))/i;
  for (const f of [...pages, 'script.js', 'lib/core.js']) {
    const m = read(f).match(banned);
    assert.equal(m, null, `${f} contains the safety promise "${m && m[0]}"`);
  }
});

test('spec and decision log exist and the spec states its kill criteria', () => {
  assert.match(read('docs/SPEC.md'), /Kill criteria/);
  assert.match(read('docs/DECISIONS.md'), /ADR-0007/);
});
