#!/usr/bin/env node
'use strict';
/* Finds statistics typed by hand into a page: any rupee amount, percentage, crore, lakh, billion or million figure that is
   NOT generated from data/ (data-stat elements and @gen regions are skipped). The tests require every remaining one to be
   listed in docs/numbers-allowlist.json with a reason, so a new hand-typed statistic cannot slip in.
   Usage: node scripts/scan_numbers.js [--json] */
const fs = require('node:fs'), path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PAGES = ['index.html', 'tips.html', 'data.html', 'report.html', 'assistant.html', 'about.html'];
const TOKEN = /₹\s?[\d,]+(?:\.\d+)?(?:\s?(?:Cr|crore|Crore|lakh|Lakh|L)\b)?|\d[\d,]*(?:\.\d+)?\s?%|\d[\d,]*(?:\.\d+)?\s?(?:crore|Crore|lakh|Lakh|billion|million)\b/g;
const decode = s => s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function visibleText(html) {
  html = html.replace(/<!-- @gen:(\w+) -->[\s\S]*?<!-- @\/gen:\1 -->/g, ' ');
  html = html.replace(/<!--[\s\S]*?-->/g, ' ');
  html = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ');
  html = html.replace(/<([a-z0-9]+)\b[^>]*\bdata-stat="[^"]+"[^>]*>[^<]*<\/\1>/g, ' ');
  return decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
}

function scan(html) {
  const text = visibleText(html), out = [];
  for (const m of text.matchAll(TOKEN)) out.push({ token: m[0].replace(/\s+/g, ' ').trim(), context: text.slice(Math.max(0, m.index - 50), m.index + m[0].length + 40) });
  return out;
}

function scanSite(root = ROOT) {
  const found = [];
  for (const page of PAGES) {
    const p = path.join(root, page);
    if (fs.existsSync(p)) for (const hit of scan(fs.readFileSync(p, 'utf8'))) found.push({ page, ...hit });
  }
  return found;
}

module.exports = { scan, scanSite, visibleText, PAGES, TOKEN };

if (require.main === module) {
  const hits = scanSite();
  if (process.argv.includes('--json')) console.log(JSON.stringify(hits, null, 2));
  else hits.forEach(h => console.log(`${h.page.padEnd(15)} ${h.token.padEnd(16)} …${h.context}…`));
  console.error(`${hits.length} hand-typed figure(s)`);
}
