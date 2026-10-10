'use strict';
/* A small Chrome DevTools Protocol client and a static file server, with no packages: Node's own WebSocket, fetch and http.
   It drives a real Chrome so the claims about the page (policy, speech, text reading) are measured in a browser, not assumed.
   Chrome is found from CHROME_PATH, else the usual macOS, Linux and Windows locations. */
const { spawn } = require('node:child_process'), fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const ROOT = path.join(__dirname, '..', '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function chromePath() {
  const c = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'];
  const found = c.find(p => p && fs.existsSync(p));
  if (!found) throw new Error('Chrome not found: set CHROME_PATH');
  return found;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.gz': 'application/gzip', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
// Serves the site folder on a free port. The Content-Security-Policy comes from each page's own <meta> tag, exactly as on the live site.
function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

async function launch({ port = 9300 + Math.floor(Math.random() * 600), width = 1280, height = 800, reducedMotion = false } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-chrome-'));
  const proc = spawn(chromePath(), ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  // a script that ends (or throws) without closing the page must not leave its browser running: a long run of scenarios once left two hundred behind
  process.once('exit', () => { try { proc.kill(); } catch (e) { /* gone */ } });
  let target = null;
  for (let i = 0; i < 80 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); } catch (e) { /* not up yet */ } if (!target) await sleep(250); }
  if (!target) { proc.kill(); throw new Error('Chrome did not start'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl); let id = 0; const pending = new Map(), listeners = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else listeners.forEach(l => l(m)); };
  await new Promise(res => { ws.onopen = res; });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const page = {
    send, sleep, on: fn => listeners.push(fn),
    close: () => { try { ws.close(); } catch (e) { /* already closed */ } proc.kill(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* in use */ } },
    // Evaluates in the page. userGesture makes it count as a click, which Chrome requires before it will speak aloud.
    eval: (expression, { gesture = false, timeout = 120000 } = {}) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout, userGesture: gesture })
      .then(r => { if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text); return r.result.value; }),
    goto: async url => { await send('Page.navigate', { url }); await sleep(2500); }
  };
  for (const d of ['Page', 'Runtime', 'Log', 'Network']) await send(d + '.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }] });
  return page;
}

module.exports = { launch, serve, sleep, chromePath };
