'use strict';
// Runs every real page and its real scripts in a DOM and fails on any uncaught error.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { loadPage, ROOT } = require('./helpers/dom.js');
const { PAGES } = require('../scripts/scan_numbers.js');

const stats = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/stats.json'), 'utf8'));
const pages = PAGES.filter(p => fs.existsSync(path.join(ROOT, p)));

for (const page of pages) {
  test(`${page} loads and runs with no uncaught errors`, async () => {
    const p = await loadPage(page);
    try {
      assert.deepEqual(p.errors, [], p.errors.join('\n---\n'));
      assert.ok(p.document.querySelector('nav#navbar'), 'nav is present');
      assert.ok(p.document.querySelector('footer'), 'footer is present');
      assert.equal(p.document.querySelectorAll('h1').length, 1, 'exactly one h1');
    } finally { p.close(); }
  });
}

test('the hamburger opens and closes the mobile menu', async () => {
  const p = await loadPage('tips.html');
  try {
    const btn = p.document.getElementById('hamburger'), menu = p.document.getElementById('mobileNav');
    assert.ok(btn && menu); const before = menu.classList.contains('open');
    btn.click(); assert.notEqual(menu.classList.contains('open'), before, 'first click toggles');
    btn.click(); assert.equal(menu.classList.contains('open'), before, 'second click restores');
  } finally { p.close(); }
});

test('the hero scene mounts: bubbles, an x-ray copy with red flags, a lens, and no photo', async () => {
  const p = await loadPage('index.html');
  try {
    const host = p.document.getElementById('heroScene');
    const base = host.querySelectorAll('.hs__field:not(.hs__field--xray) .hs__msg'), xray = host.querySelectorAll('.hs__field--xray .hs__msg');
    assert.ok(base.length >= 3 && base.length === xray.length, 'base and x-ray layers match');
    assert.ok(host.querySelectorAll('.hs__field--xray mark.hs__flag[data-label]').length >= 3, 'red flags are labelled');
    assert.ok(host.querySelector('.hs__lens'), 'lens exists'); assert.equal(host.getAttribute('aria-hidden'), 'true'); assert.equal(host.querySelectorAll('img').length, 0);
    assert.ok(host.style.getPropertyValue('--lr'), 'lens radius was set');
  } finally { p.close(); }
});

test('the data page hands each chart exactly the numbers in the data file', async () => {
  const p = await loadPage('data.html');
  try {
    assert.deepEqual(p.errors, [], p.errors.join('\n'));
    const plain = x => JSON.parse(JSON.stringify(x));   // arrays made inside jsdom belong to another realm
    const byId = Object.fromEntries(p.record.charts.map(c => [c.id, plain(c.config)]));
    const want = (key) => stats.series[key].points.map(pt => stats.stats[pt.stat].value);
    assert.deepEqual(byId.casesChart.data.datasets[0].data, want('ncrb_cases'));
    assert.deepEqual(byId.typeChart.data.datasets[0].data, want('loss_shares_2025'));
    assert.deepEqual(byId.stateChart.data.datasets[0].data, want('states_2024'));
    assert.deepEqual(byId.moneyChart.data.datasets[0].data, want('losses'));
    assert.deepEqual(byId.casesChart.data.labels, ['2021', '2022', '2023', '2024']);
    assert.equal(Object.keys(byId).length, 4);
  } finally { p.close(); }
});

test('the average-loss counter ticks with Indian formatting and the rate from the data file', async () => {
  const p = await loadPage('index.html', { settle: 1300 });
  try {
    const el = p.document.getElementById('costSince');
    assert.equal(Number(el.getAttribute('data-target')), stats.stats.loss_per_second_2025.value);
    assert.match(el.textContent, /^₹[\d,]+$|^₹\d+\.\d{2} (Lakh|Cr)$/, el.textContent);
    assert.ok(!/\d\.\d,000/.test(el.textContent), 'the old "79.7,000" formatting bug must not return');
  } finally { p.close(); }
});
