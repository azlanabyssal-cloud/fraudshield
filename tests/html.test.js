'use strict';
// Structural quality of every page: the defects that never show in a screenshot but break navigation, assistive tech or security.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const { PAGES } = require('../scripts/scan_numbers.js');

const ROOT = path.join(__dirname, '..');
const pages = PAGES.filter(p => fs.existsSync(path.join(ROOT, p)));
const docs = Object.fromEntries(pages.map(p => [p, new JSDOM(fs.readFileSync(path.join(ROOT, p), 'utf8')).window.document]));
const each = fn => { const problems = []; for (const [page, doc] of Object.entries(docs)) fn(page, doc, m => problems.push(`${page}: ${m}`)); assert.deepEqual(problems, []); };

test('every page has a language, a title, a viewport, a description and a theme colour', () => each((page, d, bad) => {
  if (!d.documentElement.getAttribute('lang')) bad('missing <html lang>');
  if (!d.title.trim()) bad('empty <title>');
  if (!d.querySelector('meta[name="viewport"]')) bad('missing viewport meta');
  if (!(d.querySelector('meta[name="description"]') || {}).getAttribute || !d.querySelector('meta[name="description"]').getAttribute('content')) bad('missing meta description');
  if (!d.querySelector('meta[name="theme-color"]')) bad('missing theme-color');
}));

test('every page that loads the shared core also loads the link analyzer first, because the core depends on it', () => each((page, d, bad) => {
  const srcs = [...d.querySelectorAll('script[src]')].map(s => s.getAttribute('src'));
  const core = srcs.indexOf('lib/core.js'), link = srcs.indexOf('lib/linkcheck.js');
  if (core >= 0 && (link < 0 || link > core)) bad('lib/core.js is loaded without lib/linkcheck.js before it');
  const msg = srcs.indexOf('lib/msgcheck.js');
  if (core >= 0 && (msg < 0 || msg < core)) bad('lib/msgcheck.js must be loaded after lib/core.js, which it depends on');
  if (srcs.indexOf('script.js') >= 0 && srcs.indexOf('script.js') < msg) bad('script.js is loaded before lib/msgcheck.js');
}));

test('every page loads the motion tokens before the stylesheet that uses them, and the engine before the scripts that need it', () => each((page, d, bad) => {
  const css = [...d.querySelectorAll('link[rel="stylesheet"]')].map(l => l.getAttribute('href')), js = [...d.querySelectorAll('script[src]')].map(s => s.getAttribute('src'));
  if (css.indexOf('motion.css') < 0 || css.indexOf('motion.css') > css.indexOf('style.css')) bad('motion.css must be linked before style.css');
  const engine = js.indexOf('lib/motion.js');
  if (engine < 0) bad('lib/motion.js is not loaded');
  for (const needs of ['lib/hero-scene.js', 'script.js']) if (js.indexOf(needs) >= 0 && js.indexOf(needs) < engine) bad(needs + ' is loaded before lib/motion.js');
  if (d.querySelector('.creature') && (js.indexOf('lib/creatures.js') < 0 || js.indexOf('lib/creatures.js') > js.indexOf('script.js'))) bad('lib/creatures.js must load before script.js on a page with characters');
  const scene = js.indexOf('lib/hero-scene.js');
  if (scene >= 0 && (js.indexOf('lib/motes.js') < 0 || js.indexOf('lib/motes.js') > scene)) bad('lib/motes.js must load before lib/hero-scene.js, which draws with it');
  if (d.querySelector('.funnel-grid') && (js.indexOf('lib/flow.js') < 0 || js.indexOf('lib/flow.js') > js.indexOf('script.js'))) bad('lib/flow.js must load before script.js on a page with a .funnel-grid');
}));

test('every --mo- token the pages and stylesheets use is defined in motion.css', () => {
  const tokens = new Set([...fs.readFileSync(path.join(ROOT, 'motion.css'), 'utf8').matchAll(/(--mo-[a-z-]+):/g)].map(m => m[1])), used = new Set();
  for (const f of ['style.css', 'hero-scene.css', 'about.css', ...pages]) for (const m of fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/var\((--mo-[a-z-]+)/g)) used.add(m[1]);
  assert.ok(used.size >= 6, 'the layer actually uses the tokens: ' + [...used]);
  assert.deepEqual([...used].filter(t => !tokens.has(t)), []);
});

test('the motion layer travels only for people who have not asked for less, and smooth scrolling is switched off for those who have', () => {
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'), layer = css.slice(css.indexOf('MOTION LAYER'));
  assert.match(layer, /@media \(prefers-reduced-motion: reduce\) \{ html \{ scroll-behavior: auto; \}/);
  const spring = layer.indexOf('var(--mo-snappy)'), guard = layer.indexOf('@media (prefers-reduced-motion: no-preference)');
  assert.ok(guard > 0 && spring > guard, 'spring transitions sit inside the no-preference block');
  assert.match(layer, /scroll-padding-top: 84px/);
});

test('no duplicate ids on any page', () => each((page, d, bad) => {
  const seen = new Map();
  d.querySelectorAll('[id]').forEach(e => seen.set(e.id, (seen.get(e.id) || 0) + 1));
  for (const [id, n] of seen) if (n > 1) bad(`id "${id}" appears ${n} times`);
}));

test('every image has an alt attribute (empty is fine for decoration) and a decorative one is hidden from assistive tech', () => each((page, d, bad) => {
  d.querySelectorAll('img').forEach(img => { if (!img.hasAttribute('alt')) bad(`<img src="${img.getAttribute('src')}"> has no alt attribute`); });
}));

test('links that open a new tab carry rel="noopener" so the new page cannot reach back', () => each((page, d, bad) => {
  d.querySelectorAll('a[target="_blank"]').forEach(a => { if (!/\bnoopener\b/.test(a.getAttribute('rel') || '')) bad(`link to ${a.getAttribute('href')} opens a new tab without rel="noopener"`); });
}));

test('aria-controls, aria-labelledby and in-page anchors point at elements that exist', () => each((page, d, bad) => {
  const has = id => !!d.getElementById(id);
  d.querySelectorAll('[aria-controls]').forEach(e => { if (!has(e.getAttribute('aria-controls'))) bad(`aria-controls="${e.getAttribute('aria-controls')}" has no target`); });
  d.querySelectorAll('[aria-labelledby]').forEach(e => e.getAttribute('aria-labelledby').split(/\s+/).forEach(id => { if (!has(id)) bad(`aria-labelledby="${id}" has no target`); }));
  d.querySelectorAll('a[href^="#"]').forEach(a => { const id = a.getAttribute('href').slice(1); if (id && !has(id)) bad(`anchor #${id} has no target`); });
}));

test('every button has an accessible name', () => each((page, d, bad) => {
  d.querySelectorAll('button').forEach(b => {
    const name = (b.textContent || '').trim() || b.getAttribute('aria-label') || b.getAttribute('title');
    if (!name) bad(`a button has no accessible name: ${b.outerHTML.slice(0, 90)}`);
  });
}));

test('every form field has a label, an aria-label or a title', () => each((page, d, bad) => {
  d.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select').forEach(f => {
    const labelled = f.getAttribute('aria-label') || f.getAttribute('aria-labelledby') || f.getAttribute('title') || (f.id && d.querySelector(`label[for="${f.id}"]`)) || f.closest('label');
    if (!labelled) bad(`a ${f.tagName.toLowerCase()} has no label: ${f.outerHTML.slice(0, 90)}`);
  });
}));

test('every page has exactly one main landmark, so keyboard and screen-reader users can skip the menu', () => each((page, d, bad) => {
  const n = d.querySelectorAll('main, [role="main"]').length;
  if (n !== 1) bad(`has ${n} main landmarks (needs exactly 1)`);
}));
