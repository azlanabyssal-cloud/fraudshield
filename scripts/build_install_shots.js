'use strict';
/* The three screenshots Chrome shows in its install dialog (declared in manifest.json), taken from the real pages in a real Chrome at phone size, 2x.
   They are of the site as assembled for publishing, so they cannot show a page that does not ship.   node scripts/build_install_shots.js */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const { launch, sleep } = require('./browser/cdp.js');
const A = require('./assemble_site.js');
const OUT = path.join(__dirname, '..', 'icons', 'install');
const SCAM = 'Dear customer your SBI account will be blocked today. Update KYC immediately: http://sbi-kyc-update.tk/login';
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.mp4': 'video/mp4' };
(async () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-install-')); A.assemble(site);
  const srv = http.createServer((q, s) => { const f = path.join(site, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!f.startsWith(site) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}/`;
  fs.mkdirSync(OUT, { recursive: true });
  const page = await launch({ width: 390, height: 844 });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const shot = async n => { const r = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 84 }); fs.writeFileSync(path.join(OUT, n), Buffer.from(r.data, 'base64')); };
  await page.send('Page.navigate', { url: base + 'assistant.html' }); await sleep(2500);
  await page.eval(`window.scrollTo({ top: 0, behavior: 'instant' })`);
  await shot('assistant.jpg');
  await page.eval(`(() => { const t = document.getElementById('cbInput'); t.value = ${JSON.stringify(SCAM)}; t.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('cbSend').click(); })()`);
  await sleep(3500); await page.eval(`(() => { const m = document.querySelector('.cb-messages'); const v = m && m.querySelector('.cb-msg--verdict, .verdict, [class*="verdict"]'); if (v) v.scrollIntoView({ block: 'start' }); })()`); await sleep(400);
  await shot('result.jpg');
  // the home page: the entrance is spent once any page of the site has been seen, so visit one first, as a person who comes back would
  await page.send('Page.navigate', { url: base + 'report.html' }); await sleep(1200);
  await page.send('Page.navigate', { url: base + 'index.html' }); await sleep(2500);
  await shot('home.jpg');
  page.close(); srv.close(); fs.rmSync(site, { recursive: true, force: true });
  console.log('install screenshots written to icons/install');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
