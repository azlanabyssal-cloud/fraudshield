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

test('a class the page puts on <html> before first paint is used for nothing else: a name that another rule already styles once made the whole document absolutely positioned', () => {
  const gate = read('lib/intro-gate.js');
  const added = [...gate.matchAll(/classList\.add\('([\w-]+)'\)/g)].map(m => m[1]);
  assert.ok(added.length > 0);
  const css = ['style.css', 'motion.css', 'hero-scene.css', 'about.css'].map(read).concat(read('index.html').match(/<style>[\s\S]*?<\/style>/g) || []).join('\n');
  for (const cls of new Set(added)) {
    const rules = css.split('\n').filter(l => new RegExp('\\.' + cls + '(?![\\w-])').test(l));
    assert.ok(rules.length > 0, `${cls} is added but nothing uses it`);
    assert.ok(rules.every(l => new RegExp('^\\s*\\.' + cls + '\\s+\\.intro-overlay\\s*\\{').test(l)), `${cls} is styled by a rule other than one that scopes it to the entrance: ${rules.join(' | ')}`);
  }
});

test('the story keeps its original sound: the file has an audio track, the captions carry the one spoken line, and the page does not claim it is silent', () => {
  const fs2 = require('node:fs'), mp4 = fs2.readFileSync(path.join(ROOT, 'media', 'hang-up-check.mp4'));
  assert.ok(mp4.includes(Buffer.from('mp4a')), 'an AAC audio track (mp4a) is in the file');
  const vtt = read('media/hang-up-check.vtt');
  assert.match(vtt, /Don't worry\. It's gonna be okay\./);
  assert.doesNotMatch(read('index.html'), /no sound|silent/i);
  assert.match(read('index.html'), /with sound/);
  // cues are in order and do not overlap
  const times = [...vtt.matchAll(/(\d\d):(\d\d\.\d{3}) --> (\d\d):(\d\d\.\d{3})/g)].map(m => [+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]]);
  assert.ok(times.length >= 5);
  times.forEach(([a, b], i) => { assert.ok(b > a); if (i) assert.ok(a >= times[i - 1][1], 'cue ' + i + ' starts after the previous one ends'); });
});

test('the assistant page is the private page: nothing on it comes from a third party, and what its heading says about that is true', () => {
  const h = read('assistant.html'), css = read('style.css');
  const rule = css.split('\n').find(l => /\.page-hero__bg--assistant\s*\{/.test(l));
  assert.ok(rule, 'the hero has a rule'); assert.doesNotMatch(rule, /url\(/, 'and it fetches no picture');
  const body = h.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
  assert.doesNotMatch(body, /images\.unsplash\.com|fonts\.googleapis|fonts\.gstatic/);
  assert.doesNotMatch(h, /fonts from Google|photos from Unsplash/i);
  assert.match(h, /page-hero page-hero--compact/, 'the heading leaves room for the chat on a phone');
});

/* ---- the entrance plays every time the home page is loaded ---- */
function runGate({ pathname, store, reduced = false }) {
  const vm = require('node:vm'), fsx = require('node:fs');
  const classes = new Set(), listeners = {}, style = { cssText: '' }, reloads = [];
  const sessionStorage = store === null ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }
    : { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
  const window = { location: { pathname, reload: () => reloads.push(1) }, sessionStorage, matchMedia: () => ({ matches: reduced }), addEventListener: (t, f) => { listeners[t] = f; } };
  const document = { documentElement: { classList: { add: c => classes.add(c), contains: c => classes.has(c) }, style } };
  vm.runInNewContext(fsx.readFileSync(path.join(ROOT, 'lib', 'intro-gate.js'), 'utf8'), { window, document });
  return { classes, listeners, style, reloads };
}

test('the entrance is a part of every load of the home page: the first is the full film, every later one the short cut, and none is skipped', () => {
  const store = {};
  const first = runGate({ pathname: '/fraudshield/', store });
  assert.equal(first.classes.has('intro-short'), false, 'the first entrance in a session is the full film');
  for (const where of ['/fraudshield/', '/fraudshield/index.html', '/']) {   // a reload, the logo from another page, the back button
    const again = runGate({ pathname: where, store });
    assert.equal(again.classes.has('intro-short'), true, where + ': a later entrance is the short cut');
    assert.equal(again.classes.has('intro-off'), false, where + ': it is never switched off');
  }
  const blocked = runGate({ pathname: '/fraudshield/', store: null });
  assert.equal(blocked.classes.has('intro-short'), true, 'with storage blocked it still plays, as the short cut');
});

test('the entrance belongs to the home page: the other pages are left alone, and do not spend it', () => {
  const store = {};
  for (const p of ['/fraudshield/tips.html', '/fraudshield/about.html', '/fraudshield/assistant.html']) {
    const g = runGate({ pathname: p, store });
    assert.equal(g.classes.size, 0, p);
    assert.equal(Object.keys(g.listeners).length, 0, p + ': no listener');
  }
  assert.deepEqual(store, {}, 'a visit to another page does not use up the full film');
  assert.equal(runGate({ pathname: '/fraudshield/', store }).classes.has('intro-short'), false, 'so the first home page after them still gets the full film');
});

test('back and forward: a copy of the home page handed back from the browser\'s store is loaded afresh, behind the navy field, and a normal load is not', () => {
  const g = runGate({ pathname: '/fraudshield/', store: {} });
  assert.equal(typeof g.listeners.pageshow, 'function');
  g.listeners.pageshow({ persisted: false });
  assert.equal(g.reloads.length, 0, 'an ordinary load is left alone');
  g.listeners.pageshow({ persisted: true });
  assert.equal(g.reloads.length, 1, 'a restored copy is reloaded');
  assert.match(g.style.cssText, /background:\s*#0B1F3A/i, 'under the navy field, so no white frame shows between');
  assert.match(g.style.cssText, /visibility:\s*hidden/);
});

test('the entrance never goes missing for anyone: the reduced-motion version is a still frame that lifts, and the stylesheet has no switch that hides it', () => {
  const css = read('index.html').match(/<style>[\s\S]*?<\/style>/g).join('\n');
  assert.doesNotMatch(css, /\.intro-off\b/, 'nothing hides the entrance');
  const media = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\s*\}/.exec(css.slice(css.indexOf('.intro-overlay{')));
  assert.ok(media, 'a reduced-motion block follows the entrance rules');
  assert.match(media[1], /\.intro-title::after\{display:none\}/, 'the name is shown at once');
  assert.match(media[1], /\.intro-shield,\.intro-tag,\.intro-author,\.intro-skip\{animation:none;opacity:1/, 'every line is in place, with nothing moving');
  const home = read('home.js');
  assert.match(home, /prefers-reduced-motion: reduce/, 'and it lifts after a short hold');
  assert.doesNotMatch(home, /addEventListener\(\s*['"]touchstart['"]/, 'a tap is one click, so it cannot fall through to a control under the finger');
});

test('the entrance has no glow, and moves only by opacity and transform', () => {
  const css = read('index.html').match(/<style>[\s\S]*?<\/style>/g).join('\n');
  const block = css.slice(css.indexOf('INTRO — a flat navy field'), css.indexOf('AP-STYLE PREMIUM REFINEMENTS'));
  assert.ok(block.length > 1500, 'found the entrance rules');
  assert.doesNotMatch(block.replace(/\/\*[\s\S]*?\*\//g, ''), /radial-gradient|drop-shadow|text-shadow:[^;]*\d+px|box-shadow|::before|clip-path/, 'no glow, no shadow, no clip-path repaint');
  for (const m of block.matchAll(/@keyframes\s+(intro-[\w-]+)\s*\{([\s\S]*?)\}\s*(?=\n|@|\.)/g)) {
    const props = [...m[2].matchAll(/([a-z-]+)\s*:/g)].map(x => x[1]);
    for (const pr of props) assert.ok(['opacity', 'transform', 'pointer-events'].includes(pr), `${m[1]} animates ${pr}`);
  }
});
