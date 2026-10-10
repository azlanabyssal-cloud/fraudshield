'use strict';
/* Every control on every page, clicked the way a person clicks it, in a real Chrome, on a phone and on a laptop.
   A click is a real mouse press at the middle of the element, after scrolling it into view, and the element under that point must be the control itself:
   a floating button, a sticky bar or an overlay that covers a control fails here even though `element.click()` would have passed. After each click the result
   is checked (a menu opened, a card hid, a tab showed its chart, a result appeared), and nothing may reach the console as an error.
   It serves what would be published (scripts/assemble_site.js), not the working tree.
     node scripts/browser/clicks.js [--only index] [--phone-only] [--desktop-only] */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const { launch, sleep } = require('./cdp.js');
const A = require('../assemble_site.js');

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.vtt': 'text/vtt', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
function serve(dir) {
  const s = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname), file = path.join(dir, p === '/' ? 'index.html' : p);
    if (!file.startsWith(dir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('no'); return; }
    const buf = fs.readFileSync(file), type = TYPES[path.extname(file)] || 'application/octet-stream', m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (m) { const a = +m[1], b = m[2] ? +m[2] : buf.length - 1; res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${buf.length}`, 'Content-Length': b - a + 1, 'Accept-Ranges': 'bytes' }); res.end(buf.subarray(a, b + 1)); return; }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': buf.length, 'Accept-Ranges': 'bytes' }); res.end(buf);
  });
  return new Promise(r => s.listen(0, '127.0.0.1', () => r({ base: `http://127.0.0.1:${s.address().port}/`, close: () => s.close() })));
}

const SCAM = 'Dear customer your SBI account will be blocked today. Update KYC immediately: http://sbi-kyc-update.tk/login';
const failures = [], tally = { clicks: 0, checks: 0 };
let ctx = '', pg = null;

/** A real click on the n-th visible match: scrolls it to the middle, checks nothing covers it, presses and releases the mouse there. */
async function click(selector, n = 0) {
  const probe = () => pg.eval(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; });
    const e = els[${n}]; if (!e) return JSON.stringify({ found: false, count: els.length });
    e.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, top = document.elementFromPoint(x, y);
    return JSON.stringify({ found: true, x, y, covered: !top || !(e === top || e.contains(top)), by: top ? top.tagName.toLowerCase() + (top.id ? '#' + top.id : '') + (typeof top.className === 'string' && top.className ? '.' + top.className.trim().split(/\\s+/)[0] : '') : 'nothing' });
  })()`).then(JSON.parse);
  // a person waits for a panel that is still sliding; so does this, until the control has held still for two looks
  let g = await probe();
  for (let i = 0; i < 12 && g.found; i++) { await sleep(90); const h = await probe(); const still = h.found && Math.abs(h.x - g.x) < 0.5 && Math.abs(h.y - g.y) < 0.5; g = h; if (still) break; }
  if (!g.found) throw new Error(`nothing visible matches "${selector}"[${n}] (${g.count} visible)`);
  if (g.covered) throw new Error(`"${selector}" is covered by ${g.by} at its centre: a person cannot press it`);
  for (const [type, extra] of [['mouseMoved', {}], ['mousePressed', { button: 'left', clickCount: 1 }], ['mouseReleased', { button: 'left', clickCount: 1 }]]) await pg.send('Input.dispatchMouseEvent', { type, x: g.x, y: g.y, ...extra });
  tally.clicks++; await sleep(120);
}
const val = expr => pg.eval(expr);
async function until(expr, what, ms = 4000) {
  const t0 = Date.now();
  for (;;) { if (await pg.eval(`!!(${expr})`)) { tally.checks++; return; } if (Date.now() - t0 > ms) throw new Error('expected: ' + what); await sleep(60); }
}
async function step(label, fn) { try { await fn(); } catch (e) { failures.push(`${ctx} · ${label}: ${e.message}`); } }
const type = async (sel, text) => pg.eval(`(() => { const t = document.querySelector(${JSON.stringify(sel)}); t.focus(); const proto = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement; Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);

/* ---- what every page has ---- */
async function common(phone, isAssistant) {
  if (phone) await step('the menu opens, lists the pages, and closes', async () => {
    await click('#hamburger'); await until(`document.getElementById('mobileNav').classList.contains('open') && document.getElementById('hamburger').getAttribute('aria-expanded') === 'true'`, 'the menu to open with aria-expanded true');
    await until(`document.querySelectorAll('#mobileNav a').length >= 5`, 'five or more links');
    await click('#hamburger'); await until(`!document.getElementById('mobileNav').classList.contains('open')`, 'the menu to close');
  });
  if (!isAssistant) await step('the assistant button opens a chat that answers a pasted scam message, and closes', async () => {
    await click('#cbFab'); await until(`document.querySelector('.cb-panel--open')`, 'the panel to open');
    await type('#cbInput', SCAM); await click('#cbSend');
    await until(`/scam|suspicious|looks like/i.test(document.querySelector('.cb-panel').innerText)`, 'a verdict in the panel', 8000);
    await click('#cbClose'); await until(`!document.querySelector('.cb-panel--open')`, 'the panel to close');
  });
  await step('the logo goes home, and the home page is usable at once (no intro in the way on a second visit)', async () => {
    await val(`window.__before_logo = true`);
    await click('.nav-logo');
    // a fresh document: the marker set on the old one is gone, and the new one has finished loading
    await until(`window.__before_logo === undefined && document.readyState === 'complete' && (location.pathname.endsWith('index.html') || location.pathname === '/')`, 'the home page to load afresh', 8000);
    await sleep(500);
    await until(`document.documentElement.classList.contains('intro-off') || getComputedStyle(document.getElementById('introOverlay')).display === 'none'`, 'no intro overlay on the second visit', 2000);
    if (phone) { await click('#hamburger'); await until(`document.getElementById('mobileNav').classList.contains('open')`, 'the menu to open straight away on the home page'); }
  });
}

/* ---- page by page ---- */
const PAGES = {
  async index(phone) {
    await step('a situation button shows what to do', async () => {
      const before = await val(`document.body.innerText.length`);
      await click('.sit-btn', 0);
      await until(`document.body.innerText.length > ${before} || document.querySelector('.sit-btn.active, .sit-btn[aria-pressed="true"], [class*="sit-result"]')`, 'the page to show an answer');
    });
    await step('the quiz scores five questions', async () => {
      for (let i = 0; i < 5; i++) {
        await click('.quiz-opt', 2);
        await until(`document.querySelector('.quiz-feedback') && !document.querySelector('.quiz-feedback').hidden && document.activeElement && document.activeElement.classList.contains('quiz-next')`, `the explanation, with focus on the Next button, after question ${i + 1}`);
        await sleep(3300);   // longer than the old timer: the explanation must still be there
        await until(`document.querySelector('.quiz-feedback')`, 'the explanation to stay until the person moves on');
        await click('.quiz-next');
      }
      await until(`document.getElementById('quizResult') && getComputedStyle(document.getElementById('quizResult')).display !== 'none' && /\\d/.test(document.getElementById('quizResult').innerText)`, 'the quiz to show a score', 6000);
    });
    await step('the story plays from a click, and its captions load', async () => {
      await val(`document.getElementById('story').scrollIntoView({ block: 'center', behavior: 'instant' })`); await sleep(300);
      await click('.story__play');
      await until(`(() => { const v = document.querySelector('.story video'); return !v.paused && v.currentTime > 0.3; })()`, 'the video to play', 8000);
      await until(`(() => { const v = document.querySelector('.story video'); return !v.muted && v.volume > 0 && v.webkitAudioDecodedByteCount > 2000; })()`, 'sound to be decoded (not muted, audio bytes decoded)', 6000);
      await until(`(() => { const t = document.querySelector('.story video track').track; t.mode = 'hidden'; return t.cues && t.cues.length >= 5; })()`, 'five or more caption cues to load');
      await val(`document.querySelector('.story video').pause()`);
    });
    await step('the cases show the rest on request (phone) or all at once (laptop)', async () => {
      if (phone) {
        const closed = await val(`document.querySelectorAll('.cases-grid .more-extra').length`);
        await click('.more-btn'); await until(`!document.querySelector('.cases-grid').classList.contains('is-collapsed')`, 'the list to open');
        await until(`document.querySelector('.more-btn').getAttribute('aria-expanded') === 'true'`, 'aria-expanded true'); if (!closed) throw new Error('nothing was hidden');
      } else await until(`document.querySelectorAll('.cases-grid .more-extra').length === 0 || !document.querySelector('.cases-grid').classList.contains('is-collapsed')`, 'all cases visible');
    });
    await step('a share button shares or copies, without an error', async () => { await click('.fviz-share', 0); await sleep(300); });
  },
  async tips() {
    await step('each filter shows only its cards and "All" shows them all', async () => {
      const total = await val(`document.querySelectorAll('.fraud-card').length`);
      for (const cat of ['upi', 'identity', 'app', 'social']) {
        await click(`.filter-btn[data-filter="${cat}"]`);
        await until(`document.querySelector('.filter-btn[data-filter="${cat}"]').getAttribute('aria-pressed') === 'true'`, `${cat} to be pressed`);
        await until(`[...document.querySelectorAll('.fraud-card')].filter(c => c.offsetParent !== null).every(c => c.dataset.category === '${cat}') && [...document.querySelectorAll('.fraud-card')].some(c => c.offsetParent !== null)`, `only ${cat} cards, and at least one`);
      }
      await click('.filter-btn[data-filter="all"]');
      await until(`[...document.querySelectorAll('.fraud-card')].filter(c => c.offsetParent !== null).length === ${total}`, 'all cards back');
    });
    await step('the recovery steps open and close', async () => {
      await click('.accordion-header', 0);
      await until(`document.querySelector('.accordion-header').getAttribute('aria-expanded') === 'true'`, 'step 1 to open');
      await click('.accordion-header', 1);
      await until(`document.querySelectorAll('.accordion-header')[1].getAttribute('aria-expanded') === 'true'`, 'step 2 to open');
      await until(`document.querySelector('.accordion-header').getAttribute('aria-expanded') === 'false'`, 'step 1 to close when step 2 opens (one open at a time)');
      await click('.accordion-header', 1);
      await until(`document.querySelectorAll('.accordion-header')[1].getAttribute('aria-expanded') === 'false'`, 'step 2 to close');
    });
  },
  async data() {
    await step('each tab shows its chart', async () => {
      const tabs = await val(`document.querySelectorAll('.tab-btn').length`);
      for (let i = 0; i < tabs; i++) {
        await click('.tab-btn', i);
        await until(`document.querySelectorAll('.tab-btn')[${i}].classList.contains('active') || document.querySelectorAll('.tab-btn')[${i}].getAttribute('aria-selected') === 'true'`, `tab ${i} to be active`);
        await until(`(() => { const c = [...document.querySelectorAll('canvas')].find(x => x.offsetParent !== null && x.id); return c && c.width > 20 && c.height > 20; })()`, `a drawn chart for tab ${i}`);
      }
    });
    await step('the source table opens', async () => {
      const has = await val(`!!document.querySelector('details > summary')`);
      if (has) { await click('details > summary'); await until(`document.querySelector('details').open`, 'the details to open'); }
    });
  },
  async report() {
    await step('the report is built from the form and copied', async () => {
      await type('#inputName', 'Test Person');
      await val(`(() => { const s = document.getElementById('inputState'); s.selectedIndex = Math.min(2, s.options.length - 1); s.dispatchEvent(new Event('change', { bubbles: true })); const t = document.getElementById('inputType'); t.selectedIndex = Math.min(1, t.options.length - 1); t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await type('#inputAmount', '4999'); await type('#inputBank', 'Test bank'); await type('#inputDescription', 'A caller said my account would be blocked and asked for an OTP.');
      await pg.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});
      const before = await val(`document.getElementById('copyBtn').innerText`);
      await click('#copyBtn');
      await until(`document.getElementById('copyBtn').innerText !== ${JSON.stringify(before)}`, 'the button to confirm that the report was copied');
    });
  },
  async about(phone) {
    await step('a field photo opens full size, steps on, and closes with Escape', async () => {
      await click('.fw-photo, .fw-photo img, figure.fw-photo button, [data-lightbox]', 0);
      await until(`document.querySelector('.lb') && !document.querySelector('.lb').hidden && getComputedStyle(document.querySelector('.lb')).display !== 'none'`, 'the viewer to open');
      await pg.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }); await pg.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
      await pg.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await pg.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await until(`!document.querySelector('.lb') || document.querySelector('.lb').hidden || getComputedStyle(document.querySelector('.lb')).display === 'none'`, 'Escape to close the viewer');
    });
    if (phone) await step('the unmapped goals show on request', async () => {
      await click('.more-btn'); await until(`!document.querySelector('ul.csp-sdgs').classList.contains('is-collapsed')`, 'the goals to open');
    });
  },
  async assistant() {
    await step('a suggested topic answers', async () => {
      const before = await val(`document.querySelectorAll('.cb-msg, .cb-bubble, [class*="cb-msg"]').length`);
      await click('.cb-chip', 0);
      await until(`document.querySelectorAll('.cb-msg, .cb-bubble, [class*="cb-msg"]').length > ${before}`, 'a reply to the topic', 6000);
    });
    await step('a pasted message gets a verdict', async () => {
      await type('#cbInput', SCAM); await click('#cbSend');
      await until(`/scam|suspicious|looks like/i.test(document.querySelector('.cb-messages, .log, main').innerText)`, 'a verdict', 8000);
    });
    await step('the main menu returns to the topics', async () => { await click('#cbMenuBtn'); await until(`document.querySelectorAll('.cb-chip').length >= 5`, 'the topic chips'); });
  }
};

(async () => {
  const args = process.argv.slice(2), only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-clicks-')); A.assemble(site);
  const srv = await serve(site);
  const sizes = [['phone 390x844', 390, 844, true], ['laptop 1280x800', 1280, 800, false]].filter(s => !(args.includes('--phone-only') && !s[3]) && !(args.includes('--desktop-only') && s[3]));
  for (const [name, w, h, phone] of sizes) for (const pageName of Object.keys(PAGES)) {
    if (only && only !== pageName) continue;
    ctx = `${pageName} · ${name}`;
    pg = await launch({ width: w, height: h });
    await pg.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: phone });
    const errs = []; pg.on(m => {
      if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) errs.push(`http ${m.params.response.status}: ${m.params.response.url.replace(/^https?:\/\/[^/]+\//, '')}`);
      // Chrome itself rejects a cross-document view transition on some navigations ("Transition was aborted because of invalid state"); no script of the site uses the API
      // (git grep startViewTransition finds nothing) and nothing is visible to the person, so that one message is not counted. Any other exception is.
      if (m.method === 'Runtime.exceptionThrown') { const d = (m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text; if (!/Transition was aborted because of invalid state/.test(d)) errs.push('exception: ' + d); }
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/Failed to load resource/i.test(m.params.entry.text)) errs.push('console: ' + m.params.entry.text.slice(0, 160));
    });
    await pg.send('Page.navigate', { url: srv.base + pageName + '.html' }); await sleep(1500);
    if (pageName === 'index') await step('the entrance is skipped at once by a tap, and the page is then usable', async () => {
      await until(`document.getElementById('introOverlay') && getComputedStyle(document.getElementById('introOverlay')).display !== 'none'`, 'the entrance to play on a first visit');
      const t0 = Date.now(); await click('#introOverlay');
      await until(`getComputedStyle(document.getElementById('introOverlay')).display === 'none' || getComputedStyle(document.getElementById('introOverlay')).opacity === '0'`, 'a tap to skip the entrance', 2500);
      tally.intro = Date.now() - t0; await sleep(900);
    });
    await PAGES[pageName](phone);
    await common(phone, pageName === 'assistant');
    for (const e of new Set(errs)) failures.push(`${ctx} · ${e}`);
    pg.close(); process.stdout.write(`${ctx}: done\n`);
  }
  srv.close(); fs.rmSync(site, { recursive: true, force: true });
  console.log(`${tally.clicks} real clicks, ${tally.checks} outcomes checked${tally.intro ? '; a tap skipped the entrance in ' + tally.intro + ' ms' : ''}`);
  if (failures.length) { console.error(`${failures.length} FAILED:`); failures.forEach(f => console.error('  - ' + f)); process.exit(1); }
  console.log('click-through ok: every control worked, on a phone and a laptop');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
