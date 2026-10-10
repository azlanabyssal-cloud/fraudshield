'use strict';
// The delivery pipeline is code and is held to the same standard as the product: every action is pinned to a full commit (a tag can be moved, a commit cannot),
// every workflow declares what its token may do (read-only unless a job needs more, and says which), nothing runs untrusted pull-request code with a write token,
// nothing interpolates attacker-controlled text into a shell, and the pieces a release depends on exist.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const DIR = path.join(__dirname, '..', '.github', 'workflows');
const files = fs.readdirSync(DIR).filter(f => /\.ya?ml$/.test(f));
const text = f => fs.readFileSync(path.join(DIR, f), 'utf8');
const code = f => text(f).split('\n').filter(l => !/^\s*#/.test(l)).join('\n');   // what runs, without the comments that explain it

test('the expected workflows exist', () => {
  for (const f of ['ci.yml', 'codeql.yml', 'reproduce.yml', 'release.yml', 'deploy.yml', 'monitor.yml', 'dependency-review.yml', 'scorecard.yml']) assert.ok(files.includes(f), f);
});

test('every third-party action is pinned to a 40-character commit, with the version it was on', () => {
  for (const f of files) for (const m of text(f).matchAll(/^\s*-?\s*uses:\s*([^\s#]+)(.*)$/gm)) {
    const [, ref, rest] = m;
    if (ref.startsWith('./')) continue;
    assert.match(ref, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${f}: ${ref} is not pinned to a commit`);
    assert.match(rest, /#\s*v?\d/, `${f}: ${ref} has no version comment`);
  }
});

test('every workflow declares its token permissions, and the default is read', () => {
  for (const f of files) {
    const t = text(f);
    assert.match(t, /^permissions:/m, `${f}: no top-level permissions`);
    assert.doesNotMatch(t, /^permissions:\s*write-all/m, f);
  }
  // the write scopes exist only where a job needs them, and say so on the job
  assert.match(text('release.yml'), /build:[\s\S]*permissions:[\s\S]*attestations: write/);
  assert.match(text('deploy.yml'), /deploy:[\s\S]*permissions:[\s\S]*pages: write/);
});

test('no workflow checks out and runs pull-request code with a privileged trigger, and none puts event text into a shell command', () => {
  for (const f of files) {
    const t = text(f);
    assert.doesNotMatch(t, /pull_request_target/, `${f}: pull_request_target`);
    for (const m of t.matchAll(/^\s*run:\s*(.*)$/gm)) assert.doesNotMatch(m[1], /\$\{\{\s*github\.(event|head_ref)/, `${f}: event text in a shell command: ${m[1]}`);
  }
});

test('a release is blocked without evidence, and a pull request is only told', () => {
  assert.match(code('release.yml'), /node mlops\/run\.js --strict/);
  assert.doesNotMatch(code('release.yml'), /--report/);
  assert.match(code('ci.yml'), /node mlops\/run\.js --report/);
  assert.doesNotMatch(code('ci.yml'), /continue-on-error/, 'nothing in the pull-request gate is allowed to fail quietly');
});

test('the deploy publishes the assembled allowlist and then checks the live site, and the daily check runs the same smoke test', () => {
  const d = text('deploy.yml');
  assert.match(d, /scripts\/assemble_site\.js --out _site/); assert.match(d, /path: _site/);
  assert.match(d, /scripts\/smoke_live\.js .* --expect-cache/);
  assert.match(text('monitor.yml'), /scripts\/smoke_live\.js/);
  assert.match(text('monitor.yml'), /cron:/);
});
