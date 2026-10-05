import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Puts the site's Content-Security-Policy (the same text every page uses today) into each built page. Not in the dev server, whose hot reload needs inline script. */
function csp(): Plugin {
  const policy = readFileSync(resolve(import.meta.dirname, '../partials/csp.txt'), 'utf8').trim();
  return { name: 'fraudshield-csp', apply: 'build', transformIndexHtml: { order: 'post', handler: html => html.replace('<meta charset="UTF-8">', `<meta charset="UTF-8">\n  <meta http-equiv="Content-Security-Policy" content="${policy}">`) } };
}

export default defineConfig({
  plugins: [react(), csp()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', rollupOptions: { input: { assistant: resolve(import.meta.dirname, 'assistant.html') } } },
  server: { fs: { allow: [resolve(import.meta.dirname, '..')] } },
  test: { include: ['src/**/*.test.{ts,tsx}'], environment: 'node', css: false, setupFiles: ['src/test/setup.ts'] }
});
