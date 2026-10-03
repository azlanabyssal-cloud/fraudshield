'use strict';
/* Loads a real page of the site in jsdom, runs its real scripts, and reports every error.
   Only browser APIs that jsdom does not implement are stubbed; the site's own code is not touched. */
const fs = require('node:fs'), path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');

// The site is served from a fake https origin (so localStorage and relative URLs behave as in production) straight from disk.
// Any other network request (fonts, the CDN chart library, photos) gets an empty reply: tests never touch the internet.
const ORIGIN = 'https://fraudshield.test';
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const offline = requestInterceptor(request => {
  // The real charting library needs a canvas that jsdom does not have, so a recording stand-in is installed instead (see installStubs).
  if (request.url.startsWith(ORIGIN + '/vendor/chart/')) return new Response('', { status: 200, headers: { 'Content-Type': 'application/javascript' } });
  if (request.url.startsWith(ORIGIN + '/')) {
    const file = path.join(ROOT, decodeURIComponent(new URL(request.url).pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('not found', { status: 404 });
    return new Response(fs.readFileSync(file), { status: 200, headers: { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' } });
  }
  if (request.url.startsWith('about:') || request.url.startsWith('data:')) return undefined;
  const type = /\.css(\?|$)|fonts\.googleapis/.test(request.url) ? 'text/css' : /\.js(\?|$)/.test(request.url) ? 'application/javascript' : 'text/plain';
  return new Response('', { status: 200, headers: { 'Content-Type': type } });
});

function installStubs(window, record) {
  window.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.scrollTo = () => {}; window.scroll = () => {};
  window.Element.prototype.scrollIntoView = function () {};
  window.HTMLElement.prototype.focus = window.HTMLElement.prototype.focus || function () {};
  window.IntersectionObserver = class { constructor(cb) { this.cb = cb; record.observers.push(this); } observe(el) { this.last = el; } unobserve() {} disconnect() {} };
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.AudioContext = window.webkitAudioContext = class { constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; } resume() {} createOscillator() { return { connect() {}, start() {}, stop() {}, frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 } }; } createGain() { return { connect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }; } };
  window.speechSynthesis = { getVoices: () => [], speak() {}, cancel() {}, onvoiceschanged: null, addEventListener() {}, speaking: false };
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  Object.defineProperty(window.navigator, 'serviceWorker', { value: { register: () => Promise.resolve({}), addEventListener() {}, ready: Promise.resolve({}) }, configurable: true });
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true });
  window.HTMLCanvasElement.prototype.getContext = () => null;
  // Chart.js comes from a CDN in the page; a recording stand-in lets us check what the site hands it
  window.Chart = class { constructor(canvas, config) { record.charts.push({ id: canvas.id, config }); } };
  window.Chart.defaults = { font: {}, color: '', borderColor: '' };
}

async function loadPage(page, { settle = 400 } = {}) {
  const errors = [], record = { charts: [], observers: [] }, vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.stack || e.message || e)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, page), 'utf8'), {
    url: `${ORIGIN}/${page}`, runScripts: 'dangerously', resources: { interceptors: [offline] }, pretendToBeVisual: true,
    virtualConsole: vc, beforeParse: w => installStubs(w, record)
  });
  await new Promise(res => (dom.window.document.readyState === 'complete' ? res() : dom.window.addEventListener('load', res)));
  await new Promise(res => setTimeout(res, settle));
  return { window: dom.window, document: dom.window.document, errors, record, close: () => dom.window.close() };
}

module.exports = { loadPage, ROOT };
