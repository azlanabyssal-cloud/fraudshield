/* Number formatting for Indian audiences. Shared by the site, the build scripts and the tests, so they all produce the same strings.
   No locale APIs: toLocaleString('en-IN') differs between engines. */

// 101928 -> "1,01,928". Groups the last three digits, then pairs.
export function indian(n: number, decimals = 0): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new RangeError('indian() needs a finite number, got ' + String(n));
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(decimals), dot = fixed.indexOf('.');
  const whole = dot < 0 ? fixed : fixed.slice(0, dot), frac = dot < 0 ? '' : fixed.slice(dot);
  let out = whole;
  if (whole.length > 3) out = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + whole.slice(-3);
  return (neg ? '-' : '') + out + frac;
}

// Compact money for a ticking counter, in rupees: 79700 -> "₹79,700", 116000 -> "₹1.16 Lakh", 25000000 -> "₹2.50 Cr".
export function rupeesCompact(rupees: number): string {
  if (!(rupees >= 0)) throw new RangeError('rupeesCompact() needs a non-negative number');
  if (rupees >= 1e7) return '₹' + (rupees / 1e7).toFixed(2) + ' Cr';
  if (rupees >= 1e5) return '₹' + (rupees / 1e5).toFixed(2) + ' Lakh';
  return '₹' + indian(Math.floor(rupees));
}

export const FORMATS = {
  inr_cr: (v: number) => '₹' + indian(v) + ' Cr',
  inr_crore: (v: number) => '₹' + indian(v) + ' Crore',
  inr_cr_tight: (v: number) => '₹' + indian(v) + 'Cr',
  num: (v: number) => indian(v),
  lakh: (v: number) => (v / 1e5).toFixed(2) + ' lakh',
  lakh_title: (v: number) => (v / 1e5).toFixed(2) + ' Lakh',
  lakh_tight: (v: number) => (v / 1e5).toFixed(2) + 'L',
  pct: (v: number) => v + '%',
  bn: (v: number) => v.toFixed(2) + ' billion',
  inr_lakh_crore: (v: number) => '₹' + v.toFixed(2) + ' lakh crore',
  inr: (v: number) => '₹' + indian(v),
  plain: (v: number) => String(v)
} as const;

export type FormatName = keyof typeof FORMATS;
export const isFormatName = (name: string): name is FormatName => Object.prototype.hasOwnProperty.call(FORMATS, name);

// The format name comes from a data file, so it is a string until it is checked.
export function formatStat(value: number, fmt: string): string {
  if (!isFormatName(fmt)) throw new RangeError('unknown format "' + fmt + '"');
  return FORMATS[fmt](value);
}
