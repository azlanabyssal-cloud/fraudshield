'use strict';
// The gate that guards the built React app (scripts/check_web_build.js) is itself tested, by running it on pages that are broken on purpose.
// A gate that has never been seen to fail proves nothing; and this one once had a hole (a closing tag spelled "</script >" walked past it), so each way round it is here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const POLICY = fs.readFileSync(path.join(ROOT, 'partials', 'csp.txt'), 'utf8').trim();
const GOOD = `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${POLICY}"><link rel="stylesheet" href="./assets/a.css"></head><body><div id="root"></div><script type="module" src="./assets/a.js"></script></body></html>`;

function gate(html, { js = 'console.log(1)', css = 'a{}', extra = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-gate-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'a.js'), js); fs.writeFileSync(path.join(dir, 'assets', 'a.css'), css);
  for (const [name, body] of Object.entries(extra)) fs.writeFileSync(path.join(dir, name), body);
  fs.writeFileSync(path.join(dir, 'assistant.html'), html);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check_web_build.js')], { env: { ...process.env, WEB_DIST: dir }, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('a correct build passes', () => { const r = gate(GOOD); assert.equal(r.code, 0, r.out); assert.match(r.out, /web build ok/); });

test('an inline script fails however it is written or closed', () => {
  const inline = [
    GOOD.replace('</body>', '<script>alert(1)</script></body>'), GOOD.replace('</body>', '<script>alert(1)</script ></body>'), GOOD.replace('</body>', '<SCRIPT>alert(1)</SCRIPT></body>'),
    GOOD.replace('</body>', '<script\n>alert(1)</script\n foo></body>'), GOOD.replace('</body>', '<script type="module">import("x")</script></body>'), GOOD.replace('</body>', '<script src="./assets/a.js">alert(1)</script></body>'),
    GOOD.replace('</body>', '<script data-x=">" src="./assets/a.js"></script></body>'), GOOD.replace('</body>', '<script>/* a comment */</script></body>')
  ];
  for (const html of inline) { const r = gate(html); assert.equal(r.code, 1, html.slice(-90)); assert.match(r.out, /inline script/, html.slice(-90)); }
});

test('an inline event handler, a javascript: URL, another origin and an absolute path each fail', () => {
  const cases = [[GOOD.replace('<div id="root">', '<div id="root" onclick="x()">'), /inline event handler/], [GOOD.replace('<div id="root">', '<a href="javascript:void(0)">x</a><div id="root">'), /javascript: URL/],
    [GOOD.replace('./assets/a.css', 'https://cdn.example.com/a.css'), /another origin/], [GOOD.replace('./assets/a.js', '//cdn.example.com/a.js'), /another origin/],
    [GOOD.replace('./assets/a.js', '/assets/a.js'), /absolute path/], [GOOD.replace('./assets/a.js', './assets/missing.js'), /was not built/]];
  for (const [html, re] of cases) { const r = gate(html); assert.equal(r.code, 1, html.slice(-120)); assert.match(r.out, re); }
});

test('a missing or altered Content-Security-Policy fails', () => {
  assert.match(gate(GOOD.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')).out, /Content-Security-Policy is missing or differs/);
  assert.match(gate(GOOD.replace("default-src 'self'", "default-src 'self' https://cdn.example.com")).out, /Content-Security-Policy is missing or differs/);
});

test('a bundle over the size budget fails, and a stylesheet that fetches from elsewhere fails', () => {
  const big = Array.from({ length: 200000 }, (_, i) => 'var v' + i + '=' + Math.floor(Math.random() * 1e9) + ';').join('');   // random digits do not compress
  assert.match(gate(GOOD, { js: big }).out, /JavaScript is .* KB gzipped, over the 150 KB budget/);
  assert.match(gate(GOOD, { css: '@import url("https://fonts.example.com/x.css"); a{}' }).out, /another origin/);
});

test('with no build at all the gate says to build first and fails', () => { const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check_web_build.js')], { env: { ...process.env, WEB_DIST: path.join(os.tmpdir(), 'fs-no-such-dist') }, encoding: 'utf8' }); assert.equal(r.status, 1); assert.match(r.stdout + r.stderr, /npm run web:build/); });
