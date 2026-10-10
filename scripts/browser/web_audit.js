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
const QRCode = require('qrcode'), { PNG } = require('pngjs'), S = require('../../tests/helpers/qrsynth.js');
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

/* Pictures, end to end in the real browser: a readable QR code, a QR code damaged beyond repair, and a screenshot of a scam message read by the real text reader (the vendored WebAssembly engine, from the site's own origin). */
const pngB64 = img => { const p = new PNG({ width: img.width, height: img.height }); p.data = Buffer.from(img.data); return PNG.sync.write(p).toString('base64'); };
async function pictures() {
  const page = await launch({ width: 1280, height: 900 }), problems = [], t = {};
  page.on(m => {
    // The vendored Tesseract engine prints "Parameter not found" for settings its own default config names but this build lacks: the third-party engine's startup chatter,
    // harmless, the only warning allowed here, and only when it comes from the engine's own file.
    const e = m.method === 'Log.entryAdded' ? m.params.entry : null;
    const engineChatter = e !== null && e.level === 'warning' && /^Warning: Parameter not found: /.test(e.text) && /vendor[/]tesseract[/]tesseract-core[\w-]*[.]wasm[.]js$/.test(e.url || '');
    if (e !== null && ['error', 'warning'].includes(e.level) && !engineChatter) problems.push(`log ${e.level}: ${e.text} ${e.url || ''}`);
    if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text));
    if (m.method === 'Network.loadingFailed' && !m.params.canceled) problems.push('request failed: ' + m.params.errorText);
    if (m.method === 'Network.requestWillBeSent' && !m.params.request.url.startsWith(server.base) && !/^(data|blob):/.test(m.params.request.url)) problems.push('request to another origin: ' + m.params.request.url);
  });
  try {
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.send('Page.navigate', { url: server.base + '/fraudshield/assistant.html' });
    await page.eval("new Promise(r => { const t = setInterval(() => { if (document.getElementById('message')) { clearInterval(t); r(); } }, 20); })");
    await page.eval(`window.__upload = async (b64, name) => { const blob = await (await fetch('data:image/png;base64,' + b64)).blob(); const f = new File([blob], name, { type: 'image/png' }); const dt = new DataTransfer(); dt.items.add(f); const i = document.querySelector('input[type=file]'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); };
      window.__shot = async (lines, font = 'Arial, Helvetica, sans-serif', dark = false) => { const c = document.createElement('canvas'); c.width = 1100; c.height = 90 + lines.length * 70; const x = c.getContext('2d'); x.fillStyle = dark ? '#111' : '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = dark ? '#eee' : '#000'; x.font = '40px ' + font; lines.forEach((l, k) => x.fillText(l, 30, 70 + k * 70)); const blob = await new Promise(r => c.toBlob(r, 'image/png')); const b = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const v of b) s += String.fromCharCode(v); return btoa(s); };
      window.__count = sel => document.querySelectorAll(sel).length; window.__text = () => document.querySelector('.log').innerText;
      window.__until = (fn, ms) => new Promise(r => { const t0 = performance.now(), t = setInterval(() => { if (fn() || performance.now() - t0 > ms) { clearInterval(t); r(!!fn()); } }, 50); }); 'ready'`);
    const step = async (name, b64, done, ms = 20000) => {
      const before = await page.eval('window.__count(".verdict")'), t0 = Date.now();
      await page.eval(`window.__upload(${JSON.stringify(b64)}, ${JSON.stringify(name)})`);
      const ok = await page.eval(`window.__until(() => ${done}, ${ms})`);
      t[name] = Date.now() - t0;
      if (!ok) fail(`pictures: "${name}" did not finish: ${String(await page.eval('window.__text()')).slice(-300).replace(/\s+/g, ' ')}`);
      return { before, after: await page.eval('window.__count(".verdict")'), text: await page.eval('window.__text()') };
    };
    // 1. a readable QR code that asks to be paid, as a screenshot would hold it
    const pay = 'upi://pay?pa=refund.desk@ybl&pn=Refund%20Desk&am=4999&cu=INR&tn=claim%20refund';
    const readable = await QRCode.toDataURL(pay, { margin: 4, scale: 8 });
    const a = await step('readable-qr.png', readable.split(',')[1], "/I found a QR code/.test(window.__text()) && window.__count('.verdict') > 0 && !document.querySelector('.progress')");
    if (!a.text.includes('It contains: "upi://pay?pa=refund.desk@ybl')) fail('pictures: the readable QR code was not read back to the person');
    if (a.after !== a.before + 1) fail(`pictures: a readable QR code should give one result card (had ${a.before}, now ${a.after})`);
    // 2. a QR code damaged beyond repair: it must STOP, not fall back to reading words
    const damaged = S.withLogo(S.paint(S.matrix(pay, 'L'), { px: 8 }), 0.34, { shape: 'square' });
    const b = await step('damaged-qr.png', pngB64(damaged), "/cannot read it/.test(window.__text()) && !document.querySelector('.progress')");
    if (!/Do not scan it/.test(b.text)) fail('pictures: the unreadable-QR warning is missing "Do not scan it"');
    if (b.after !== b.before) fail('pictures: an unreadable QR code produced a verdict card (it must only stop)');
    // 3. a screenshot of a scam message: read by the real engine
    const shot = await page.eval(`window.__shot(['Dear customer your SBI account will be', 'blocked today. Update KYC immediately', 'and share your OTP now.'])`);
    const c = await step('scam-screenshot.png', shot, "/what I read from the image/.test(window.__text()) && !document.querySelector('.progress') && window.__count('.verdict') > 0", 120000);
    if (c.after !== c.before + 1) fail(`pictures: the screenshot should give one result card (had ${c.before}, now ${c.after})`);
    const card = await page.eval("(() => { const v = [...document.querySelectorAll('.verdict')].pop(); return { label: v.getAttribute('aria-label'), quotes: [...v.querySelectorAll('q')].map(q => q.textContent) }; })()");
    if (!/scam|suspicious/i.test(card.label || '') || !card.quotes.length) fail('pictures: the screenshot was read but not judged: ' + JSON.stringify(card));
    // 4. a second screenshot is faster: one worker stays hot between pictures
    const shot2 = await page.eval(`window.__shot(['You have won a lottery of Rs 25 lakh.', 'Pay a processing fee to claim your prize.'])`);
    await step('second-screenshot.png', shot2, "window.__count('.verdict') > " + c.after + " && !document.querySelector('.progress')", 120000);
    // 5. the same words in other fonts and on a dark ground (phones screenshot in dark mode): each must be read and judged, never refused as a damaged QR code. Linux CI fonts
    // once turned a plain lottery message into "do not scan it" because the finder took letters for a code.
    let after = (await page.eval('window.__count(".verdict")'));
    for (const [font, dark] of [['Georgia, serif', false], ['Verdana, sans-serif', true], ['"Courier New", monospace', false], ['serif', true], ['sans-serif', false], ['monospace', true], ['Arial, sans-serif', true]]) {
      const img = await page.eval(`window.__shot(['You have won a lottery of Rs 25 lakh.', 'Pay a processing fee to claim your prize.'], ${JSON.stringify(font)}, ${dark})`);
      const r = await step(`text-${font.replace(/\W+/g, '')}-${dark ? 'dark' : 'light'}.png`, img, `window.__count('.verdict') > ${after} && !document.querySelector('.progress')`, 60000);
      if (/Do not scan it/.test(r.text.slice(-400)) && r.after === after) fail(`pictures: plain text in ${font} on a ${dark ? 'dark' : 'light'} ground was refused as a damaged QR code`);
      after = r.after;
    }
    const ops = await page.eval("JSON.parse(sessionStorage.getItem('fs_ops_v1') || '{}')");
    const ocrEvents = (ops.events || []).filter(e => e.kind === 'ocr');
    if (ocrEvents.length < 2 || ocrEvents[0].hot !== false || ocrEvents.slice(1).some(e => e.hot !== true)) fail('pictures: the reader should start cold once and then stay hot: ' + JSON.stringify(ocrEvents));
    notes.push(`pictures: readable QR ${t['readable-qr.png']} ms, damaged QR ${t['damaged-qr.png']} ms (stopped, no verdict), first screenshot read cold in ${t['scam-screenshot.png']} ms, second read hot in ${t['second-screenshot.png']} ms (this Mac, headless Chrome)`);
    const leaked = JSON.stringify(ops);
    if (/Dear customer|SBI account|Update KYC|lakh|processing fee|Refund%20Desk|refund[.]desk|claim%20refund|ybl/.test(leaked)) fail('pictures: the on-device record holds words from a picture');
  } finally { page.close(); }
  for (const p of new Set(problems)) fail('pictures: ' + p);
}

let server;
(async () => {
  if (!fs.existsSync(path.join(DIST, 'assistant.html'))) { console.error('web/dist is missing: run `npm run web:build` first'); process.exit(1); }
  server = await serve();
  const runs = [];
  for (const c of [{ scheme: 'light', width: 1280, height: 800, mobile: false }, { scheme: 'dark', width: 1280, height: 800, mobile: false }, { scheme: 'light', width: 375, height: 812, mobile: true }, { scheme: 'dark', width: 375, height: 812, mobile: true }]) runs.push(await audit({ ...c, throttle: 1 }));
  for (const t of [1, 6]) runs.push(await audit({ scheme: 'light', width: 375, height: 812, mobile: true, throttle: t === 1 ? 2 : 6 }));
  await pictures();
  server.close();
  for (const r of runs) console.log(`${r.label.padEnd(22)} fcp ${String(r.paint && r.paint.fcp).padStart(4)} ms  lcp ${String(r.paint && r.paint.lcp).padStart(4)} ms  enter to result card ${String(r.turnMs).padStart(6)} ms${r.axeOpening ? `  axe rules passed ${r.axeOpening}/${r.axeResult}` : ''}`);
  for (const n of notes) console.log('note: ' + n);
  if (failures.length) { for (const f of failures) console.error('FAIL ' + f); process.exit(1); }
  console.log('real Chrome audit ok: no axe violation (including colour contrast), no console, policy or request error, no sideways scroll, touch targets and keyboard focus fine, light and dark, phone and desktop; the model loads from the sub-path; a readable QR code, an unreadable one and a scam screenshot all behave end to end');
})().catch(e => { console.error(e); if (server) server.close(); process.exit(1); });
