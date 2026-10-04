#!/usr/bin/env node
'use strict';
/* Parses every Mermaid diagram in docs/ARCHITECTURE.md with Mermaid's own parser in a real Chrome (the library comes from a CDN, so this needs the internet and is not part of
   `npm run check`; tests/docs.test.js does the offline structural checks). Usage: npm run audit:docs */
const fs = require('node:fs'), path = require('node:path');
const { launch } = require('./cdp.js');
(async () => {
  const blocks = [...fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'ARCHITECTURE.md'), 'utf8').matchAll(/```mermaid\n([\s\S]*?)```/g)].map(m => m[1]), b = await launch();
  await b.send('Page.navigate', { url: 'about:blank' }); await b.sleep(500);
  const out = JSON.parse(await b.eval(`(async () => { await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js'; s.onload = res; s.onerror = () => rej(new Error('could not load mermaid')); document.head.appendChild(s); }); mermaid.initialize({ startOnLoad: false });
    const r = []; for (const code of ${JSON.stringify(blocks)}) { try { await mermaid.parse(code); r.push('ok'); } catch (e) { r.push(String(e.message || e).slice(0, 200)); } } return JSON.stringify(r); })()`));
  out.forEach((r, i) => console.log(`diagram ${i + 1}: ${r}`)); b.close(); process.exit(out.every(r => r === 'ok') ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
