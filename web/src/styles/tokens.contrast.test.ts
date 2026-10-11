// The design tokens are checked as numbers, not by eye: every text colour on every surface it is used on, in light and in dark, must meet WCAG 2.2 AA
// (4.5:1 for text, 3:1 for the focus ring and other non-text). A token change that breaks reading fails here, before any browser opens.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const css = readFileSync(resolve(import.meta.dirname, 'tokens.css'), 'utf8');
function variables(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1] as string] = (m[2] as string).toLowerCase();
  return out;
}
const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
const light = variables(css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)')));
const themes = { light, dark: { ...light, ...variables(dark) } } as const;

const channel = (v: number): number => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (hex: string): number => { const n = parseInt(hex.slice(1), 16); return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255); };
export const contrast = (a: string, b: string): number => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]; return (hi + 0.05) / (lo + 0.05); };

/** [text token, surface token]: every pairing the stylesheet actually draws. */
const TEXT_ON: readonly (readonly [string, string])[] = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'], ['text-2', 'bg'], ['text-2', 'surface'], ['text-2', 'surface-2'], ['text-3', 'bg'], ['text-3', 'surface'], ['text-3', 'surface-2'],
  ['accent', 'bg'], ['accent', 'surface'], ['accent', 'accent-soft'], ['accent-ink', 'accent'],
  ['header-text', 'header-bg'], ['user-text' in light ? 'user-text' : 'header-text', 'user-bg'],
  ['danger-ink', 'danger-bg'], ['warn-ink', 'warn-bg'], ['neutral-ink', 'neutral-bg'], ['ok-ink', 'ok-bg'],
  ['danger-ink', 'surface'], ['text', 'accent-soft']
];

describe.each(Object.keys(themes) as (keyof typeof themes)[])('%s theme', name => {
  const t = themes[name];
  test.each(TEXT_ON)('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(t[fg], `--${fg} is defined`).toBeDefined(); expect(t[bg], `--${bg} is defined`).toBeDefined();
    expect(contrast(t[fg] as string, t[bg] as string), `${fg} ${t[fg]} on ${bg} ${t[bg]}`).toBeGreaterThanOrEqual(4.5);
  });
  test('the keyboard focus ring is at least 3:1 against every surface it sits on', () => {
    for (const bg of ['bg', 'surface', 'surface-2', 'danger-bg', 'warn-bg', 'neutral-bg', 'ok-bg']) expect(contrast(t.focus as string, t[bg] as string), `focus on ${bg}`).toBeGreaterThanOrEqual(3);
  });
  test('the edge of each result tone is at least 3:1 against the page, so the card is visible without relying on its fill', () => {
    for (const tone of ['danger', 'warn', 'neutral', 'ok']) expect(contrast(t[tone + '-edge'] as string, t.bg as string), tone).toBeGreaterThanOrEqual(3);
  });
});

test('the contrast function agrees with the published reference values', () => {
  expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);   // the well-known 4.5:1 grey
  expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
});
