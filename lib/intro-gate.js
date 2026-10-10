'use strict';
/* Decides, before the first paint, whether the home page plays its film-title entrance.
   It plays only when the home page is where the visit begins, once per browser session, and never for a person who has asked their device for less motion.
   Someone who reaches the home page by the logo from another page, or reloads it, or is in the middle of an emergency, is not made to wait four seconds with
   every tap swallowed. Every page loads this file, because the pages are served with no referrer (a privacy choice), so "the visit began elsewhere" has to be
   remembered here. It is a blocking file in the head (the page's policy allows no inline script) and sets one class; the stylesheet does the rest. */
(function () {
  var root = document.documentElement;
  try {
    var store = window.sessionStorage, seen = store.getItem('fs_intro_seen') === '1';
    var home = /(^|\/)(index\.html)?$/.test(window.location.pathname);
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!home) { store.setItem('fs_intro_seen', '1'); return; }   // the visit began on another page: the entrance is spent
    if (reduced || seen) root.classList.add('intro-off');
    else store.setItem('fs_intro_seen', '1');
  } catch (e) {
    root.classList.add('intro-off');   // no storage (a private window, blocked data): never play it on every visit, play it on none
  }
}());
