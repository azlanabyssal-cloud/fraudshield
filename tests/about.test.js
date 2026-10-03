'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { loadPage, ROOT } = require('./helpers/dom.js');
const camp = require('../scripts/campaign_regions.js');
const sync = require('../scripts/sync_site.js');

const clone = o => JSON.parse(JSON.stringify(o));
const data = () => clone(sync.loadData().campaign);
const html = fs.readFileSync(path.join(ROOT, 'about.html'), 'utf8');
const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('campaign figures are counted from the data, never typed', () => {
  const c = data(), f = camp.figures(c);
  assert.deepEqual(f, { weeks: 8, days: 48, gaps: 5, rules: 4, mapped: 8, goals: 17 });
  const nums = camp.renderNumbers(c);
  for (const n of [f.weeks, f.days, f.gaps, f.rules]) assert.ok(nums.includes(`data-count="${n}">${n}</b>`), `number ${n} is rendered`);
  c.gaps.pop(); assert.equal(camp.figures(c).gaps, 4, 'drop a gap and the page number follows');
});

test('a campaign file whose weeks do not join up, or whose counts contradict its dates, stops the build', () => {
  let c = data(); c.weeks[2].from = '2026-05-17'; assert.throws(() => camp.figures(c), /days, not 6|does not start the day after/);
  c = data(); c.weeks[0].days = 7; assert.throws(() => camp.figures(c), /is 6 days, not 7/);
  c = data(); c.weeks[3].n = 9; assert.throws(() => camp.figures(c), /\.n must be 4/);
  c = data(); c.weeks[1].from = '2026-02-30'; assert.throws(() => camp.figures(c), /real YYYY-MM-DD/);
  c = data(); c.end = '2026-06-21'; assert.throws(() => camp.figures(c), /start\/end/);
  c = data(); c.sdgs.pop(); assert.throws(() => camp.figures(c), /1 to 17/);
  c = data(); delete c.weeks[4].did; assert.throws(() => camp.figures(c), /needs did/);
});

test('the headline words on the page agree with the data they describe', () => {
  const f = camp.figures(data());
  assert.ok(text.includes('Eight weeks. No day skipped.') && f.weeks === 8 && f.days === f.weeks * 6);
  assert.ok(text.includes('Five gaps.') && f.gaps === 5);
  assert.ok(text.includes('Eight lines a shopkeeper') && data().rules.golden.length + data().rules.response.length === 8);
  assert.ok(text.includes('4 May to 20 June 2026') && data().start === '2026-05-04' && data().end === '2026-06-20');
});

test('the About page is faithful to the verified report: the people, the place, no invented survey numbers, no family story', () => {
  for (const n of ['Sri V. Suresh', 'Dr. R. Praveen Sam', 'Dr. B. Sreenivasa Reddy', 'Sri P. Subba Reddy Garu', 'G. Pulla Reddy Engineering College', 'Balaji Nagar', 'Ward 39']) assert.ok(text.includes(n), n);
  assert.ok(!/\b(uncle|my family|my father|my mother|scam hit)\b/i.test(text + html.match(/<meta name="description"[^>]*>/)[0]), 'no family story');
  assert.ok(!/\d\s?%/.test(text), 'the report holds no percentages, so the page prints none');
  assert.ok(/not percentages or head-counts/.test(text));
});

test('the two field photos name Shakira aunty and the Balaji Nagar house-to-house outreach, and carry a full-size link', () => {
  const fw = sync.loadData().fieldwork, home = fw.photos.find(p => p.file.includes('home'));
  assert.match(home.caption, /Shakira aunty/); assert.match(home.caption, /house to house/); assert.match(home.caption, /Balaji Nagar/); assert.match(home.alt, /Shakira aunty/);
  assert.equal((html.match(/<a class="fw-open" href="images\/field\/csp-(shop|home)\.webp" data-lightbox/g) || []).length, 2);
  for (const p of fw.photos) assert.ok(html.includes(`href="${p.file}" data-lightbox data-w="${p.width}" data-h="${p.height}"`));
});

/* ---------- the viewer, in a real page ---------- */
function stubObserver(w) {
  w.__seen = [];
  w.IntersectionObserver = class { constructor(cb) { this.cb = cb; w.__seen.push(this); this.els = []; } observe(el) { this.els.push(el); } unobserve() {} disconnect() {} };
}
const press = (w, el, key) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true }));

test('clicking a photo opens it full size with its caption; arrows move between photos; Esc closes and returns focus', async () => {
  const p = await loadPage('about.html', { settle: 300, setup: stubObserver });
  try {
    const { window: w, document: d } = p, links = d.querySelectorAll('a[data-lightbox]'), root = d.querySelector('.lb');
    assert.ok(root && root.hidden, 'the viewer exists and starts closed');
    assert.equal(root.getAttribute('role'), 'dialog'); assert.equal(root.getAttribute('aria-modal'), 'true');
    const ev = new w.MouseEvent('click', { bubbles: true, cancelable: true }); links[1].dispatchEvent(ev);
    assert.ok(ev.defaultPrevented, 'the link does not navigate away'); assert.equal(root.hidden, false);
    assert.equal(d.querySelector('.lb__img').getAttribute('src'), 'images/field/csp-home.webp');
    assert.match(d.querySelector('.lb__cap').textContent, /Shakira aunty/); assert.match(d.querySelector('.lb__cap').textContent, /12:14 pm IST/);
    assert.equal(d.querySelector('.lb__count').textContent, '2 / 2'); assert.ok(d.documentElement.classList.contains('lb-lock'));
    assert.equal(d.querySelector('main').inert, true, 'the page behind is inert while the viewer is open');
    press(w, root, 'ArrowRight'); assert.equal(d.querySelector('.lb__count').textContent, '1 / 2'); assert.match(d.querySelector('.lb__img').src, /csp-shop/);
    press(w, root, 'ArrowLeft'); assert.match(d.querySelector('.lb__img').src, /csp-home/);
    press(w, root, 'Escape'); await new Promise(r => setTimeout(r, 320));
    assert.equal(root.hidden, true); assert.ok(!d.documentElement.classList.contains('lb-lock')); assert.equal(d.querySelector('main').inert, false);
    assert.equal(d.activeElement, links[1], 'focus returns to the photo that was opened');
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('a modified click (open in a new tab) is left to the browser, and Tab stays inside the open viewer', async () => {
  const p = await loadPage('about.html', { settle: 300, setup: stubObserver });
  try {
    const { window: w, document: d } = p, links = d.querySelectorAll('a[data-lightbox]'), root = d.querySelector('.lb');
    const ev = new w.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }); links[0].dispatchEvent(ev);
    assert.ok(!ev.defaultPrevented && root.hidden);
    links[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    const b = [...root.querySelectorAll('button')]; b[b.length - 1].focus(); press(w, b[b.length - 1], 'Tab'); assert.equal(d.activeElement, b[0]);
    b[0].focus(); const sh = new w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }); b[0].dispatchEvent(sh); assert.equal(d.activeElement, b[b.length - 1]);
    root.querySelector('.lb__close').click(); await new Promise(r => setTimeout(r, 320)); assert.ok(root.hidden);
  } finally { p.close(); }
});

test('numbers count up from zero and land exactly on the data value; the rail lights week by week', async () => {
  const p = await loadPage('about.html', { settle: 300, setup: stubObserver });
  try {
    const { window: w, document: d } = p, fire = (el, on = true) => w.__seen.filter(o => o.els.includes(el)).forEach(o => o.cb([{ target: el, isIntersecting: on }]));
    const nums = d.querySelector('.csp-nums'); assert.ok(nums.classList.contains('is-armed'));
    const first = nums.querySelector('b');
    fire(nums); assert.ok(nums.classList.contains('is-in'));
    await new Promise(r => setTimeout(r, 200)); assert.ok(+first.textContent < 8, 'mid-count it is below the target');
    await new Promise(r => setTimeout(r, 2200)); assert.deepEqual([...nums.querySelectorAll('b')].map(b => b.textContent), ['8', '48', '5', '4']);
    const weeks = [...d.querySelectorAll('.csp-week')]; assert.equal(weeks.length, 8); weeks.forEach(li => assert.ok(!li.classList.contains('is-on')));
    fire(weeks[0]); fire(weeks[1]); assert.ok(weeks[0].classList.contains('is-on') && weeks[1].classList.contains('is-on') && !weeks[2].classList.contains('is-on'));
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('under Reduce Motion nothing is hidden and nothing counts: every number and week is simply there', async () => {
  const p = await loadPage('about.html', { settle: 300, setup: w => { stubObserver(w); w.matchMedia = q => ({ matches: /prefers-reduced-motion: reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} }); } });
  try {
    const d = p.document;
    assert.equal(d.querySelectorAll('.is-armed').length, 0, 'nothing is armed to be revealed');
    assert.deepEqual([...d.querySelectorAll('.csp-num b')].map(b => b.textContent), ['8', '48', '5', '4']);
  } finally { p.close(); }
});

test('the published field photos are the whole 4:3 frame at full resolution, and the viewer never crops them', () => {
  const fw = sync.loadData().fieldwork, css = fs.readFileSync(path.join(ROOT, 'about.css'), 'utf8');
  for (const p of fw.photos) { assert.equal(p.width, 1600); assert.equal(p.height, 1200); }
  const lb = css.match(/\.lb__img \{[^}]*\}/)[0]; assert.ok(/object-fit: contain/.test(lb) && !/cover/.test(lb));
});

test('the viewer can go to actual size and back, and resets when you change photo', async () => {
  const p = await loadPage('about.html', { settle: 300, setup: stubObserver });
  try {
    const { window: w, document: d } = p, root = d.querySelector('.lb'), btn = root.querySelector('.lb__zoom');
    d.querySelector('a[data-lightbox]').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(btn.getAttribute('aria-pressed'), 'false'); btn.click();
    assert.ok(root.classList.contains('is-zoom')); assert.equal(btn.getAttribute('aria-pressed'), 'true'); assert.match(btn.getAttribute('aria-label'), /Fit/);
    root.querySelector('.lb__next').click(); assert.ok(!root.classList.contains('is-zoom'), 'a new photo starts fitted');
    root.querySelector('.lb__img').click(); assert.ok(root.classList.contains('is-zoom'), 'clicking the picture also zooms');
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('cards and headings arrive on scroll on the inner pages, and are simply there under Reduce Motion', async () => {
  for (const calm of [false, true]) {
    const p = await loadPage('tips.html', { settle: 300, setup: w => { stubObserver(w); if (calm) w.matchMedia = q => ({ matches: /prefers-reduced-motion: reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} }); } });
    try {
      const d = p.document, cards = d.querySelectorAll('.fraud-card');
      assert.ok(cards.length >= 6);
      if (calm) { assert.ok(!d.documentElement.classList.contains('rv-on')); assert.equal(d.querySelectorAll('.rv').length, 0); }
      else {
        assert.ok(d.documentElement.classList.contains('rv-on')); assert.ok(cards[0].classList.contains('rv') && !cards[0].classList.contains('rv-in'));
        const o = p.window.__seen.find(x => x.els.includes(cards[0])); o.cb([{ target: cards[0], isIntersecting: true, boundingClientRect: { bottom: 100 } }]);
        assert.ok(cards[0].classList.contains('rv-in'));
        o.cb([{ target: cards[1], isIntersecting: false, boundingClientRect: { bottom: -50 } }]); assert.ok(cards[1].classList.contains('rv-in'), 'a card already scrolled past is shown, not left invisible');
      }
      assert.deepEqual(p.errors, []);
    } finally { p.close(); }
  }
});
