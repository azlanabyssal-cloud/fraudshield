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
