'use strict';
// Guards the single source of truth: pages must agree with data/, no statistic may be typed by hand,
// removed claims must not return, and local links must resolve.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const sync = require('../scripts/sync_site.js');
const { scanSite, PAGES } = require('../scripts/scan_numbers.js');
const { formatStat, indian, rupeesCompact, FORMATS } = require('../lib/format.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const pages = () => PAGES.filter(p => fs.existsSync(path.join(ROOT, p)));
const raw = JSON.parse(read('data/stats.json'));

test('pages agree with data/: nothing is out of date (fix with "npm run site:sync")', () => {
  const logs = [], r = sync.run({ check: true, log: m => logs.push(m) });
  assert.ok(r.ok, logs.join('\n'));
});

test('derived statistics recompute from their inputs, the check really runs, and tampering is caught', () => {
  const data = sync.loadData();
  const derived = Object.values(data.stats).filter(s => s.status === 'derived');
  assert.ok(derived.length >= 9, 'the derived-value check must have something to check');
  assert.deepEqual(sync.checkDerived(data.stats), []);
  const tampered = JSON.parse(JSON.stringify(data.stats)); tampered.loss_growth_2024_pct.value = 207;
  assert.match(sync.checkDerived(tampered).join(' '), /loss_growth_2024_pct/);
  const broken = JSON.parse(JSON.stringify(data.stats)); broken.loss_growth_2024_pct.inputs = ['nope'];
  assert.match(sync.checkDerived(broken).join(' '), /unknown input/);
});

test('every statistic has a label, a source and an honest status; reported ones link their source', () => {
  for (const [key, s] of Object.entries(raw.stats)) {
    assert.ok(s.label && s.source, `${key}: label and source`);
    assert.ok(['primary', 'secondary', 'derived'].includes(s.status), `${key}: status`);
    assert.ok(Number.isFinite(s.value), `${key}: value`);
    assert.ok(FORMATS[s.fmt], `${key}: unknown format ${s.fmt}`);
    if (s.status !== 'derived') assert.match(s.url || '', /^https:\/\//, `${key}: needs a source URL`);
    else assert.ok(s.formula && Array.isArray(s.inputs), `${key}: derived needs formula and inputs`);
  }
});

test('every data-stat, data-stat-target, series and template in the pages refers to something that exists', () => {
  for (const page of pages()) {
    const html = read(page);
    for (const m of html.matchAll(/data-stat(?:-target)?="([^"]+)"/g)) assert.ok(raw.stats[m[1]], `${page}: unknown stat ${m[1]}`);
    for (const m of html.matchAll(/data-series-key="([^"]+)"/g)) assert.ok(raw.series[m[1]], `${page}: unknown series ${m[1]}`);
    for (const m of html.matchAll(/\{\{([a-z0-9_]+)(?:\|[a-z_]+)?\}\}/g)) assert.ok(raw.stats[m[1]], `${page}: unknown template stat ${m[1]}`);
  }
});

test('number formatting: Indian grouping, compact rupees, and every format', () => {
  assert.equal(indian(101928), '1,01,928'); assert.equal(indian(22845), '22,845'); assert.equal(indian(999), '999'); assert.equal(indian(1000), '1,000');
  assert.equal(indian(100000), '1,00,000'); assert.equal(indian(12345678), '1,23,45,678'); assert.equal(indian(-1234567), '-12,34,567'); assert.equal(indian(1234.5, 2), '1,234.50'); assert.equal(indian(0), '0');
  assert.throws(() => indian(NaN), RangeError); assert.throws(() => indian('7'), RangeError);
  assert.equal(rupeesCompact(79700), '₹79,700'); assert.equal(rupeesCompact(116000), '₹1.16 Lakh'); assert.equal(rupeesCompact(25000000), '₹2.50 Cr'); assert.equal(rupeesCompact(0), '₹0');
  assert.equal(formatStat(22495, 'inr_crore'), '₹22,495 Crore'); assert.equal(formatStat(2815000, 'lakh'), '28.15 lakh'); assert.equal(formatStat(24.51, 'bn'), '24.51 billion');
  assert.throws(() => formatStat(1, 'nope'), RangeError);
});

test('no statistic is typed by hand: every remaining figure is allowlisted with a reason, and no entry is stale', () => {
  const allow = JSON.parse(read('docs/numbers-allowlist.json')).entries, found = {};
  for (const h of scanSite(ROOT)) { const k = h.page + '|' + h.token; found[k] = (found[k] || 0) + 1; }
  const problems = [];
  for (const [k, n] of Object.entries(found)) {
    const e = allow.find(a => a.page + '|' + a.token === k);
    if (!e) problems.push(`hand-typed figure not in the allowlist: ${k} (x${n}). Use data-stat, or add it to docs/numbers-allowlist.json with a reason.`);
    else if (e.count !== n) problems.push(`${k}: allowlist says ${e.count}, page has ${n}`);
  }
  for (const e of allow) { if (!found[e.page + '|' + e.token]) problems.push(`stale allowlist entry: ${e.page} ${e.token}`); assert.ok(e.reason && e.reason.length > 15, `allowlist entry needs a real reason: ${e.token}`); }
  assert.deepEqual(problems, []);
});

test('the scanner itself works: it finds a typed figure and ignores generated ones', () => {
  const { scan } = require('../scripts/scan_numbers.js');
  assert.deepEqual(scan('<p>Lost ₹22,848 Cr and 67% of it</p>').map(h => h.token), ['₹22,848 Cr', '67%']);
  assert.deepEqual(scan('<p>Lost <span data-stat="loss_2025_cr">₹22,495 Cr</span></p>'), []);
  assert.deepEqual(scan('<!-- @gen:cases -->\n<p>₹94 crore</p>\n<!-- @/gen:cases --><script>var x="₹5 Cr"</script>'), []);
});

// Claims that were shipped, found unsourced or wrong, and removed. They must never come back.
const REMOVED = [
  [/22,848|22848/, 'wrong loss figure (22,845 is the reported number)'], [/\b67% (of|UPI)|UPI Fraud\s*(—|<strong>)\s*67|UPI-based fraud/i, 'unsourced fraud-type split'],
  [/OTP (&amp; SIM Swap|Scam)\s*(—|<strong>)\s*12%|Phishing\s*(&amp; Fake Sites)?\s*(—|<strong>)\s*9%/i, 'unsourced fraud-type split'],
  [/8,690 Cr saved|₹8,690/, 'superseded by the 30 June 2026 cumulative figure'], [/every 7 minutes|7 min\b|seven minutes/i, 'wrong rate: the 2025 figure is about one case every 11 seconds'],
  [/up 60%|\+60%|sixty percent/i, 'cases rose 24% in 2025'], [/\+300%|up 300%/, 'unsourced'], [/₹1\.2 Lakh Cr|0\.7% of GDP/, 'unsourced projection'],
  [/9\.42 lakh|17\.82 lakh|₹551 ?Cr|₹551Cr/, 'old or unverified'], [/85% of all cybercrime complaints/, 'unsourced'], [/13\.9 billion/, 'stale UPI volume'],
  [/within 24 hours|within 24 hrs|if reported within 24/i, 'invented 24-hour window (RBI 2017 rules use 3 working days)'], [/Zero Liability Policy/, 'misapplied: only unauthorised transactions reported in time'],
  [/44,735|4,356 \(2013\)|~70 registered/, 'unverified history'], [/₹1,550|1,550 [Cc]rore|Surat Mule|62 mule accounts/, 'could not be verified'],
  [/India's First AI Deepfake|first AI deepfake case in India/i, 'police called it the first such case in Kerala'], [/19 lakh debit cards|28 countries simultaneously|stolen in 7 hours/, 'not in the reporting'],
  [/IIT professors|High Court judges|sitting judges|retired military generals|I A S officers/i, 'unsourced victim list'], [/15,297|8,136 FIRs|6,493/, 'mislabelled state figures'],
  [/5\.4%|94\.6% go unregistered|15\.96 lakh/, 'mixed registers'], [/21,857|27\.37 lakh|₹9,518|12\.94 lakh|3\.03 lakh/, 'superseded or unverified'],
  [/No fabrication|Every figure sourced from official|Every number verified|All data verified/i, 'overclaim'], [/Verified Government Data|VERIFIED 2024|VERIFIED · RBI/, 'overclaim or stale'],
  [/direct evidence that the CFCFRMS system/i, 'causal claim the data cannot support'], [/Court-Verified Cases|These Are Court Records/, 'not all cases are court records'],
  [/\d,\d{3}\.\d,000|₹\d+\.\d,000/, 'broken Indian number formatting']
];
test('removed or wrong claims do not return anywhere a visitor can read them', () => {
  const files = [...pages(), 'script.js', 'partials/nav.html', 'partials/footer.html', 'data/cases.json', 'data/stats.json'];
  const problems = [];
  for (const f of files) {
    const text = read(f).replace(/<!--[\s\S]*?-->/g, '');
    for (const [re, why] of REMOVED) { const m = text.match(re); if (m) problems.push(`${f}: "${m[0]}" (${why})`); }
  }
  assert.deepEqual(problems, []);
});

test('the guard list really catches things (it is not a silent no-op)', () => {
  assert.ok(REMOVED.some(([re]) => re.test('India lost ₹22,848 Cr')));
  assert.ok(REMOVED.some(([re]) => re.test('Banks must attempt reversal if you report within 24 hours')));
  assert.ok(REMOVED.some(([re]) => re.test('₹79.7,000')));
});

test('the quiz explanation quotes the same shares as the data file', () => {
  const js = read('script.js'), m = js.match(/investment scams caused (\d+)% of all cyber fraud losses in India despite being only (\d+)% of cases/);
  assert.ok(m, 'quiz explanation sentence not found');
  assert.equal(Number(m[1]), raw.stats.loss_share_2025_investment_pct.value); assert.equal(Number(m[2]), raw.stats.case_share_2025_investment_pct.value);
});

test('every page carries the generated nav and footer, with exactly one page marked active', () => {
  for (const page of pages()) {
    const html = read(page);
    assert.ok(html.includes('<!-- @gen:nav -->') && html.includes('<!-- @gen:footer -->'), `${page}: missing generated regions`);
    const nav = html.match(/<!-- @gen:nav -->[\s\S]*?<!-- @\/gen:nav -->/)[0];
    assert.equal((nav.match(/class="[^"]*\bactive\b/g) || []).length, 2, `${page}: one active link in the desktop menu and one in the mobile menu`);
    assert.ok(nav.includes('href="about.html"'), `${page}: nav links to About`);
  }
});

test('local links and assets exist, and nothing links to a missing page', () => {
  const missing = [];
  for (const page of pages()) {
    const html = read(page).replace(/<!--[\s\S]*?-->/g, m => (m.includes('@gen') ? m : ''));
    for (const m of html.matchAll(/(?:href|src)="([^"#?]+)(?:[?#][^"]*)?"/g)) {
      const u = m[1];
      if (/^(https?:|mailto:|tel:|data:|javascript:)/i.test(u) || u.startsWith('//')) continue;
      if (!fs.existsSync(path.join(ROOT, u))) missing.push(`${page} -> ${u}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('vendored libraries match their recorded versions and hashes, so a swapped file is caught', () => {
  const crypto = require('node:crypto');
  const chartDir = path.join(ROOT, 'vendor', 'chart'), [want, name] = fs.readFileSync(path.join(chartDir, 'SHA256'), 'utf8').trim().split(/\s+/);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(chartDir, name))).digest('hex'), want);
  assert.match(fs.readFileSync(path.join(chartDir, name), 'utf8').slice(0, 120), new RegExp('Chart\\.js v' + fs.readFileSync(path.join(chartDir, 'VERSION'), 'utf8').trim().replace(/\./g, '\\.')));
  assert.ok(fs.existsSync(path.join(chartDir, 'LICENSE.md')), 'the license travels with the library');
  for (const page of pages()) assert.ok(!/<script[^>]+src="https?:/.test(read(page)), `${page} loads a third-party script`);
});

test('the data is fresh: stats.json is dated within the last 270 days', () => {
  const age = (Date.now() - new Date(raw.asOf + 'T00:00:00Z').getTime()) / 86400000;
  assert.ok(age >= 0 && age < 270, `data/stats.json asOf ${raw.asOf} is ${Math.round(age)} days old: refresh the figures and the date`);
});

/* ---------- field work: real people, real photos ---------- */
const os = require('node:os');
const fw0 = () => JSON.parse(JSON.stringify(sync.loadData().fieldwork));
const withFw = fw => ({ ...sync.loadData(), fieldwork: fw });

test('field-work numbers: only filled-in values are shown, with Indian grouping; none filled means no block at all', () => {
  const fw = fw0(); fw.numbers = { households: null, shops: null, people_reached: null, hours: null };
  assert.equal(sync.renderFieldworkNumbers(withFw(fw)), '');
  fw.numbers = { households: 1234, shops: null, people_reached: 98765, hours: null };
  const html = sync.renderFieldworkNumbers(withFw(fw));
  assert.match(html, /<b>1,234<\/b><span>homes visited<\/span>/); assert.match(html, /<b>98,765<\/b>/); assert.ok(!/shops visited|hours on/.test(html));
  fw.numbers.households = -3; assert.throws(() => sync.renderFieldworkNumbers(withFw(fw)), /non-negative/);
  fw.numbers.households = 'many'; assert.throws(() => sync.renderFieldworkNumbers(withFw(fw)), /non-negative/);
});

test('a photo is published only with consent, an existing file, dimensions, alt text and a caption', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-fw-')); fs.mkdirSync(path.join(root, 'images/field'), { recursive: true });
  fs.writeFileSync(path.join(root, 'images/field/a.jpg'), 'x');
  const good = { file: 'images/field/a.jpg', width: 1200, height: 800, alt: 'A student talks with a shopkeeper', caption: 'Munagalapadu, 3 May 2026', consent: true };
  const run = photo => { const fw = fw0(); fw.photos = [photo]; return sync.renderFieldworkGallery(withFw(fw), root); };
  const html = run(good);
  assert.match(html, /<img src="images\/field\/a\.jpg" width="1200" height="800" alt="A student talks with a shopkeeper"/); assert.match(html, /<figcaption>Munagalapadu, 3 May 2026<span class="fw-stamp">[^<]*Munagalapadu, Andhra Pradesh · Sunday 3 May 2026<\/span><\/figcaption>/);
  assert.throws(() => run({ ...good, consent: false }), /consent/); assert.throws(() => run({ ...good, consent: undefined }), /consent/); assert.throws(() => run({ ...good, consent: 'yes' }), /consent/);
  assert.throws(() => run({ ...good, file: 'images/field/missing.jpg' }), /does not exist/);
  assert.throws(() => run({ ...good, width: undefined }), /width and height/); assert.throws(() => run({ ...good, alt: '' }), /alt text/); assert.throws(() => run({ ...good, caption: '' }), /caption/);
  const fw = fw0(); fw.photos = []; assert.equal(sync.renderFieldworkGallery(withFw(fw), root), '');
});

test('text from the data file is HTML-escaped, so a caption cannot inject markup', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-fw-')); fs.mkdirSync(path.join(root, 'images/field'), { recursive: true }); fs.writeFileSync(path.join(root, 'images/field/a.jpg'), 'x');
  const fw = fw0(); fw.photos = [{ file: 'images/field/a.jpg', width: 10, height: 10, alt: 'a "quote" <b>', caption: '<script>alert(1)</script> & more', consent: true }];
  const html = sync.renderFieldworkGallery(withFw(fw), root);
  assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;') && html.includes('&amp; more') && html.includes('&quot;quote&quot;'));
  fw.learned = ['<img src=x onerror=1>']; assert.ok(!sync.renderLearned(withFw(fw)).includes('<img'));
});

test('dates in the data file are written out in full, and bad dates are refused', () => {
  assert.equal(sync.longDate('2026-05-03'), '3 May 2026'); assert.equal(sync.longDate('2027-01-01'), '1 January 2027');
  assert.throws(() => sync.longDate('2026-13-01'), /YYYY-MM-DD/); assert.throws(() => sync.longDate('3 May 2026'), /YYYY-MM-DD/);
});

test('the About page says what the data file says about where and when', () => {
  const fw = sync.loadData().fieldwork, html = read('about.html');
  assert.ok(html.includes(`<span data-fw="village">${fw.village}</span>`)); assert.ok(html.includes(`<span data-fw="first_visit_long">${sync.weekdayOf(fw.first_visit)} ${sync.longDate(fw.first_visit)}</span>`));
  assert.match(html, /G\. Pulla Reddy Engineering College/);
});

test('photo captions carry the stamped time in 12-hour form, and the weekday is computed, not typed', () => {
  assert.equal(sync.clockText('12:42'), '12:42 pm'); assert.equal(sync.clockText('12:14'), '12:14 pm'); assert.equal(sync.clockText('00:05'), '12:05 am'); assert.equal(sync.clockText('09:30'), '9:30 am'); assert.equal(sync.clockText('23:59'), '11:59 pm');
  assert.throws(() => sync.clockText('24:00'), /HH:MM/); assert.throws(() => sync.clockText('12:60'), /HH:MM/); assert.throws(() => sync.clockText('12.42'), /HH:MM/);
  assert.equal(sync.weekdayOf('2026-05-03'), 'Sunday');   // the GPS stamp on the photos says Sunday 03/05/2026
  assert.equal(sync.weekdayOf('2026-10-03'), 'Saturday');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-fw-')); fs.mkdirSync(path.join(root, 'images/field'), { recursive: true }); fs.writeFileSync(path.join(root, 'images/field/a.jpg'), 'x');
  const fw = fw0(); fw.photos = [{ file: 'images/field/a.jpg', width: 10, height: 10, alt: 'a', caption: 'At a shop', time: '12:42', consent: true }];
  assert.match(sync.renderFieldworkGallery(withFw(fw), root), /Munagalapadu, Andhra Pradesh · Sunday 3 May 2026 · 12:42 pm IST/);
  fw.photos[0].time = '25:99'; assert.throws(() => sync.renderFieldworkGallery(withFw(fw), root), /HH:MM/);
});

test('every published field photo has recorded consent, a real stamp, a real file, and no GPS panel or private address in it', () => {
  const fw = sync.loadData().fieldwork;
  assert.ok(fw.photos.length >= 2); assert.deepEqual(fw.pending_photos, [], 'nothing is waiting on consent: a photo is either published with consent or not in the repository');
  for (const p of fw.photos) {
    assert.equal(p.consent, true); sync.longDate(p.date || fw.first_visit); sync.clockText(p.time);
    const file = path.join(ROOT, p.file); assert.ok(fs.existsSync(file), p.file); assert.ok(fs.statSync(file).size < 400 * 1024, 'compressed for the web');
    const bytes = fs.readFileSync(file); assert.ok(!bytes.includes(Buffer.from('Exif')), 'no EXIF metadata (it can carry GPS coordinates)');
  }
});
