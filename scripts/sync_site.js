#!/usr/bin/env node
'use strict';
/* Keeps the pages in step with data/. Nothing statistical is typed into a page by hand any more.
     data-stat="key"         element text becomes the formatted value from data/stats.json (data-fmt overrides the format)
     data-stat-target="key"  the element's data-target (used by the counters) becomes the raw value
     data-series-key="key"   the element gets data-series='{"labels":[...],"values":[...]}' for the charts
     <!-- @gen:nav|footer|cases|creature_<key> --> ... <!-- @/gen:... -->   region regenerated from partials/ or data/cases.json
   Usage: node scripts/sync_site.js [--check]   (--check exits 1 and writes nothing if any page is out of date) */
const fs = require('node:fs'), path = require('node:path');
const { formatStat, indian } = require('../lib/format.js');
const CreatureArt = require('../lib/creature-art.js');
const Campaign = require('./campaign_regions.js');

const ROOT_DEFAULT = path.join(__dirname, '..');
const PAGES = { 'index.html': 'home', 'data.html': 'data', 'tips.html': 'tips', 'assistant.html': 'assistant', 'about.html': 'about', 'report.html': 'report' };

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function loadData(root = ROOT_DEFAULT) {
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  const raw = JSON.parse(read('data/stats.json'));
  if (!raw.stats || !raw.series || !raw.site) throw new Error('data/stats.json needs "stats", "series" and "site"');
  return {
    stats: raw.stats, series: raw.series, site: raw.site, rbi: raw.rbi_directions, cases: JSON.parse(read('data/cases.json')), fieldwork: JSON.parse(read('data/fieldwork.json')), campaign: JSON.parse(read('data/campaign.json')),
    partials: { nav: read('partials/nav.html').trim(), footer: read('partials/footer.html').trim(), csp: read('partials/csp.txt').trim() }
  };
}

function evalFormula(formula, values) {
  const keys = Object.keys(values);
  // formulas live in data/stats.json (trusted, reviewed); they are plain arithmetic over other stats
  return Function(...keys, '"use strict"; const round = Math.round; return (' + formula + ');')(...keys.map(k => values[k]));
}

// A derived stat must equal its formula over its inputs; returns a list of problems.
function checkDerived(stats) {
  const problems = [];
  for (const [key, s] of Object.entries(stats)) {
    if (s.status !== 'derived') continue;
    const vals = {};
    for (const i of s.inputs || []) { if (!stats[i]) { problems.push(`${key}: unknown input ${i}`); continue; } vals[i] = stats[i].value; }
    let got;
    try { got = evalFormula(s.formula, vals); } catch (e) { problems.push(`${key}: formula failed (${e.message})`); continue; }
    if (Math.abs(got - s.value) > 1e-9) problems.push(`${key}: stored ${s.value} but the formula gives ${got}`);
  }
  return problems;
}

function statText(stats, key, fmt) {
  const s = stats[key];
  if (!s) throw new Error(`data-stat refers to unknown stat "${key}"`);
  return formatStat(s.value, fmt || s.fmt);
}

function seriesFor(data, key) {
  const s = data.series[key];
  if (!s) throw new Error(`data-series-key refers to unknown series "${key}"`);
  return { labels: s.points.map(p => p.label), values: s.points.map(p => data.stats[p.stat].value) };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m || +m[2] < 1 || +m[2] > 12) throw new Error(`fieldwork date "${iso}" must be YYYY-MM-DD`);
  return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
}
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function weekdayOf(iso) { longDate(iso); return WEEKDAYS[new Date(iso + 'T00:00:00Z').getUTCDay()]; }
// "12:42" (24-hour, as on a GPS camera stamp) -> "12:42 pm"
function clockText(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm || '');
  if (!m) throw new Error(`time "${hhmm}" must be 24-hour HH:MM`);
  const h = +m[1];
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
}
function fieldworkText(fw, key) {
  if (key === 'first_visit_text') return longDate(fw.first_visit);
  if (key === 'first_visit_long') return `${weekdayOf(fw.first_visit)} ${longDate(fw.first_visit)}`;
  if (!(key in fw) || typeof fw[key] !== 'string') throw new Error(`data-fw refers to unknown field "${key}"`);
  return fw[key];
}

function syncStats(html, data) {
  const { stats } = data;
  html = html.replace(/(<([a-z0-9]+)\b[^>]*\bdata-fw="([^"]+)"[^>]*>)([^<]*)(<\/\2>)/g, (m, open, tag, key, old, close) => open + esc(fieldworkText(data.fieldwork, key)) + close);
  html = html.replace(/(<([a-z0-9]+)\b[^>]*\bdata-stat="([^"]+)"[^>]*>)([^<]*)(<\/\2>)/g, (m, open, tag, key, old, close) => {
    const f = open.match(/data-fmt="([^"]+)"/);
    return open + statText(stats, key, f && f[1]) + close;
  });
  html = html.replace(/<[a-z0-9]+\b[^>]*\bdata-stat-target="([^"]+)"[^>]*>/g, (tag, key) => {
    if (!stats[key]) throw new Error(`data-stat-target refers to unknown stat "${key}"`);
    if (!/data-target="[^"]*"/.test(tag)) throw new Error(`element with data-stat-target="${key}" needs a data-target attribute`);
    return tag.replace(/data-target="[^"]*"/, `data-target="${stats[key].value}"`);
  });
  // <meta data-tpl="India lost {{loss_2025_cr|inr_crore}} ..."> : the content attribute is rendered from the template
  html = html.replace(/<meta\b[^>]*\bdata-tpl="([^"]*)"[^>]*>/g, (tag, tpl) => {
    const text = tpl.replace(/\{\{([a-z0-9_]+)(?:\|([a-z_]+))?\}\}/g, (m, key, fmt) => statText(stats, key, fmt));
    const attr = `content="${esc(text)}"`;
    return /\bcontent="[^"]*"/.test(tag) ? tag.replace(/\bcontent="[^"]*"/, attr) : tag.replace(/data-tpl="[^"]*"/, m => m + ' ' + attr);
  });
  html = html.replace(/<[a-z0-9]+\b[^>]*\bdata-series-key="([^"]+)"[^>]*>/g, (tag, key) => {
    const json = JSON.stringify(seriesFor(data, key)).replace(/'/g, '\\u0027');
    const attr = `data-series='${json}'`;
    return /data-series='[^']*'/.test(tag) ? tag.replace(/data-series='[^']*'/, attr) : tag.replace(/data-series-key="[^"]+"/, m => m + ' ' + attr);
  });
  return html;
}

function renderNav(data, page) {
  return data.partials.nav
    .replace(/\{\{active:(\w+)\}\}/g, (m, p) => (p === page ? ' class="active"' : ''))
    .replace(/\{\{cta:(\w+)\}\}/g, (m, p) => (p === page ? ' active' : ''));
}

function renderFooter(data) {
  return data.partials.footer.replace(/\{\{site\.(\w+)\}\}/g, (m, k) => {
    if (!(k in data.site)) throw new Error(`footer uses unknown site value "${k}"`);
    return esc(data.site[k]);
  });
}

// One policy for every page, from partials/csp.txt. A <meta> policy cannot carry frame-ancestors or report-uri (the browser ignores them
// there), so the policy sticks to what a meta tag can enforce; the referrer policy is set beside it so outbound links carry no address.
function renderCsp(data) {
  const policy = data.partials.csp;
  if (!/default-src 'self'/.test(policy) || /'unsafe-eval'|script-src[^;]*'unsafe-inline'/.test(policy)) throw new Error('partials/csp.txt must keep default-src \'self\' and must allow neither eval nor inline scripts');
  return `<meta http-equiv="Content-Security-Policy" content="${esc(policy)}">\n<meta name="referrer" content="no-referrer">`;
}

function renderCases(data) {
  return data.cases.map((c, i) => {
    const src = c.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join(' · ');
    return `      <div class="case-card case-card--${esc(c.variant)} reveal reveal--d${Math.min(i + 1, 4)}">
        <div class="case-yr">${esc(c.year)}</div>
        <div class="case-body">
          <h3 class="case-title">${esc(c.title)}</h3>
          <p class="case-amt">${esc(c.amount)}</p>
          <p class="case-desc">${esc(c.desc)}</p>
          <span class="case-verdict case-verdict--${esc(c.verdict.variant)}">${esc(c.verdict.text)}</span>
          <p class="case-src">Reported by: ${src}</p>
        </div>
      </div>`;
  }).join('\n');
}

const STATUS_TEXT = { primary: 'Read at the official source', secondary: 'Official figure, reported by named outlets; the official document could not be read', derived: 'Calculated here from other rows' };
function renderSources(data) {
  const rows = Object.entries(data.stats).map(([key, st]) => {
    const src = st.status === 'derived' ? 'Calculated: ' + esc(st.formula.replace(/_/g, ' ')) : (st.url ? `<a href="${esc(st.url)}" target="_blank" rel="noopener">${esc(st.source)}</a>` : esc(st.source));
    return `          <tr><td>${esc(st.label)}</td><td>${statText(data.stats, key)}</td><td>${src}</td><td>${esc(STATUS_TEXT[st.status] || st.status)}</td></tr>`;
  }).join('\n');
  return `<details class="source-table">
        <summary>How sure are we about each number? (${Object.keys(data.stats).length} figures, sources and status)</summary>
        <div class="source-table__wrap"><table>
          <thead><tr><th>Figure</th><th>Value</th><th>Source</th><th>Status</th></tr></thead>
          <tbody>
${rows}
          </tbody>
        </table></div>
        <p class="source-note">Parliamentary replies and the NCRB tables were not machine-readable from here, so "secondary" means the figure was confirmed in at least one named news or analysis page. Different replies sometimes give different counts for the same year; each figure here comes from one source and is not mixed with another.</p>
      </details>`;
}

function renderStates(data) {
  const pts = data.series.states_2024.points, vals = pts.map(p => data.stats[p.stat].value), max = Math.max(...vals);
  return pts.map((p, i) => `      <div class="h-stat"><div class="h-rank h-rank--${i + 1}">${i + 1}</div><div class="h-state"><p class="h-state-name">${esc(p.label)} — ${statText(data.stats, p.stat, 'num')} cases</p><div class="h-bar-wrap"><div class="h-bar" style="width:${Math.round(vals[i] / max * 100)}%"></div></div></div><span class="h-pct">${statText(data.stats, p.share)}</span></div>`).join('\n');
}

// Field-work numbers: only the ones Azlan has filled in. Returns '' (no block at all) when there are none.
function renderFieldworkNumbers(data) {
  const fw = data.fieldwork, items = Object.entries(fw.numbers).filter(([, v]) => v !== null && v !== undefined);
  for (const [k, v] of items) if (!Number.isFinite(v) || v < 0) throw new Error(`fieldwork.numbers.${k} must be a non-negative number`);
  if (!items.length) return '';
  return `<div class="fw-numbers" role="list">\n` + items.map(([k, v]) => `  <div class="fw-num" role="listitem"><b>${indian(v)}</b><span>${esc(fw.number_labels[k] || k)}</span></div>`).join('\n') + '\n</div>';
}

// Photos: consent recorded, file present, size known. Anything else stops the build, so a bad photo can never ship quietly.
function renderFieldworkGallery(data, root) {
  const fw = data.fieldwork;
  if (!fw.photos.length) return '';
  const figs = fw.photos.map((p, i) => {
    const where = `fieldwork.photos[${i}]`;
    if (p.consent !== true) throw new Error(`${where}: consent must be true before a photo of people is published`);
    if (!p.file || !fs.existsSync(path.join(root, p.file))) throw new Error(`${where}: file "${p.file}" does not exist`);
    if (!Number.isInteger(p.width) || !Number.isInteger(p.height)) throw new Error(`${where}: needs integer width and height`);
    if (!p.alt || !p.caption) throw new Error(`${where}: needs alt text and a caption`);
    // the caption states where and when from the photo's own stamp: date defaults to the first visit; time is optional
    const date = p.date || fw.first_visit, stamp = [p.place || fw.village, `${weekdayOf(date)} ${longDate(date)}`, p.time ? `${clockText(p.time)} IST` : null].filter(Boolean).join(' · ');
    // the link is the no-script fallback: without JavaScript it opens the full image itself; the page script turns it into a viewer
    return `  <figure class="fw-photo"><a class="fw-open" href="${esc(p.file)}" data-lightbox data-w="${p.width}" data-h="${p.height}" aria-label="Open the full photo: ${esc(p.alt)}"><img src="${esc(p.file)}" width="${p.width}" height="${p.height}" alt="${esc(p.alt)}" loading="lazy" decoding="async"><span class="fw-open__hint" aria-hidden="true">Tap to open full size</span></a><figcaption>${esc(p.caption)}<span class="fw-stamp">${esc(stamp)}</span></figcaption></figure>`;
  });
  return `<div class="fw-gallery">\n${figs.join('\n')}\n</div>`;
}

function renderLearned(data) {
  const l = data.fieldwork.learned;
  if (!l.length) return '';
  return `<ul class="fw-learned">\n` + l.map(t => `  <li>${esc(t)}</li>`).join('\n') + '\n</ul>';
}

// Cases against money: one row per fraud type, two bars drawn from the same stats the text uses, so the picture cannot disagree with the words.
const SHARE_TYPES = [['Investment fraud', 'investment'], ['Digital arrest', 'digital_arrest'], ['Sextortion', 'sextortion']];
function renderShareBars(data) {
  const rows = SHARE_TYPES.map(([name, k], i) => {
    const c = data.stats[`case_share_2025_${k}_pct`], m = data.stats[`loss_share_2025_${k}_pct`];
    if (!c || !m) throw new Error(`share bars need case_share_2025_${k}_pct and loss_share_2025_${k}_pct`);
    for (const v of [c.value, m.value]) if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error(`share for ${k} must be between 0 and 100`);
    return `  <div class="share-row" style="--i:${i}">
    <p class="share-row__name">${esc(name)}</p>
    <div class="share-track"><span class="share-bar share-bar--cases" style="--w:${c.value}"></span><b>${statText(data.stats, `case_share_2025_${k}_pct`)} of cases</b></div>
    <div class="share-track"><span class="share-bar share-bar--money" style="--w:${m.value}"></span><b>${statText(data.stats, `loss_share_2025_${k}_pct`)} of the money</b></div>
  </div>`;
  }).join('\n');
  return `<div class="share-bars" role="group" aria-label="Share of cases and share of money lost in 2025, by type of fraud">\n${rows}\n</div>`;
}

function syncRegions(html, data, page, root = ROOT_DEFAULT) {
  return html.replace(/<!-- @gen:(\w+) -->[\s\S]*?<!-- @\/gen:\1 -->/g, (m, name) => {
    let body;
    if (name === 'nav') body = renderNav(data, page);
    else if (name === 'footer') body = renderFooter(data);
    else if (name === 'csp') body = renderCsp(data);
    else if (name === 'cases') body = renderCases(data);
    else if (name === 'states') body = renderStates(data);
    else if (name === 'sources') body = renderSources(data);
    else if (name === 'fieldwork_numbers') body = renderFieldworkNumbers(data);
    else if (name === 'fieldwork_gallery') body = renderFieldworkGallery(data, root);
    else if (name === 'fieldwork_learned') body = renderLearned(data);
    else if (name === 'share_bars') body = renderShareBars(data);
    else if (name === 'csp_days') body = Campaign.renderDays(data.campaign);
    else if (name === 'csp_numbers') body = Campaign.renderNumbers(data.campaign);
    else if (name === 'csp_timeline') body = Campaign.renderTimeline(data.campaign);
    else if (name === 'csp_gaps') body = Campaign.renderGaps(data.campaign);
    else if (name === 'csp_rules') body = Campaign.renderRules(data.campaign);
    else if (name === 'csp_sdg') body = Campaign.renderSdg(data.campaign);
    else if (name.startsWith('creature_') && CreatureArt.ART[name.slice(9)]) body = CreatureArt.art(name.slice(9));
    else throw new Error(`unknown generated region "${name}"`);
    return `<!-- @gen:${name} -->\n${body ? body + '\n' : ''}<!-- @/gen:${name} -->`;
  });
}

function syncPage(html, page, data, root = ROOT_DEFAULT) { return syncStats(syncRegions(html, data, page, root), data); }

function run({ root = ROOT_DEFAULT, check = false, log = console.log } = {}) {
  const data = loadData(root), stale = [];
  const problems = checkDerived(data.stats);
  if (!Object.values(data.stats).some(s => s.status === 'derived')) problems.push('no derived stats found: the derived-value check would be checking nothing');
  if (problems.length) { problems.forEach(p => log('derived: ' + p)); return { ok: false, stale, problems }; }
  for (const [file, page] of Object.entries(PAGES)) {
    const p = path.join(root, file);
    if (!fs.existsSync(p)) continue;
    const before = fs.readFileSync(p, 'utf8'), after = syncPage(before, page, data, root);
    if (after !== before) { stale.push(file); if (!check) fs.writeFileSync(p, after); }
  }
  if (check && stale.length) stale.forEach(f => log(`${f}: out of date, run "npm run site:sync"`));
  return { ok: !(check && stale.length), stale, problems };
}

module.exports = { renderShareBars, weekdayOf, clockText, longDate, renderFieldworkNumbers, renderFieldworkGallery, renderLearned, renderSources, renderStates, PAGES, loadData, checkDerived, syncPage, syncStats, syncRegions, renderCases, renderNav, renderFooter, seriesFor, statText, evalFormula, run };

if (require.main === module) {
  const r = run({ check: process.argv.includes('--check') });
  if (!r.ok) process.exit(1);
  if (!process.argv.includes('--check')) console.log(r.stale.length ? `updated: ${r.stale.join(', ')}` : 'already in sync');
}
