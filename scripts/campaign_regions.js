'use strict';
/* Renders the About page's campaign sections from data/campaign.json. Every figure shown is counted or computed here, never typed:
   weeks, logged days, gaps and rules are lengths of the lists; the span is the difference of two dates. A file whose weeks do not join up,
   or whose counts disagree with its own dates, stops the build. */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86400000;

function day(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  const t = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  if (!m || +m[2] < 1 || +m[2] > 12 || new Date(t).getUTCDate() !== +m[3]) throw new Error(`campaign date "${iso}" must be a real YYYY-MM-DD date`);
  return t;
}
const short = iso => { const t = new Date(day(iso)); return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`; };

// Throws on anything that would make a number on the page untrue; returns the figures the page shows.
function figures(c) {
  if (!Array.isArray(c.weeks) || !c.weeks.length) throw new Error('campaign.weeks must list the weeks');
  let days = 0, prevEnd = null;
  c.weeks.forEach((w, i) => {
    if (w.n !== i + 1) throw new Error(`campaign.weeks[${i}].n must be ${i + 1}`);
    const a = day(w.from), b = day(w.to), span = (b - a) / DAY + 1;
    if (span !== w.days) throw new Error(`week ${w.n}: ${w.from} to ${w.to} is ${span} days, not ${w.days}`);
    if (prevEnd !== null && a - prevEnd !== DAY) throw new Error(`week ${w.n} does not start the day after week ${w.n - 1} ends`);
    for (const k of ['tag', 'title', 'did']) if (!w[k]) throw new Error(`week ${w.n} needs ${k}`);
    days += w.days; prevEnd = b;
  });
  if (day(c.weeks[0].from) !== day(c.start) || prevEnd !== day(c.end)) throw new Error('campaign start/end must match the first and last week');
  const sdg = c.sdgs.filter(s => s.why);
  if (c.sdgs.length !== 17 || c.sdgs.some((s, i) => s.n !== i + 1)) throw new Error('campaign.sdgs must be goals 1 to 17 in order');
  return { weeks: c.weeks.length, days, gaps: c.gaps.length, rules: c.rules.golden.length, mapped: sdg.length, goals: c.sdgs.length };
}

function renderNumbers(c) {
  const f = figures(c);
  const cell = (n, label) => `  <div class="csp-num" role="listitem"><b data-count="${n}">${n}</b><span>${esc(label)}</span></div>`;
  return `<div class="csp-nums" role="list">\n${[cell(f.weeks, 'weeks in the field'), cell(f.days, 'days in the activity log'), cell(f.gaps, 'gaps found and worked on'), cell(f.rules, 'rules people could repeat back')].join('\n')}\n</div>`;
}

function renderTimeline(c) {
  figures(c);
  const items = c.weeks.map(w => `  <li class="csp-week" style="--i:${w.n - 1}">
    <span class="csp-week__n" aria-hidden="true">${String(w.n).padStart(2, '0')}</span>
    <div class="csp-week__body">
      <p class="csp-week__meta"><span class="csp-week__tag">${esc(w.tag)}</span><span class="csp-week__dates">Week ${w.n} · ${short(w.from)} to ${short(w.to)}</span></p>
      <h3>${esc(w.title)}</h3>
      <p>${esc(w.did)}</p>
    </div>
  </li>`).join('\n');
  return `<ol class="csp-weeks" aria-label="The eight weeks, in order">\n${items}\n</ol>`;
}

function renderGaps(c) {
  figures(c);
  return `<div class="csp-gaps">\n${c.gaps.map((g, i) => `  <article class="csp-gap" style="--i:${i}">
    <span class="csp-gap__n" aria-hidden="true">${i + 1}</span>
    <h3>${esc(g.title)}</h3>
    <p class="csp-gap__saw"><b>What I found.</b> ${esc(g.saw)}</p>
    <p class="csp-gap__did"><b>What we taught.</b> ${esc(g.did)}</p>
  </article>`).join('\n')}\n</div>`;
}

function renderRules(c) {
  figures(c);
  const list = (cls, title, items) => `  <div class="csp-rules__col csp-rules__col--${cls}">
    <h3>${esc(title)}</h3>
    <ol>\n${items.map(r => `      <li><b>${esc(r.name)}.</b> ${esc(r.line)}</li>`).join('\n')}\n    </ol>
  </div>`;
  return `<div class="csp-rules">\n${list('golden', 'Before anything happens', c.rules.golden)}\n${list('response', 'After it has', c.rules.response)}\n</div>`;
}

function renderSdg(c) {
  const f = figures(c);
  const tiles = c.sdgs.map((s, i) => s.why
    ? `  <li class="csp-sdg csp-sdg--on" style="--i:${i}"><b>${s.n}</b><span class="csp-sdg__name">${esc(s.name)}</span><span class="csp-sdg__why">${esc(s.why)}</span></li>`
    : `  <li class="csp-sdg" style="--i:${i}"><b>${s.n}</b><span class="csp-sdg__name">${esc(s.name)}</span></li>`).join('\n');
  return `<p class="csp-sdg__count"><b data-count="${f.mapped}">${f.mapped}</b> of ${f.goals} UN Sustainable Development Goals, as mapped in the college's evidence form</p>\n<ul class="csp-sdgs" aria-label="UN Sustainable Development Goals; ${f.mapped} are mapped to this project">\n${tiles}\n</ul>`;
}

module.exports = { figures, renderNumbers, renderTimeline, renderGaps, renderRules, renderSdg, short, day };
