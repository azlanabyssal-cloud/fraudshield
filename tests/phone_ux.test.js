'use strict';
// The phone is the main screen of the people this site is for. These tests pin how the long pages behave on one: the story is near the top, long lists are shortened
// behind a real button, and a desktop screen is untouched. Layout itself (sizes, overlap) is measured in a real browser by scripts/browser/pages.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { loadPage, ROOT } = require('./helpers/dom.js');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const phone = w => { w.matchMedia = q => ({ matches: /max-width:\s*640px/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }); };

test('the story video follows the tool a worried person came for and precedes the warning it illustrates; the official videos stay below, with their own heading', () => {
  const h = read('index.html'), at = s => { const i = h.indexOf(s); assert.ok(i > 0, s); return i; };
  assert.ok(at('id="sit-sec"') < at('id="story"') && at('id="story"') < at('<!-- PM WARNING -->') && at('<!-- PM WARNING -->') < at('id="awareness-video"'));
  const official = h.slice(at('id="awareness-video"'), at('<!-- LANDMARK CASES -->'));
  assert.ok(!official.includes('<video'), 'the video is not buried in the section of outside links');
  assert.match(h, /<video controls playsinline preload="none"[^>]*poster="images\/video-story-poster\.webp"/);
});

test('on a phone the long lists are shortened behind a button that says what it will show, and the button works', async () => {
  const p = await loadPage('index.html', { setup: phone });
  try {
    const grid = p.document.querySelector('.cases-grid'), btn = grid.nextElementSibling;
    assert.equal(p.errors.length, 0, p.errors.join('\n'));
    assert.ok(btn && btn.classList.contains('more-btn') && !btn.hidden);
    assert.ok(grid.classList.contains('is-collapsed'));
    const total = grid.children.length;
    assert.match(btn.textContent, new RegExp(`Show all ${total} cases`));
    assert.equal(btn.getAttribute('aria-expanded'), 'false'); assert.equal(btn.getAttribute('aria-controls'), grid.id);
    const keep = +grid.dataset.moreKeep;
    assert.ok(keep >= 1 && keep < total, 'it keeps some and hides some');
    assert.equal(grid.querySelectorAll('.more-extra').length, total - keep, `the first ${keep} stay`);
    btn.click();
    assert.ok(!grid.classList.contains('is-collapsed')); assert.equal(btn.getAttribute('aria-expanded'), 'true'); assert.equal(btn.textContent, 'Show fewer');
    btn.click();
    assert.ok(grid.classList.contains('is-collapsed')); assert.equal(btn.getAttribute('aria-expanded'), 'false');
  } finally { p.close(); }
});

test('the goals list on the About page keeps the mapped goals and offers the rest', async () => {
  const p = await loadPage('about.html', { setup: phone });
  try {
    const ul = p.document.querySelector('ul.csp-sdgs'), btn = ul.nextElementSibling;
    assert.equal(p.errors.length, 0, p.errors.join('\n'));
    assert.ok(ul.classList.contains('is-collapsed'));
    const hidden = [...ul.querySelectorAll('.more-extra')];
    assert.ok(hidden.length > 0 && hidden.every(li => !li.classList.contains('csp-sdg--on')), 'only goals that are not mapped are hidden');
    assert.match(btn.textContent, new RegExp(`Show the ${hidden.length} goals not mapped`));
  } finally { p.close(); }
});

test('on a larger screen nothing is shortened and no button is shown', async () => {
  for (const page of ['index.html', 'about.html']) {
    const p = await loadPage(page);
    try {
      assert.equal(p.document.querySelectorAll('.is-collapsed').length, 0, page);
      for (const b of p.document.querySelectorAll('.more-btn')) assert.ok(b.hidden, page + ': the button is hidden');
    } finally { p.close(); }
  }
});

test('without script every item is in the page: the extras are only hidden by a class script adds', () => {
  for (const f of ['index.html', 'about.html']) assert.doesNotMatch(read(f), /more-extra|is-collapsed/, f);
  assert.match(read('style.css'), /\.is-collapsed \.more-extra\s*\{\s*display:\s*none/);
});
