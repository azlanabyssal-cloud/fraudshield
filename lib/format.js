(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FraudShieldFormat = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /* Number formatting for Indian audiences. Shared by the browser and Node, so the site, the sync script
     and the tests all produce the same strings. No locale APIs: toLocaleString('en-IN') differs between engines. */

  // 101928 -> "1,01,928". Groups the last three digits, then pairs.
  function indian(n, decimals) {
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new RangeError('indian() needs a finite number, got ' + n);
    const d = decimals || 0, neg = n < 0;
    const fixed = Math.abs(n).toFixed(d), dot = fixed.indexOf('.');
    const whole = dot < 0 ? fixed : fixed.slice(0, dot), frac = dot < 0 ? '' : fixed.slice(dot);
    let out = whole;
    if (whole.length > 3) out = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + whole.slice(-3);
    return (neg ? '-' : '') + out + frac;
  }

  // Compact money for a ticking counter, in rupees: 79700 -> "₹79,700", 116000 -> "₹1.16 Lakh", 25000000 -> "₹2.50 Cr".
  function rupeesCompact(rupees) {
    if (!(rupees >= 0)) throw new RangeError('rupeesCompact() needs a non-negative number');
    if (rupees >= 1e7) return '₹' + (rupees / 1e7).toFixed(2) + ' Cr';
    if (rupees >= 1e5) return '₹' + (rupees / 1e5).toFixed(2) + ' Lakh';
    return '₹' + indian(Math.floor(rupees));
  }

  const FORMATS = {
    inr_cr: v => '₹' + indian(v) + ' Cr',
    inr_crore: v => '₹' + indian(v) + ' Crore',
    inr_cr_tight: v => '₹' + indian(v) + 'Cr',
    num: v => indian(v),
    lakh: v => (v / 1e5).toFixed(2) + ' lakh',
    lakh_title: v => (v / 1e5).toFixed(2) + ' Lakh',
    lakh_tight: v => (v / 1e5).toFixed(2) + 'L',
    pct: v => v + '%',
    bn: v => v.toFixed(2) + ' billion',
    inr_lakh_crore: v => '₹' + v.toFixed(2) + ' lakh crore',
    inr: v => '₹' + indian(v),
    plain: v => String(v)
  };

  function formatStat(value, fmt) {
    const f = FORMATS[fmt];
    if (!f) throw new RangeError('unknown format "' + fmt + '"');
    return f(value);
  }

  return { indian, rupeesCompact, formatStat, FORMATS };
}));
