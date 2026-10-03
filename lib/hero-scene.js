(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./motion.js'), require('./motes.js'));
  else root.FraudShieldHeroScene = factory(root.FraudShieldMotion, root.FraudShieldMotes);
}(typeof self !== 'undefined' ? self : this, function (Motion, Motes) {
  'use strict';
  /* "See the unseen": scam messages drift through the dark while a scanning lens reveals the red flags hidden in each.
     The messages are illustrative patterns, not quotes of real messages: domains are invented, no bank or brand is named.
     Pure helpers (MESSAGES, splitByFlags, lensPosition, bubbleCount) are tested in Node; mount() needs a browser. */

  // x, y: position in percent of the hero. d: depth (bigger = nearer: larger, brighter, drifts more).
  const MESSAGES = [
    { who: 'BANK-ALERT', time: '9:41 pm', x: 63, y: 14, d: 1.0, text: 'Dear customer, your KYC expires today. Update now at bankkyc-verify.xyz or your account will be blocked.',
      flags: [['expires today', 'Urgency'], ['bankkyc-verify.xyz', 'Fake-looking link'], ['will be blocked', 'Threat']] },
    { who: 'Unknown number', time: '11:07 am', x: 78, y: 42, d: 1.15, text: 'This is the Cyber Crime Branch. A parcel in your name has illegal items. Stay on this video call. Do not tell anyone.',
      flags: [['Cyber Crime Branch', 'Pretends to be an officer'], ['Stay on this video call', 'Keeps you on the line'], ['Do not tell anyone', 'Secrecy']] },
    { who: 'UPI', time: '2:15 pm', x: 52, y: 66, d: 0.9, text: 'You have a pending payment of ₹5,000. Approve the request in your UPI app to receive it.',
      flags: [['Approve the request', 'Approving pays, never receives']] },
    { who: 'WhatsApp', time: '8:02 am', x: 86, y: 74, d: 0.85, text: 'Part-time job: earn ₹500 per task. Deposit ₹5,000 first to unlock higher earnings.',
      flags: [['Deposit ₹5,000 first', 'Pay to earn?']] },
    { who: 'Group invite', time: '6:30 pm', x: 40, y: 38, d: 0.7, text: 'Join our VIP group. Guaranteed 40% monthly returns. Limited seats.',
      flags: [['Guaranteed 40% monthly returns', 'Guaranteed returns'], ['Limited seats', 'Urgency']] },
    { who: 'POWER-DESK', time: '5:48 pm', x: 70, y: 88, d: 0.75, text: 'Your power will be disconnected tonight at 9:30 pm. Pay ₹10 on this link to avoid disconnection.',
      flags: [['tonight at 9:30 pm', 'Urgency'], ['Pay ₹10 on this link', 'Payment by link']] },
    { who: 'अज्ञात नंबर', time: '10:12 am', x: 47, y: 10, d: 0.6, text: 'आपका केवाईसी आज समाप्त हो रहा है। अभी अपडेट करें, वरना खाता बंद हो जाएगा।',
      flags: [['आज समाप्त हो रहा है', 'जल्दबाज़ी'], ['खाता बंद हो जाएगा', 'धमकी']] },
    { who: 'COURIER', time: '3:26 pm', x: 90, y: 22, d: 0.65, text: 'Your parcel is held at customs. Pay ₹49 to release it: parcel-fee.top/pay',
      flags: [['held at customs', 'Pretends to be an official'], ['parcel-fee.top/pay', 'Fake-looking link']] }
  ];

  // Splits text into [{ text, label? }] so flagged phrases can be wrapped. Flags may not overlap and must occur in the text.
  function splitByFlags(text, flags) {
    const hits = flags.map(([phrase, label]) => {
      const at = text.indexOf(phrase);
      if (at < 0) throw new Error('flag phrase not found in message: "' + phrase + '"');
      return { at, end: at + phrase.length, label };
    }).sort((a, b) => a.at - b.at);
    const out = []; let cursor = 0;
    for (const h of hits) {
      if (h.at < cursor) throw new Error('flags overlap near "' + text.slice(h.at, h.end) + '"');
      if (h.at > cursor) out.push({ text: text.slice(cursor, h.at) });
      out.push({ text: text.slice(h.at, h.end), label: h.label });
      cursor = h.end;
    }
    if (cursor < text.length) out.push({ text: text.slice(cursor) });
    return out;
  }

  // Where the lens is at time t (ms) when nobody is steering it: a slow Lissajous sweep that stays inside the hero.
  function lensPosition(t, w, h, margin) {
    const m = margin === undefined ? Math.min(w, h) * 0.12 : margin;
    const cx = w * 0.64, cy = h * 0.5, ax = Math.max(0, Math.min(w * 0.34, cx - m, w - m - cx)), ay = Math.max(0, Math.min(h * 0.36, cy - m, h - m - cy));
    return { x: cx + ax * Math.sin(t * 0.00031 + 0.8), y: cy + ay * Math.sin(t * 0.00043) };
  }

  // Fewer bubbles on narrow screens and weak devices; the scene must never cost a low-end phone its smoothness.
  function bubbleCount(width, hw) {
    const cores = (hw && hw.cores) || 4, mem = (hw && hw.memory) || 4;
    let n = width < 700 ? 5 : MESSAGES.length;
    if (cores <= 2 || mem <= 2) n = Math.min(n, 4);
    return Math.max(3, Math.min(MESSAGES.length, n));
  }

  /* ---------- browser only ---------- */
  function el(doc, tag, cls, text) {
    const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e;
  }

  function buildField(doc, messages, xray) {
    const field = el(doc, 'div', 'hs__field' + (xray ? ' hs__field--xray' : ''));
    messages.forEach((m, i) => {
      const card = el(doc, 'div', 'hs__msg');
      card.style.setProperty('--x', m.x + '%'); card.style.setProperty('--y', m.y + '%'); card.style.setProperty('--d', m.d);
      card.style.setProperty('--dur', (9 + (i * 1.7) % 6).toFixed(1) + 's'); card.style.setProperty('--delay', (-(i * 2.3) % 9).toFixed(1) + 's');
      card.appendChild(el(doc, 'div', 'hs__who', m.who + ' · ' + m.time));
      const p = el(doc, 'p', 'hs__text');
      splitByFlags(m.text, m.flags).forEach(seg => {
        if (seg.label) { const mk = el(doc, 'mark', 'hs__flag', seg.text); mk.setAttribute('data-label', seg.label); p.appendChild(mk); }
        else p.appendChild(doc.createTextNode(seg.text));
      });
      card.appendChild(p); field.appendChild(card);
    });
    return field;
  }

  function mount(host, opts) {
    const win = host.ownerDocument.defaultView, doc = host.ownerDocument;
    const o = opts || {};
    const reduced = o.reducedMotion !== undefined ? o.reducedMotion : win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nav = win.navigator;
    const count = bubbleCount(win.innerWidth, { cores: nav.hardwareConcurrency, memory: nav.deviceMemory });
    const messages = MESSAGES.slice().sort((a, b) => b.d - a.d).slice(0, count);

    host.textContent = '';
    host.setAttribute('aria-hidden', 'true');
    const aurora = el(doc, 'div', 'hs__aurora'); ['a1', 'a2', 'a3'].forEach(c => aurora.appendChild(el(doc, 'i', c)));
    const base = buildField(doc, messages, false);
    const xray = el(doc, 'div', 'hs__xray'); xray.appendChild(buildField(doc, messages, true));
    const lens = el(doc, 'div', 'hs__lens'); lens.appendChild(el(doc, 'span', 'hs__scan'));
    [aurora, el(doc, 'div', 'hs__grid'), base, xray, lens, el(doc, 'div', 'hs__veil')].forEach(n => host.appendChild(n));
    if (reduced) host.classList.add('hs--still');

    let w = host.clientWidth, h = host.clientHeight, lx = w * 0.7, ly = h * 0.5, tx = lx, ty = ly, lastPointer = -1e9, raf = 0, visible = true, running = false;
    const coarse = win.matchMedia('(pointer: coarse)').matches;
    function radius() { return Math.round(Math.max(96, Math.min(200, Math.min(w, h) * 0.2))); }
    function paint() {
      const r = radius();
      host.style.setProperty('--lr', r + 'px'); host.style.setProperty('--lx', lx.toFixed(1) + 'px'); host.style.setProperty('--ly', ly.toFixed(1) + 'px');
      // where the lens sits, as -0.5..0.5 across the hero: the scene leans with it, nearer messages more than farther ones
      host.style.setProperty('--px', (w ? lx / w - 0.5 : 0).toFixed(4)); host.style.setProperty('--py', (h ? ly / h - 0.5 : 0).toFixed(4));
      lens.style.transform = 'translate3d(' + (lx - r).toFixed(1) + 'px,' + (ly - r).toFixed(1) + 'px,0)';
    }
    // The lens is a body on springs: critically damped (it never overshoots), quick while a pointer steers it, slow while it
    // wanders. Swapping the spring keeps position and velocity, so handing over from one to the other never jolts.
    const lensBody = Motion.body([lx, ly], Motion.SPRINGS.drift);
    let lastFrame = 0;
    // the motes: drifting specks that swirl round the lens and light up inside it. They ride this same loop, so there is one animation clock.
    const motes = !reduced && Motes && base.parentNode ? Motes.mount(host, base, () => ({ x: lx, y: ly, r: radius() }), { win }) : null;
    function frame(now) {
      raf = 0; if (!running) return;
      const dt = lastFrame ? Math.min((now - lastFrame) / 1000, Motion.MAX_DT) : 1 / 60; lastFrame = now;
      const steering = now - lastPointer < 2800 && !coarse;
      if (!steering) { const p = lensPosition(now, w, h); tx = p.x; ty = p.y; }
      lensBody.params = steering ? Motion.SPRINGS.steer : Motion.SPRINGS.drift;
      lensBody.step(dt, [tx, ty]); lx = lensBody.x[0]; ly = lensBody.x[1];
      paint(); if (motes) motes.frame(dt, now); raf = win.requestAnimationFrame(frame);
    }
    function start() { if (running || reduced || !visible || doc.hidden) return; running = true; lastFrame = 0; raf = win.requestAnimationFrame(frame); }
    function stop() { running = false; if (raf) win.cancelAnimationFrame(raf); raf = 0; }
    function measure() { w = host.clientWidth; h = host.clientHeight; if (motes) motes.resize(); if (reduced) { lx = w * 0.7; ly = h * 0.5; paint(); } }

    host.parentElement.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      const b = host.getBoundingClientRect(); tx = e.clientX - b.left; ty = e.clientY - b.top; lastPointer = performance.now();
      // "Reduce motion" removes drift and easing, not the interaction: the lens still goes exactly where the pointer goes.
      if (reduced) { lx = tx; ly = ty; paint(); }
    }, { passive: true });
    win.addEventListener('resize', measure, { passive: true });
    doc.addEventListener('visibilitychange', () => (doc.hidden ? stop() : start()));
    if ('IntersectionObserver' in win) new win.IntersectionObserver(es => { visible = es[0].isIntersecting; visible ? start() : stop(); }, { threshold: 0 }).observe(host);
    measure(); paint(); start();
    return { stop, start, host };
  }

  return { MESSAGES, splitByFlags, lensPosition, bubbleCount, buildField, mount };
}));
