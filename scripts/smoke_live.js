'use strict';
/* Is the deployed site actually working? Fetches the pages and everything they load from a base URL and checks what a visitor would hit:
   every page answers 200 as HTML with its policy and title, every local script, stylesheet, image and font a page names answers, the manifest and its icons, the
   service worker (and, with --expect-cache, that it is the version just built), the one data file the browser fetches, and that the video can be seeked (range request).
     node scripts/smoke_live.js <base-url> [--expect-cache fraudshield-v30]
   Exit 1 lists every failure. It uses nothing but fetch, so the same check runs after a deploy, in a release, and every day against the live site. */
const PAGES = ['index.html', 'tips.html', 'data.html', 'report.html', 'about.html', 'assistant.html'];
const REF = /\b(?:src|href|poster)="([^"#?][^"]*)"/g;
const SKIP = /^(https?:|data:|mailto:|tel:|javascript:)/i;

async function check(base, { expectCache = null, fetchImpl = fetch } = {}) {
  const problems = [], seen = new Set();
  const root = base.endsWith('/') ? base : base + '/';
  const get = async (rel, init) => {
    try { return await fetchImpl(new URL(rel, root), { redirect: 'follow', ...init }); }
    catch (e) { problems.push(`${rel}: ${e.message}`); return null; }
  };
  const ok = async (rel, type, label = rel) => {
    if (seen.has(rel)) return null; seen.add(rel);
    const r = await get(rel); if (!r) return null;
    if (r.status !== 200) { problems.push(`${label}: HTTP ${r.status}`); return null; }
    const ct = r.headers.get('content-type') || '';
    if (type && !type.test(ct)) problems.push(`${label}: content-type "${ct}"`);
    return r;
  };

  for (const page of PAGES) {
    const r = await ok(page, /text\/html/); if (!r) continue;
    const html = await r.text();
    if (!/<title>[^<]{8,}<\/title>/.test(html)) problems.push(`${page}: no title`);
    if (!/http-equiv="Content-Security-Policy"/.test(html)) problems.push(`${page}: no Content-Security-Policy`);
    if (!/logo-mark\.svg/.test(html)) problems.push(`${page}: the mark is missing from the header`);
    for (const m of html.matchAll(REF)) {
      const ref = m[1]; if (SKIP.test(ref)) continue;
      const kind = /\.css$/.test(ref) ? /text\/css/ : /\.js$/.test(ref) ? /javascript/ : /\.(png|webp|jpg|jpeg|svg)$/.test(ref) ? /^image\// : /\.woff2$/.test(ref) ? /font|octet/ : null;
      if (/\.html$/.test(ref) || kind !== null || /\.(json|mp4|vtt)$/.test(ref)) await ok(ref, kind, `${page} -> ${ref}`);
    }
  }
  const man = await ok('manifest.json', /json/);
  if (man) { try { for (const i of (await man.json()).icons) await ok(i.src, /^image\//, 'manifest icon ' + i.src); } catch (e) { problems.push('manifest.json: not JSON'); } }
  const sw = await ok('sw.js', /javascript/);
  if (sw && expectCache) { const t = await sw.text(); if (!t.includes(`'${expectCache}'`)) problems.push(`sw.js: cache name is not ${expectCache} (a stale deploy, or a cached service worker)`); }
  const model = await ok('data/urlmodel.json', /json/);
  if (model) { try { const j = JSON.parse(await model.text()); if (!j || typeof j !== 'object') problems.push('data/urlmodel.json: not an object'); } catch (e) { problems.push('data/urlmodel.json: not JSON'); } }
  const range = await get('media/hang-up-check.mp4', { headers: { Range: 'bytes=0-1023' } });
  if (range) {
    if (range.status !== 206) problems.push(`media/hang-up-check.mp4: a range request answered ${range.status}, not 206 (the video could not be seeked)`);
    else if (!/video\/mp4/.test(range.headers.get('content-type') || '')) problems.push('media/hang-up-check.mp4: wrong content-type');
  }
  return problems;
}

if (require.main === module) {
  const args = process.argv.slice(2), base = args.find(a => /^https?:/.test(a)), at = args.indexOf('--expect-cache');
  if (!base) { console.error('usage: node scripts/smoke_live.js <base-url> [--expect-cache <name>]'); process.exit(2); }
  const t0 = Date.now();
  check(base, { expectCache: at >= 0 ? args[at + 1] : null }).then(p => {
    if (p.length) { console.error(`smoke test FAILED against ${base} (${p.length} problem${p.length === 1 ? '' : 's'}):`); p.forEach(x => console.error('  - ' + x)); process.exit(1); }
    console.log(`smoke test passed against ${base} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }).catch(e => { console.error(e); process.exit(1); });
}
module.exports = { check, PAGES };
