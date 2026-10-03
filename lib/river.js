/* Scroll-driven water for any ordered set of things: the weeks of a campaign, the days of a log. It reuses the funnel's maths
   (lib/flow.js: front, activation, fill, progress) and adds what a long vertical rail needs: where the water's edge is, in pixels,
   found by sliding between the centres of the items it is passing. The edge is smoothed by a critically damped spring so it trails the
   scroll and settles without overshooting. mount() only writes CSS variables and one class; without script, or under Reduce Motion, it
   does nothing and the stylesheet's default shows every item fully lit. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./flow.js'));
  else root.FraudShieldRiver = factory(root.FraudShieldFlow);
}(typeof self !== 'undefined' ? self : this, function (Flow) {
'use strict';

const clamp = (x, lo, hi) => (x > lo ? (x < hi ? x : hi) : lo);   // NaN falls through to lo: it can never reach a CSS variable

// Pixel height of the water's edge: slide between the centres (ys) of the items it is between. `front` is the fractional item index.
function headAt(ys, front) {
  const n = ys.length;
  if (!n) return 0;
  const pos = clamp(front, 0, n - 1), i = Math.floor(pos), j = Math.min(i + 1, n - 1);
  return ys[i] + (ys[j] - ys[i]) * (pos - i);
}

function mount(el, opts) {
  const Motion = opts.Motion, win = opts.win;
  if (!Flow || !Motion || !Motion.engine || Motion.engine.reduced()) return null;
  const items = Array.from(opts.items || []);
  if (items.length < 2) return null;
  const n = items.length, lit = items.map(() => false), litClass = opts.litClass || 'is-lit', armedClass = opts.armedClass || 'river-armed';
  let ys = [], litCount = -1, drop = null;   // -1: the first paint always reports, so a readout never keeps its server text
  if (opts.drop) { drop = win.document.createElement('span'); drop.className = 'river-drop'; drop.setAttribute('aria-hidden', 'true'); el.appendChild(drop); }

  const centre = it => (typeof opts.centre === 'function' ? opts.centre(it) : opts.centre || 0);
  const measure = () => { ys = items.map(it => it.offsetTop + centre(it)); };
  function paint(p) {
    const s = Flow.activation(p, n), f = Flow.fill(p, n), head = headAt(ys, Flow.front(p, n));
    el.style.setProperty('--flow', f.toFixed(4));
    el.style.setProperty('--head', head.toFixed(1) + 'px');
    el.style.setProperty('--drop', p > 0.002 && f < 0.999 ? '1' : '0');
    items.forEach((it, i) => {
      it.style.setProperty('--s', s[i].toFixed(3));
      if (!lit[i] && s[i] > 0.5) { lit[i] = true; it.classList.add(litClass); }
      else if (lit[i] && s[i] < 0.35) { lit[i] = false; it.classList.remove(litClass); }
    });
    let now = 0; while (now < n && lit[now]) now++;   // the water is a front, so lit items are a prefix
    if (now !== litCount) { litCount = now; if (opts.onLit) opts.onLit(now, n, items[now - 1] || null); }
  }
  const target = () => { const r = el.getBoundingClientRect(); return Flow.progress(r.top, r.height, win.innerHeight); };
  const spring = Motion.spring({ response: opts.response || 0.9, dampingRatio: 1 });
  const follower = Motion.engine.follow([0], spring, v => paint(v[0]), { restDelta: 0.0005, restSpeed: 0.0005 });
  measure(); el.classList.add(armedClass);
  follower.snap([target()]);   // reloading halfway down the page must not replay from zero
  const onMove = () => follower.set([target()]);
  const onSize = () => { measure(); onMove(); };
  win.addEventListener('scroll', onMove, { passive: true }); win.addEventListener('resize', onSize, { passive: true });
  win.addEventListener('load', onSize);
  return { follower, measure, destroy() { win.removeEventListener('scroll', onMove); win.removeEventListener('resize', onSize); win.removeEventListener('load', onSize); follower.stop(); el.classList.remove(armedClass); if (drop) drop.remove(); } };
}

return { headAt, mount };
}));
