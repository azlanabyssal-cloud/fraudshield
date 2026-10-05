'use strict';
/* Checks the built React app (web/dist) against the promises the site makes, so a framework migration cannot quietly undo them:
   the Content-Security-Policy is present and is the site's one policy; no page runs inline script or carries an inline event handler; every script, style and font comes from this site;
   and the JavaScript a visitor must download stays inside a budget. Run by `npm run web:budget` after a build. */
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');

const DIST = path.join(__dirname, '..', 'web', 'dist');
// Gzipped bytes of the JavaScript the assistant page loads before it can be used. The page it replaces ships about 125 KB (everything, eagerly), so this is the ceiling
// while the image tools are still to be moved; it falls when they are loaded only when a picture is added (docs/ARCHITECTURE.md, "React and TypeScript").
const BUDGET = { jsGzip: 150 * 1024, cssGzip: 12 * 1024 };

const gz = file => zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
const problems = [];
const check = (ok, message) => { if (!ok) problems.push(message); };

const pages = fs.existsSync(DIST) ? fs.readdirSync(DIST).filter(f => f.endsWith('.html')) : [];
check(pages.length > 0, 'web/dist has no pages: run `npm run web:build` first');
const policy = fs.readFileSync(path.join(__dirname, '..', 'partials', 'csp.txt'), 'utf8').trim();

let jsBytes = 0, cssBytes = 0;
for (const page of pages) {
  const html = fs.readFileSync(path.join(DIST, page), 'utf8');
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html);
  check(meta && meta[1] === policy, `${page}: the Content-Security-Policy is missing or differs from partials/csp.txt`);
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  for (const [, attrs, body] of scripts) check(/\ssrc=/.test(attrs) && !body.trim(), `${page}: an inline script (the policy forbids them)`);
  check(!/\son[a-z]+\s*=/i.test(html.replace(/<noscript>[\s\S]*?<\/noscript>/g, '')), `${page}: an inline event handler`);
  check(!/javascript:/i.test(html), `${page}: a javascript: URL`);
  for (const m of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const url = m[1];
    if (/^(https?:)?\/\//i.test(url)) check(false, `${page}: references another origin: ${url}`);
    else if (/\.(js|css|woff2?)$/i.test(url)) check(fs.existsSync(path.join(DIST, url.replace(/^\//, ''))), `${page}: ${url} was not built`);
  }
  for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) jsBytes += gz(path.join(DIST, m[1].replace(/^\//, '')));
  for (const m of html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)) cssBytes += gz(path.join(DIST, m[1].replace(/^\//, '')));
  for (const m of html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)) jsBytes += gz(path.join(DIST, m[1].replace(/^\//, '')));
}
// styles may import fonts: they must be built into dist, never fetched from elsewhere
for (const f of fs.existsSync(path.join(DIST, 'assets')) ? fs.readdirSync(path.join(DIST, 'assets')).filter(f => f.endsWith('.css')) : []) {
  const css = fs.readFileSync(path.join(DIST, 'assets', f), 'utf8');
  check(!/url\(\s*['"]?(https?:)?\/\//i.test(css), `${f}: a stylesheet loads something from another origin`);
}
check(jsBytes <= BUDGET.jsGzip, `JavaScript is ${(jsBytes / 1024).toFixed(1)} KB gzipped, over the ${BUDGET.jsGzip / 1024} KB budget`);
check(cssBytes <= BUDGET.cssGzip, `CSS is ${(cssBytes / 1024).toFixed(1)} KB gzipped, over the ${BUDGET.cssGzip / 1024} KB budget`);

if (problems.length) { for (const p of problems) console.error('FAIL ' + p); process.exit(1); }
console.log(`web build ok: ${pages.join(', ')}; policy present, no inline script, same-origin only; JS ${(jsBytes / 1024).toFixed(1)} KB gzip of ${BUDGET.jsGzip / 1024}; CSS ${(cssBytes / 1024).toFixed(1)} KB of ${BUDGET.cssGzip / 1024}`);
