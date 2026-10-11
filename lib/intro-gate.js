'use strict';
/* Decides, before the first paint, how the home page plays its entrance, and makes sure it plays every time the home page is loaded: a first visit, a reload,
   the logo from another page, the back and forward buttons.
   The first entrance of a browser session is the full film. Every later one is the short cut, about half as long, so coming home never costs more than two
   seconds; a tap skips either one at once. A person who has asked their device for less motion gets it as a still frame (the stylesheet holds it still).
   Every page loads this file: it is a blocking file in the head (the page's policy allows no inline script). It sets at most one class, which the
   stylesheet uses to shorten the entrance, and on the home page it makes a copy the browser hands back from its back-forward store load afresh. */
(function () {
  if (!/(^|\/)(index\.html)?$/.test(window.location.pathname)) return;   // the entrance belongs to the home page only
  var root = document.documentElement, again;
  try {
    var store = window.sessionStorage;
    again = store.getItem('fs_intro_seen') === '1';
    store.setItem('fs_intro_seen', '1');
  } catch (e) { again = true; }                                           // storage blocked or unreadable: the short cut, never none
  if (again) root.classList.add('intro-short');
  // Back or forward can restore a frozen copy of the page with its entrance already spent. Load it afresh instead, so the entrance plays and the page
  // is a live one. The navy field is painted first so no white or half-built page shows between the two.
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    root.style.cssText = 'background:#0B1F3A;visibility:hidden';
    window.location.reload();
  });
}());
