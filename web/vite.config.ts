import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Puts the site's Content-Security-Policy (the same text every page uses today) into each built page. Not in the dev server, whose hot reload needs inline script. */
function csp(): Plugin {
  const policy = readFileSync(resolve(import.meta.dirname, '../partials/csp.txt'), 'utf8').trim();
  return { name: 'fraudshield-csp', apply: 'build', transformIndexHtml: { order: 'post', handler: html => html.replace('<meta charset="UTF-8">', `<meta charset="UTF-8">\n  <meta http-equiv="Content-Security-Policy" content="${policy}">`) } };
}

/** The icons and the manifest already in the repository, served in development and copied into the build, so the app does not keep a second copy of them. */
function staticFiles(entries: Record<string, string>): Plugin {
  const root = resolve(import.meta.dirname, '..');
  const files = (): [string, string][] => Object.entries(entries).flatMap(([to, from]): [string, string][] => {
    const src = resolve(root, from);
    return statSync(src).isDirectory() ? readdirSync(src).map((f): [string, string] => [join(to, f), join(src, f)]) : [[to, src]];
  });
  const TYPES: Record<string, string> = { '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
  return {
    name: 'fraudshield-static',
    generateBundle() { for (const [fileName, src] of files()) this.emitFile({ type: 'asset', fileName, source: readFileSync(src) }); },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const hit = files().find(([to]) => (req.url ?? '').split('?')[0] === '/' + to);
        if (!hit) { next(); return; }
        res.setHeader('Content-Type', TYPES[extname(hit[0])] ?? 'application/octet-stream'); res.end(readFileSync(hit[1]));
      });
    }
  };
}

export default defineConfig({
  // Relative URLs: the site is served from a sub-path on GitHub Pages (/fraudshield/), where absolute ones would 404.
  base: './',
  plugins: [react(), csp(), staticFiles({ icons: 'icons', 'manifest.json': 'manifest.json', 'data/urlmodel.json': 'data/urlmodel.json' })],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', rollupOptions: { input: { assistant: resolve(import.meta.dirname, 'assistant.html') } } },
  server: { fs: { allow: [resolve(import.meta.dirname, '..')] } },
  test: { include: ['src/**/*.test.{ts,tsx}'], environment: 'node', css: false, setupFiles: ['src/test/setup.ts'] }
});
