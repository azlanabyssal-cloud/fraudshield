'use strict';
/* Assembles exactly what the public site serves, and nothing else, into a directory (default `_site`).
   The repository holds a lot that must never be published: tests, benchmarks, the label-store schema, the data-operations tools, the survey code, build inputs.
   An allowlist, not a denylist, decides what ships, so a new developer file can never reach the public site by accident; the test in tests/assemble.test.js
   then proves that every file a page, the stylesheet or the service worker refers to is in the result.
     node scripts/assemble_site.js [--out _site] [--list] */
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const ROOT = path.join(__dirname, '..');

const ROOT_FILES = /^(index|tips|data|report|about|assistant)\.html$|^(style|about|motion|hero-scene)\.css$|^(script|home|sw)\.js$|^manifest\.json$/;
const DIRS = ['lib', 'fonts', 'icons', 'images', 'media', 'vendor'];
const EXTRA = new Set(['data/urlmodel.json']);   // the one data file the browser fetches; the other data files are inputs to the build

/** Which tracked files ship. */
function plan(files) {
  return files.filter(f => (!f.includes('/') && ROOT_FILES.test(f)) || DIRS.some(d => f.startsWith(d + '/')) || EXTRA.has(f)).sort();
}
const tracked = () => execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);

function assemble(out, files = plan(tracked())) {
  fs.rmSync(out, { recursive: true, force: true });
  let bytes = 0;
  for (const f of files) {
    const to = path.join(out, f); fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), to); bytes += fs.statSync(to).size;
  }
  return { files: files.length, bytes };
}

if (require.main === module) {
  const args = process.argv.slice(2), at = args.indexOf('--out'), out = path.resolve(ROOT, at >= 0 ? args[at + 1] : '_site');
  if (args.includes('--list')) { console.log(plan(tracked()).join('\n')); process.exit(0); }
  const r = assemble(out);
  console.log(`assembled ${r.files} files, ${(r.bytes / 1048576).toFixed(1)} MB, into ${path.relative(ROOT, out) || '.'}`);
}
module.exports = { plan, assemble, ROOT_FILES, DIRS, EXTRA, ROOT };
