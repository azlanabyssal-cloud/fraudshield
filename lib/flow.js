/* Scroll-driven flow for a numbered sequence ("How criminals trap you in 4 steps"). Progress through the section becomes a leading edge,
   like water running along a channel: the line fills behind it, a droplet rides its front, and each step wakes as the water reaches it.
   The edge is smoothed by a spring so it trails the scroll and glides to rest, which is what makes it read as liquid rather than as a
   progress bar. The maths is pure and tested; mount() only writes CSS variables. Without script or with Reduce Motion, every step is
   simply visible (the stylesheet's default). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FraudShieldFlow = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const LEAD = 0.35;   // a step starts waking this far (in steps) before the water reaches it, and is fully awake this far after
const clamp01 = x => (x > 0 ? (x < 1 ? x : 1) : 0);   // written so that NaN becomes 0 and can never reach a CSS variable
const smooth = t => { const c = clamp01(t); return c * c * (3 - 2 * c); };

// Where the leading edge is, in step units: 0 at the first circle, n-1 at the last; it begins just before the first and ends just after the last.
const front = (p, n) => -LEAD + clamp01(p) * (n - 1 + 2 * LEAD);
// How awake each step is (0..1). The water reaches circle i exactly when its value is 0.5.
const activation = (p, n) => Array.from({ length: n }, (_, i) => smooth((front(p, n) - i + LEAD) / (2 * LEAD)));
// How much of the line (first circle to last) is filled.
const fill = (p, n) => (n > 1 ? clamp01(front(p, n) / (n - 1)) : clamp01(p));
// Scroll position to progress: 0 as the block enters (its top at 85% of the viewport), 1 when its bottom is near 60%.
const progress = (rectTop, rectHeight, viewport) => clamp01((viewport * 0.85 - rectTop) / Math.max(rectHeight + viewport * 0.25, 1));

function mount(grid, env) {
  const Motion = env.Motion, win = env.win;
  if (!Motion || !Motion.engine || Motion.engine.reduced()) return null;
  const steps = Array.from(grid.querySelectorAll('.funnel-step'));
  if (steps.length < 2) return null;
  const n = steps.length, lit = steps.map(() => false);
  const spring = Motion.spring({ response: 0.9, dampingRatio: 1 });   // critical: the water never overshoots its edge

  function paint(p) {
    const s = activation(p, n), f = fill(p, n);
    grid.style.setProperty('--flow', f.toFixed(4));
    grid.style.setProperty('--drop', p > 0.002 && f < 0.999 ? '1' : '0');
    steps.forEach((el, i) => {
      el.style.setProperty('--s', s[i].toFixed(3));
      if (!lit[i] && s[i] > 0.5) { lit[i] = true; el.classList.add('is-lit'); }          // a ripple leaves the circle as the water arrives
      else if (lit[i] && s[i] < 0.35) { lit[i] = false; el.classList.remove('is-lit'); }  // and can ripple again if you scroll back up
    });
  }
  const target = () => { const r = grid.getBoundingClientRect(); return progress(r.top, r.height, win.innerHeight); };
  const follower = Motion.engine.follow([0], spring, v => paint(v[0]), { restDelta: 0.0005, restSpeed: 0.0005 });
  grid.classList.add('flow-armed');
  follower.snap([target()]);     // start where the page already is: reloading halfway down must not replay from zero
  const onMove = () => follower.set([target()]);
  win.addEventListener('scroll', onMove, { passive: true }); win.addEventListener('resize', onMove, { passive: true });
  return { follower, destroy() { win.removeEventListener('scroll', onMove); win.removeEventListener('resize', onMove); follower.stop(); grid.classList.remove('flow-armed'); } };
}

return { LEAD, front, activation, fill, progress, mount };
}));
