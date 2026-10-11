'use strict';
/* Runs first on every page, blocking, in the head, so nothing is drawn before it has decided. Two jobs.

   1. Motion. One decision for the whole site: is motion reduced? The device's "reduce motion" setting is the default answer, and a visitor can
      override it either way with the Motion switch (the footer of every page, and the top of the home page); the choice is remembered on that
      device. The decision is the class `motion-calm` on <html> and `window.FSMotion`, and every stylesheet rule and script reads that,
      never the device setting directly, so what the switch says is what the page does. Changing it reloads the page, so nothing is half one way.
      Calm is not frozen: things still arrive, by fading, with no travel.
   2. The home page's entrance plays on every load: the full film the first time in a session, a short cut after that. Back or forward can hand
      back a frozen copy of the page; that is loaded afresh, behind the navy field, so the entrance plays.
   The policy allows no inline script, so this is a file. */
(function () {
  var win = window, root = document.documentElement;

  // ---- 1. motion ----
  var os = false, pref = null;
  try { os = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* no media queries: motion is allowed */ }
  try { var saved = win.localStorage.getItem('fs_motion'); if (saved === 'on' || saved === 'off') pref = saved; } catch (e) { /* storage blocked: the device's setting stands */ }
  var calm = pref === 'off' || (pref !== 'on' && os);
  root.classList.add('motion-known');
  if (calm) root.classList.add('motion-calm');

  var FSMotion = win.FSMotion = {
    calm: calm, os: os, pref: pref,
    reload: function () { win.location.reload(); },
    set: function (v) {
      try { if (v === 'on' || v === 'off') win.localStorage.setItem('fs_motion', v); else win.localStorage.removeItem('fs_motion'); } catch (e) { /* not remembered */ }
      FSMotion.reload();
    },
    toggle: function () { FSMotion.set(calm ? 'on' : 'off'); },
    // a switch element: shows the state, and flips it when pressed
    bind: function (el) {
      if (!el || el.getAttribute('data-motion-bound')) return;
      el.setAttribute('data-motion-bound', '1');
      var text = el.querySelector('[data-motion-label]') || el;
      text.textContent = calm ? 'Motion off' : 'Motion on';
      el.setAttribute('aria-pressed', String(!calm));
      el.setAttribute('title', calm ? (os && pref !== 'off' ? 'Your device asks for reduced motion. Press to turn motion on.' : 'Press to turn motion on.') : 'Press to reduce motion.');
      el.addEventListener('click', function () { FSMotion.toggle(); });
    }
  };
  document.addEventListener('DOMContentLoaded', function () {
    var els = document.querySelectorAll('[data-motion-toggle]');
    for (var i = 0; i < els.length; i++) FSMotion.bind(els[i]);
  });

  // ---- 2. the home page's entrance ----
  if (!/(^|\/)(index\.html)?$/.test(win.location.pathname)) return;   // the entrance belongs to the home page only
  var again;
  try {
    var store = win.sessionStorage;
    again = store.getItem('fs_intro_seen') === '1';
    store.setItem('fs_intro_seen', '1');
  } catch (e) { again = true; }                                           // storage blocked or unreadable: the short cut, never none
  if (again) root.classList.add('intro-short');
  win.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    root.style.cssText = 'background:#0B1F3A;visibility:hidden';
    win.location.reload();
  });
}());
