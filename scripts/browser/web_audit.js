'use strict';
/* Audits the built React app (web/dist) in a real Chrome, because a jsdom test has no layout, no colour and no clock:
   - axe-core, including colour contrast, on the page as opened and again with a result card on screen, in light and dark schemes, at desktop and phone width
   - nothing in the console, no Content-Security-Policy violation, no failed request
   - no sideways scrolling at 375 px, every button and link at least 44 px in one direction, the skip link visible on keyboard focus
   - speed: time from pressing Enter to the result card, at full speed and with the CPU slowed 6x (an emulation of a slower phone, not a phone), and first and largest paint
   Run after `npm run web:build`. Exits 1 on any failure. */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { launch, sleep } = require('./cdp.js');

const DIST = path.join(__dirname, '..', '..', 'web', 'dist');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const SCAM = 'Dear customer your SBI account will be blocked today. Update KYC immediately: http://sbi-kyc-update.tk/login';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json' };
const failures = [], notes = [];
const fail = m => failures.push(m);

function serve() {
  const server = http.createServer((req, res) => {
    const SUB = '/fraudshield/';   // served from a sub-path, as on GitHub Pages: an absolute asset URL would 404 here
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!pathname.startsWith(SUB)) { res.writeHead(404); res.end('not found'); return; }
    const rel = pathname.slice(SUB.length) || 'assistant.html';
    const file = path.join(DIST, rel);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

async function type(page, text) {
  await page.eval("document.getElementById('message').focus()");
  await page.send('Input.insertText', { text });
}
const enter = async page => { for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined }); };

async function runAxe(page, label) {
  await page.eval(AXE);
  const r = await page.eval('axe.run(document).then(r => ({ v: r.violations.map(x => ({ id: x.id, impact: x.impact, nodes: x.nodes.map(n => n.target.join(" ") + " :: " + (n.failureSummary || "").split("\\n").slice(1, 3).join(" ")) })), inc: r.incomplete.map(x => ({ id: x.id, n: x.nodes.length })), passes: r.passes.length }))');
  for (const v of r.v) fail(`${label}: axe ${v.id} (${v.impact}): ${v.nodes.slice(0, 3).join(' | ')}`);
  const contrastReview = r.inc.find(x => x.id === 'color-contrast');
  if (contrastReview) notes.push(`${label}: ${contrastReview.n} element(s) axe could not resolve for contrast (text over a translucent or blurred surface); read by hand`);
  return r.passes;
}

async function audit({ scheme, width, height, mobile, throttle }) {
  const label = `${scheme} ${width}px${throttle > 1 ? ` cpu x${throttle}` : ''}`;
  const page = await launch({ width, height, reducedMotion: false });
  const problems = [];
  page.on(m => {
    if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level)) problems.push(`log ${m.params.entry.level}: ${m.params.entry.text} ${m.params.entry.url || ''}`);
    if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) problems.push('console.' + m.params.type + ': ' + m.params.args.map(a => a.value || a.description).join(' '));
    if (m.method === 'Network.loadingFailed' && !m.params.canceled) problems.push('request failed: ' + m.params.errorText);
  });
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  if (throttle > 1) await page.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const out = { label };
  try {
    await page.send('Page.navigate', { url: server.base + '/fraudshield/assistant.html' });
    await page.eval("new Promise(r => { const t = setInterval(() => { if (document.getElementById('message')) { clearInterval(t); r(); } }, 20); })");
    // the domain-name check must load from the sub-path and say so
    const model = await page.eval("new Promise(r => { const t = setInterval(() => { const s = document.documentElement.getAttribute('data-name-model'); if (s === 'ready' || s === 'failed') { clearInterval(t); r(s); } }, 20); setTimeout(() => r(document.documentElement.getAttribute('data-name-model')), 5000); })");
    if (model !== 'ready') fail(`${label}: the domain-name model did not load (status: ${model})`);
    await sleep(300);
    out.paint = await page.eval("new Promise(r => { new PerformanceObserver(l => r(l.getEntries().map(e => [e.name || e.entryType, Math.round(e.startTime)]))).observe({ type: 'largest-contentful-paint', buffered: true }); setTimeout(() => r([]), 1500); }).then(lcp => ({ lcp: lcp.length ? lcp[lcp.length - 1][1] : null, fcp: Math.round((performance.getEntriesByName('first-contentful-paint')[0] || { startTime: 0 }).startTime) }))");
    if (!throttle || throttle === 1) {
      out.axeOpening = await runAxe(page, label + ' (opening)');
      // layout and touch targets
      const lay = await page.eval(`(() => { const small = [...document.querySelectorAll('button, a[href], summary, textarea')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && Math.max(r.width, r.height) < 44 && !e.closest('.sr-only') && !e.classList.contains('skip-link'); }).map(e => (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 30) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)); return { overflow: document.documentElement.scrollWidth - window.innerWidth, small }; })()`);
      if (lay.overflow > 0) fail(`${label}: the page scrolls sideways by ${lay.overflow}px`);
      for (const s of lay.small) fail(`${label}: touch target under 44px: ${s}`);
      // keyboard: the first Tab reaches the skip link and it shows
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      const skip = await page.eval("(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); return { cls: a.className, visible: r.top >= 0 && r.height > 0, outline: getComputedStyle(a).outlineStyle }; })()");
      if (!(skip.cls.includes('skip-link') && skip.visible)) fail(`${label}: the first Tab does not reach a visible skip link (${JSON.stringify(skip)})`);
    }
    // a real turn: type, press Enter, time the result card
    await type(page, SCAM);
    await page.eval("window.__t0 = 0; new MutationObserver((_, o) => { if (document.querySelector('.verdict')) { window.__done = performance.now(); o.disconnect(); } }).observe(document.body, { childList: true, subtree: true }); window.__done = 0; 'armed'");
    await page.eval('window.__t0 = performance.now()');
    await enter(page);
    await page.eval("new Promise(r => { const t = setInterval(() => { if (window.__done) { clearInterval(t); r(); } }, 5); setTimeout(r, 5000); })");
    out.turnMs = await page.eval('Math.round((window.__done - window.__t0) * 10) / 10');
    if (!(out.turnMs > 0)) fail(`${label}: no result card appeared`);
    if (!throttle || throttle === 1) {
      out.axeResult = await runAxe(page, label + ' (result card)');
      const card = await page.eval("(() => { const c = document.querySelector('.verdict'); const q = c && c.querySelector('q'); return { label: c && c.getAttribute('aria-label'), quote: q && q.textContent, hasNote: !!(c && /never means a message is safe/.test(c.textContent)) }; })()");
      if (!(card.label && /scam/i.test(card.label) && card.quote && card.hasNote)) fail(`${label}: the result card is incomplete: ${JSON.stringify(card)}`);
    }
  } finally { page.close(); }
  for (const p of new Set(problems)) fail(`${label}: ${p}`);
  return out;
}

let server;
(async () => {
  if (!fs.existsSync(path.join(DIST, 'assistant.html'))) { console.error('web/dist is missing: run `npm run web:build` first'); process.exit(1); }
  server = await serve();
  const runs = [];
  for (const c of [{ scheme: 'light', width: 1280, height: 800, mobile: false }, { scheme: 'dark', width: 1280, height: 800, mobile: false }, { scheme: 'light', width: 375, height: 812, mobile: true }, { scheme: 'dark', width: 375, height: 812, mobile: true }]) runs.push(await audit({ ...c, throttle: 1 }));
  for (const t of [1, 6]) runs.push(await audit({ scheme: 'light', width: 375, height: 812, mobile: true, throttle: t === 1 ? 2 : 6 }));
  server.close();
  for (const r of runs) console.log(`${r.label.padEnd(22)} fcp ${String(r.paint && r.paint.fcp).padStart(4)} ms  lcp ${String(r.paint && r.paint.lcp).padStart(4)} ms  enter to result card ${String(r.turnMs).padStart(6)} ms${r.axeOpening ? `  axe rules passed ${r.axeOpening}/${r.axeResult}` : ''}`);
  for (const n of notes) console.log('note: ' + n);
  if (failures.length) { for (const f of failures) console.error('FAIL ' + f); process.exit(1); }
  console.log('real Chrome audit ok: no axe violation (including colour contrast), no console or policy error, no sideways scroll, touch targets and keyboard focus fine, light and dark, phone and desktop');
})().catch(e => { console.error(e); if (server) server.close(); process.exit(1); });
