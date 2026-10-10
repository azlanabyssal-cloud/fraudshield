'use strict';
/* Builds every brand file from brand/mark.json: the SVG marks, the adaptive favicon, the PNG icon set (favicons, app icons, a maskable icon, the Apple touch icon)
   and the 1200 x 630 social card. PNGs are rasterised by real Chrome from the same SVG, so what the browser draws is what is shipped.
   `node scripts/build_brand.js` writes; `--check` rebuilds in memory and fails if a committed SVG differs (PNGs are checked for size by tests/brand.test.js). */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const ROOT = path.join(__dirname, '..'), M = JSON.parse(fs.readFileSync(path.join(ROOT, 'brand', 'mark.json'), 'utf8')), C = M.colors;
const CHECK = process.argv.includes('--check'), OUT = path.join(ROOT, 'icons');

const f = n => String(+n.toFixed(2));
/** The mark as SVG elements. `shield` and `lens` are the colours for the body and the ring. */
const body = (shield, lens, inner) => `<path d="${M.shield}" fill="${shield}"/><circle cx="${f(M.lens.cx)}" cy="${f(M.lens.cy)}" r="${f(M.lens.r)}" fill="${inner || 'none'}" stroke="${lens}" stroke-width="${f(M.lens.width)}"/><path d="${M.handle.d}" stroke="${lens}" stroke-width="${f(M.handle.width)}" stroke-linecap="round" fill="none"/>`;
const svg = (inner, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${M.viewBox} ${M.viewBox}" width="64" height="64" role="img" aria-label="FraudShield"${extra}>${inner}</svg>\n`;

const files = {
  'logo-mark.svg': svg(body(C.navy, C.orange)),                       // on light backgrounds
  'logo-mark-light.svg': svg(body(C.cream, C.orange, C.navy)),        // on dark backgrounds
  'favicon.svg': svg(`<style>.s{fill:${C.navy}}.l{stroke:${C.orange}}.i{fill:none}@media (prefers-color-scheme:dark){.s{fill:${C.cream}}.i{fill:${C.navy}}}</style>` +
    `<path class="s" d="${M.shield}"/><circle class="l i" cx="${f(M.lens.cx)}" cy="${f(M.lens.cy)}" r="${f(M.lens.r)}" stroke-width="${f(M.lens.width)}"/><path class="l" d="${M.handle.d}" stroke-width="${f(M.handle.width)}" stroke-linecap="round" fill="none"/>`)
};

if (CHECK) {
  const bad = Object.entries(files).filter(([n, s]) => !fs.existsSync(path.join(OUT, n)) || fs.readFileSync(path.join(OUT, n), 'utf8') !== s).map(([n]) => n);
  if (bad.length) { console.error('brand files out of date (run `npm run brand:build`): ' + bad.join(', ')); process.exit(1); }
  console.log('brand ok: ' + Object.keys(files).length + ' SVG files match brand/mark.json'); process.exit(0);
}
for (const [n, s] of Object.entries(files)) fs.writeFileSync(path.join(OUT, n), s);

/** The mark with depth, for app icons and the social card: a cream shield lit from above with a soft shadow under it, and a lens that reads as glass (a deep-blue
 *  glass, an orange rim lit from the top left, a small glint). Same geometry as the flat mark, so it is recognisably one logo; the flat one stays for 16-30 px. */
const rich = (id = 'r') => {
  const g = (n) => `${id}-${n}`, L = M.lens, cx = L.cx, cy = L.cy, ri = L.r - L.width / 2 - 0.6;
  const a0 = 200 * Math.PI / 180, a1 = 255 * Math.PI / 180, pt = a => `${f(cx + ri * Math.cos(a))} ${f(cy + ri * Math.sin(a))}`;
  return `<defs>
    <linearGradient id="${g('sh')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#EEE3D0"/></linearGradient>
    <linearGradient id="${g('or')}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFB066"/><stop offset="0.55" stop-color="#FF7A1F"/><stop offset="1" stop-color="#E85D04"/></linearGradient>
    <radialGradient id="${g('gl')}" cx="35%" cy="28%" r="85%"><stop offset="0" stop-color="#2C6AA8"/><stop offset="1" stop-color="#0B1F3A"/></radialGradient>
    <filter id="${g('ds')}" x="-25%" y="-20%" width="150%" height="155%"><feDropShadow dx="0" dy="1.8" stdDeviation="1.7" flood-color="#000" flood-opacity="0.42"/></filter>
  </defs>
  <g filter="url(#${g('ds')})"><path d="${M.shield}" fill="url(#${g('sh')})"/></g>
  <path d="${M.shield}" fill="none" stroke="#fff" stroke-opacity="0.7" stroke-width="0.7"/>
  <circle cx="${f(cx)}" cy="${f(cy)}" r="${f(L.r)}" fill="url(#${g('gl')})" stroke="url(#${g('or')})" stroke-width="${f(L.width)}"/>
  <path d="${M.handle.d}" stroke="url(#${g('or')})" stroke-width="${f(M.handle.width)}" stroke-linecap="round" fill="none"/>
  <path d="M${pt(a0)} A${f(ri)} ${f(ri)} 0 0 1 ${pt(a1)}" stroke="#fff" stroke-opacity="0.6" stroke-width="1.6" stroke-linecap="round" fill="none"/>`;
};

/** An app-icon tile: a deep-navy field, lit from the top, with the rich mark at `scale` of its width. Full-bleed, so a platform may mask it to any shape. */
const tile = (px, scale) => {
  const s = px * scale, o = (px - s) / 2, k = s / M.viewBox;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}"><defs><radialGradient id="bg" cx="50%" cy="30%" r="90%"><stop offset="0" stop-color="#1F4F86"/><stop offset="0.5" stop-color="#0B1F3A"/><stop offset="1" stop-color="#061427"/></radialGradient></defs><rect width="${px}" height="${px}" fill="url(#bg)"/><g transform="translate(${f(o)} ${f(o)}) scale(${f(k)})">${rich('t')}</g></svg>`;
};
const mark32 = (px, bg) => `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${M.viewBox} ${M.viewBox}">${bg ? `<rect width="64" height="64" rx="12" fill="${C.navy}"/>` : ''}<g transform="${bg ? 'translate(8 8) scale(0.75)' : ''}">${body(bg ? C.cream : C.navy, bg ? C.orangeOnDark : C.orange, bg ? C.navy : null)}</g></svg>`;

/** The themed icon (Android 13 and later tints it to the person's wallpaper colours): the shield as a solid shape with the lens cut out, on transparent. Only the
 *  alpha channel is read, so it is black. It sits inside the safe zone so a circular mask never cuts it. */
const mono = px => `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 64 64"><defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><g transform="translate(11.5 11.5) scale(0.64)"><rect width="64" height="64" fill="#000"/><path d="${M.shield}" fill="#fff"/><circle cx="${f(M.lens.cx)}" cy="${f(M.lens.cy)}" r="${f(M.lens.r)}" fill="none" stroke="#000" stroke-width="${f(M.lens.width)}"/><path d="${M.handle.d}" stroke="#000" stroke-width="${f(M.handle.width)}" stroke-linecap="round" fill="none"/></g></mask></defs><rect width="64" height="64" fill="#000" mask="url(#m)"/></svg>`;

const card = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/fonts/fonts.css"><style>
  html,body{margin:0;width:1200px;height:630px;background:${C.navy};color:#fff;font-family:'DM Sans',sans-serif;overflow:hidden}
  .wrap{position:relative;width:1200px;height:630px;padding:72px 84px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between}
  .bar{position:absolute;left:0;top:0;width:1200px;height:10px;background:${C.orange}}
  .brand{display:flex;align-items:center;gap:28px}
  .brand svg{width:168px;height:168px;margin-left:-14px}
  .word{font-family:'Playfair Display',serif;font-weight:900;font-size:104px;letter-spacing:-1px;line-height:1}
  .word b{color:${C.orangeOnDark};font-weight:900}
  h1{margin:0;font-family:'Playfair Display',serif;font-weight:700;font-size:58px;line-height:1.15;max-width:960px}
  .foot{display:flex;justify-content:space-between;align-items:center;gap:40px;font-size:28px;color:#C9D3E3;white-space:nowrap}
  .foot strong{color:#fff}
  .call{background:${C.orange};color:#fff;font-weight:700;padding:14px 30px;border-radius:999px;font-size:34px;white-space:nowrap}
</style><div class="wrap"><div class="bar"></div>
  <div class="brand"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${rich('c')}</svg><div class="word">Fraud<b>Shield</b></div></div>
  <h1>Check a message, a link or a QR code before you act on it.</h1>
  <div class="foot"><span>Checked on your device. Nothing is sent to a server.</span><span class="call">Helpline 1930</span></div></div>`;

const { launch, sleep } = require('./browser/cdp.js');
(async () => {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/card') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(card); return; }
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': { '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await launch({ width: 1200, height: 630 });
  const shot = async (html, w, h, file, transparent = false) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setDefaultBackgroundColorOverride', { color: transparent ? { r: 0, g: 0, b: 0, a: 0 } : { r: 255, g: 255, b: 255, a: 1 } });
    await page.send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${html}`) });
    await sleep(120);
    const r = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, file), Buffer.from(r.data, 'base64'));
  };
  await shot(mark32(16, false), 16, 16, 'favicon-16.png', true);
  await shot(mark32(32, false), 32, 32, 'favicon-32.png', true);
  await shot(mark32(48, false), 48, 48, 'favicon-48.png', true);
  await shot(tile(180, 0.72), 180, 180, 'apple-touch-icon.png');
  await shot(tile(192, 0.72), 192, 192, 'icon-192.png');
  await shot(tile(512, 0.72), 512, 512, 'icon-512.png');
  await shot(tile(512, 0.64), 512, 512, 'icon-maskable-512.png');   // inside the 80% safe circle: a platform may crop to a circle
  await shot(mono(512), 512, 512, 'icon-monochrome-512.png', true);   // themed icons read only its alpha
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.navigate', { url: base + '/card' }); await sleep(900);
  const r = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'og-image.png'), Buffer.from(r.data, 'base64'));
  server.close(); console.log('brand built: ' + Object.keys(files).join(', ') + ', favicon-16/32/48, apple-touch-icon, icon-192, icon-512, icon-maskable-512, icon-monochrome-512, og-image'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
