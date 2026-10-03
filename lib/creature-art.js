/* The six characters as rigged SVG. Every character shares one anatomy so a single rig can bring any of them alive:
     .cr-body    everything that squashes and stretches (pivots on the feet)
     .cr-eye     a socket carrying data-cx/cy/rx/ry/pr, with a .cr-pupil inside it (gaze) and a .cr-lid over it (blink)
     .cr-mouth   a smile line plus a .cr-mouth-open shape that opens while the character speaks
     .cr-arm-l / .cr-arm-r   hands that wave
   The art ships as static markup (scripts/sync_site.js writes it into index.html), so the page is complete before any
   script runs. lib/creatures.js only adds life. Gradient ids are prefixed per character so they never collide. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FraudShieldCreatureArt = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const NAVY = '#0B1F3A';

// One eye socket. `lid` is the colour of the skin around it, so a closing lid blends in.
function eye(cx, cy, rx, ry, pr, lid, o) {
  const opt = o || {};
  const pupil = opt.pupil || NAVY;
  return `<g class="cr-eye" data-cx="${cx}" data-cy="${cy}" data-rx="${rx}" data-ry="${ry}" data-pr="${pr}">` +
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${opt.white || '#fff'}"/>` +
    `<g class="cr-pupil"><circle cx="${cx}" cy="${cy}" r="${pr}" fill="${pupil}"/>` +
    `<circle cx="${(cx + pr * 0.4).toFixed(1)}" cy="${(cy - pr * 0.42).toFixed(1)}" r="${(pr * 0.36).toFixed(1)}" fill="#fff"/>` +
    `<circle cx="${(cx - pr * 0.32).toFixed(1)}" cy="${(cy + pr * 0.4).toFixed(1)}" r="${(pr * 0.16).toFixed(1)}" fill="#fff" opacity=".75"/></g>` +
    `<ellipse class="cr-lid" cx="${cx}" cy="${cy}" rx="${rx + 0.8}" ry="${ry + 0.8}" fill="${lid}"/></g>`;
}

// A mouth: the resting smile, and the dark opening that scales open while speaking.
function mouth(x1, x2, y, curve, openFill, stroke) {
  const mid = (x1 + x2) / 2, w = (x2 - x1) / 2;
  return `<g class="cr-mouth"><path class="cr-mouth-open" d="M${x1} ${y} Q${mid} ${y + curve * 2.1} ${x2} ${y} Q${mid} ${y - 1.2} ${x1} ${y}Z" fill="${openFill}"/>` +
    `<path class="cr-smile" d="M${x1} ${y} Q${mid} ${y + curve} ${x2} ${y}" fill="none" stroke="${stroke}" stroke-width="3.2" stroke-linecap="round"/>` +
    `<ellipse class="cr-tongue" cx="${mid}" cy="${y + curve * 1.2}" rx="${(w * 0.42).toFixed(1)}" ry="2.4" fill="#ff7a8a"/></g>`;
}

const cheeks = (lx, rx, y, rxr, color) =>
  `<ellipse class="cr-cheek" cx="${lx}" cy="${y}" rx="${rxr}" ry="${(rxr * 0.58).toFixed(1)}" fill="${color}" opacity=".55"/><ellipse class="cr-cheek" cx="${rx}" cy="${y}" rx="${rxr}" ry="${(rxr * 0.58).toFixed(1)}" fill="${color}" opacity=".55"/>`;

const shadow = (w) => `<ellipse class="cr-shadow" cx="60" cy="134" rx="${w}" ry="5" fill="#0B1F3A" opacity=".26"/>`;

const open = id => `<svg class="cr-svg" viewBox="0 0 120 140" aria-hidden="true" focusable="false" data-rig="${id}">`;

/* ---------- Kavach: the armour ---------- */
const shieldPath = 'M60 12C40 12 22 20 18 34C16 44 17 60 19 74C23 100 40 118 60 126C80 118 97 100 101 74C103 60 104 44 102 34C98 20 80 12 60 12Z';
function shield() {
  return open('shield') +
    `<defs><linearGradient id="kv-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffa24d"/><stop offset=".5" stop-color="#E85D04"/><stop offset="1" stop-color="#bd4400"/></linearGradient>` +
    `<radialGradient id="kv-glow" cx=".35" cy=".25" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>` +
    shadow(30) +
    `<g class="cr-arm-l"><ellipse cx="13" cy="84" rx="8" ry="6" fill="#c24a00" transform="rotate(-20 13 84)"/></g>` +
    `<g class="cr-arm-r"><ellipse cx="107" cy="84" rx="8" ry="6" fill="#c24a00" transform="rotate(20 107 84)"/></g>` +
    `<g class="cr-body"><path d="${shieldPath}" fill="url(#kv-body)"/><path d="${shieldPath}" fill="url(#kv-glow)"/>` +
    `<path d="M60 22C46 22 32 28 29 38C27 48 28 60 30 72C33 92 46 106 60 113C74 106 87 92 90 72C92 60 93 48 91 38C88 28 74 22 60 22Z" fill="none" stroke="#fff" stroke-opacity=".34" stroke-width="2"/>` +
    eye(47, 56, 9.5, 11, 5.4, '#f06e17') + eye(73, 56, 9.5, 11, 5.4, '#f06e17') +
    cheeks(35, 85, 74, 6.5, '#ff5a1a') +
    mouth(51, 69, 75, 7, '#7a1f00', '#fff') +
    `<g opacity=".9"><circle cx="60" cy="100" r="4.6" fill="#fff"/><path d="M57.6 102.5h4.8l1.6 9h-8z" fill="#fff"/></g></g></svg>`;
}

/* ---------- Dost: the friend, a speech bubble with folded hands ---------- */
const bubblePath = 'M36 16H84Q102 16 102 34V80Q102 98 84 98H62L42 118L44 98H36Q18 98 18 80V34Q18 16 36 16Z';
function friend() {
  return open('friend') +
    `<defs><linearGradient id="ds-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#47d598"/><stop offset=".55" stop-color="#1B7A4F"/><stop offset="1" stop-color="#145c3b"/></linearGradient>` +
    `<radialGradient id="ds-glow" cx=".3" cy=".2" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>` +
    shadow(26) +
    `<g class="cr-body"><path d="${bubblePath}" fill="url(#ds-body)"/><path d="${bubblePath}" fill="url(#ds-glow)"/>` +
    eye(46, 46, 9, 10.5, 5.2, '#27a56c') + eye(74, 46, 9, 10.5, 5.2, '#27a56c') +
    cheeks(33, 87, 63, 6.2, '#ff8f6b') +
    mouth(51, 69, 64, 6.5, '#0d3a25', '#fff') +
    `<g class="cr-arm-l" transform="rotate(-14 60 86)"><path d="M60 98C52 96 48 88 52 78C58 82 62 90 60 98Z" fill="#ffd9b8" stroke="#e0b48c" stroke-width="1"/></g>` +
    `<g class="cr-arm-r" transform="rotate(14 60 86)"><path d="M60 98C68 96 72 88 68 78C62 82 58 90 60 98Z" fill="#ffd9b8" stroke="#e0b48c" stroke-width="1"/></g></g></svg>`;
}

/* ---------- Chetavani: the warning, a bee ---------- */
function bee() {
  return open('bee') +
    `<defs><linearGradient id="bz-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd84a"/><stop offset="1" stop-color="#f59e0b"/></linearGradient>` +
    `<clipPath id="bz-clip"><ellipse cx="60" cy="82" rx="35" ry="41"/></clipPath></defs>` +
    shadow(26) +
    `<g class="cr-wing-l"><ellipse cx="28" cy="48" rx="22" ry="12" fill="#fff" opacity=".62" transform="rotate(-28 28 48)"/><ellipse cx="28" cy="48" rx="22" ry="12" fill="none" stroke="#bfe3ff" stroke-width="1.4" transform="rotate(-28 28 48)"/></g>` +
    `<g class="cr-wing-r"><ellipse cx="92" cy="48" rx="22" ry="12" fill="#fff" opacity=".62" transform="rotate(28 92 48)"/><ellipse cx="92" cy="48" rx="22" ry="12" fill="none" stroke="#bfe3ff" stroke-width="1.4" transform="rotate(28 92 48)"/></g>` +
    `<g class="cr-body"><path d="M60 123l-5 9h10z" fill="#2b1a05"/>` +
    `<ellipse cx="60" cy="82" rx="35" ry="41" fill="url(#bz-body)"/>` +
    `<g clip-path="url(#bz-clip)" fill="#2b1a05"><rect x="20" y="92" width="80" height="9"/><rect x="20" y="108" width="80" height="9"/></g>` +
    `<ellipse cx="46" cy="58" rx="12" ry="9" fill="#fff" opacity=".28"/>` +
    `<path d="M50 42C46 28 40 22 33 20" fill="none" stroke="#2b1a05" stroke-width="2.6" stroke-linecap="round"/><path d="M70 42C74 28 80 22 87 20" fill="none" stroke="#2b1a05" stroke-width="2.6" stroke-linecap="round"/>` +
    `<circle class="cr-ant" cx="32" cy="19" r="5" fill="#E85D04"/><circle class="cr-ant" cx="88" cy="19" r="5" fill="#E85D04"/>` +
    eye(47, 66, 10, 11.5, 5.8, '#f9b928') + eye(73, 66, 10, 11.5, 5.8, '#f9b928') +
    `<path d="M36 52L56 59" stroke="#2b1a05" stroke-width="3.4" stroke-linecap="round"/><path d="M84 52L64 59" stroke="#2b1a05" stroke-width="3.4" stroke-linecap="round"/>` +
    cheeks(36, 84, 80, 6, '#ff7a2b') +
    mouth(53, 67, 82, 3.6, '#4a1d00', '#2b1a05') + `</g></svg>`;
}

/* ---------- Sankhya: the counter, a small robot ---------- */
function bot() {
  return open('bot') +
    `<defs><linearGradient id="sk-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a5a9a"/><stop offset=".5" stop-color="#173a69"/><stop offset="1" stop-color="#0B1F3A"/></linearGradient>` +
    `<radialGradient id="sk-screen" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#0e2a4a"/><stop offset="1" stop-color="#050f1d"/></radialGradient></defs>` +
    shadow(28) +
    `<g class="cr-arm-l"><rect x="10" y="74" width="14" height="30" rx="7" fill="#173a69" transform="rotate(8 17 76)"/></g><g class="cr-arm-r"><rect x="96" y="74" width="14" height="30" rx="7" fill="#173a69" transform="rotate(-8 103 76)"/></g>` +
    `<g class="cr-body"><rect x="40" y="116" width="14" height="12" rx="5" fill="#0B1F3A"/><rect x="66" y="116" width="14" height="12" rx="5" fill="#0B1F3A"/>` +
    `<line x1="60" y1="30" x2="60" y2="16" stroke="#7f98b8" stroke-width="3" stroke-linecap="round"/><circle class="cr-ant" cx="60" cy="13" r="5" fill="#38e1ff"/>` +
    `<rect x="24" y="30" width="72" height="90" rx="22" fill="url(#sk-body)"/><rect x="24" y="30" width="72" height="90" rx="22" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="2"/>` +
    `<circle cx="22" cy="62" r="5" fill="#7f98b8"/><circle cx="98" cy="62" r="5" fill="#7f98b8"/>` +
    `<rect x="33" y="40" width="54" height="46" rx="14" fill="url(#sk-screen)" stroke="#38e1ff" stroke-opacity=".35" stroke-width="1.5"/>` +
    eye(48, 60, 7, 10, 5, '#050f1d', { white: '#38e1ff', pupil: '#eafcff' }) + eye(72, 60, 7, 10, 5, '#050f1d', { white: '#38e1ff', pupil: '#eafcff' }) +
    `<g class="cr-mouth"><path class="cr-mouth-open" d="M50 76Q60 86 70 76Q60 74 50 76Z" fill="#38e1ff"/><path class="cr-smile" d="M50 75Q60 82 70 75" fill="none" stroke="#38e1ff" stroke-width="3" stroke-linecap="round"/></g>` +
    `<rect x="36" y="94" width="48" height="20" rx="8" fill="#06182e"/>` +
    `<text x="46" y="109" font-family="Arial,sans-serif" font-size="15" font-weight="700" fill="#ff8a3d">₹</text>` +
    `<rect class="cr-bar b1" x="58" y="104" width="5" height="6" rx="1.5" fill="#38e1ff"/><rect class="cr-bar b2" x="66" y="100" width="5" height="10" rx="1.5" fill="#38e1ff"/><rect class="cr-bar b3" x="74" y="97" width="5" height="13" rx="1.5" fill="#ff8a3d"/></g></svg>`;
}

/* ---------- Thag: the fraudster, a ghost ---------- */
// The hem is a row of scallops that the rig can ripple, so it is built from a function the rig shares.
function hemPath(phase, amp) {
  const x0 = 22, x1 = 98, n = 4, w = (x1 - x0) / n, base = 116;
  let d = `M${x0} 72C${x0} 36 38 14 60 14C82 14 ${x1} 36 ${x1} 72L${x1} ${base}`;
  for (let i = n - 1; i >= 0; i--) {
    const xr = x0 + (i + 1) * w, xl = x0 + i * w, a = amp * Math.sin(phase + i * 1.3), b = amp * Math.sin(phase + (i + 0.5) * 1.3 + 0.9);
    d += `Q${(xr - w / 2).toFixed(1)} ${(base + 12 + b).toFixed(1)} ${xl.toFixed(1)} ${(base + a * 0.4).toFixed(1)}`;
  }
  return d + 'Z';
}
function ghost() {
  const hem = hemPath(0, 2);
  return open('ghost') +
    `<defs><linearGradient id="tg-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c63a3a"/><stop offset=".55" stop-color="#8d2222"/><stop offset="1" stop-color="#5a1216"/></linearGradient>` +
    `<radialGradient id="tg-glow" cx=".35" cy=".2" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".32"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>` +
    shadow(26) +
    `<g class="cr-body"><path class="cr-hem" d="${hem}" fill="url(#tg-body)"/><path d="M22 72C22 36 38 14 60 14C82 14 98 36 98 72Z" fill="url(#tg-glow)"/>` +
    eye(46, 56, 9.5, 9.5, 4.4, '#8d2222', { pupil: '#2b0508' }) + eye(74, 56, 9.5, 9.5, 4.4, '#8d2222', { pupil: '#2b0508' }) +
    `<path d="M34 49Q46 42 57 50L57 55L35 55Z" fill="#7a1b1b"/><path d="M86 49Q74 42 63 50L63 55L85 55Z" fill="#7a1b1b"/>` +
    `<path d="M33 40L55 47" stroke="#2b0508" stroke-width="3.4" stroke-linecap="round"/><path d="M87 44L65 48" stroke="#2b0508" stroke-width="3.4" stroke-linecap="round"/>` +
    cheeks(35, 85, 74, 5.6, '#ff6a6a') +
    `<g class="cr-mouth"><path class="cr-mouth-open" d="M42 78Q62 98 80 74Q62 78 42 78Z" fill="#2b0508"/><path class="cr-smile" d="M42 78Q60 90 80 74" fill="none" stroke="#2b0508" stroke-width="3.2" stroke-linecap="round"/>` +
    `<path class="cr-teeth" d="M50 82l3 5l3-4zM60 85l3 4l3-5z" fill="#fff"/></g></g></svg>`;
}

/* ---------- Umeed: the hope, a star ---------- */
function starPoints(cx, cy, R, r, n) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, rad = i % 2 ? r : R; pts.push((cx + rad * Math.cos(a)).toFixed(1) + ' ' + (cy + rad * Math.sin(a)).toFixed(1)); }
  return pts.join(' ');
}
function star() {
  const pts = starPoints(60, 70, 50, 26, 5);
  const spark = (x, y, s, cls) => `<path class="cr-spark ${cls}" d="M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z" fill="#fff6c8"/>`;
  return open('star') +
    `<defs><radialGradient id="um-body" cx=".4" cy=".3" r=".8"><stop offset="0" stop-color="#fff3a8"/><stop offset=".5" stop-color="#ffc83d"/><stop offset="1" stop-color="#f59e0b"/></radialGradient>` +
    `<radialGradient id="um-halo" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe27a" stop-opacity=".6"/><stop offset="1" stop-color="#ffe27a" stop-opacity="0"/></radialGradient></defs>` +
    shadow(22) +
    `<circle class="cr-halo" cx="60" cy="70" r="62" fill="url(#um-halo)"/>` +
    `<g class="cr-body"><polygon points="${pts}" fill="url(#um-body)" stroke="#ffc83d" stroke-width="9" stroke-linejoin="round"/>` +
    `<polygon points="${starPoints(60, 70, 40, 20, 5)}" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width="2" stroke-linejoin="round"/>` +
    eye(50, 68, 6.6, 8.4, 4, '#ffc83d') + eye(70, 68, 6.6, 8.4, 4, '#ffc83d') +
    `<path class="cr-joy" d="M43 70Q50 60 57 70M63 70Q70 60 77 70" fill="none" stroke="#7a3d00" stroke-width="3" stroke-linecap="round"/>` +
    cheeks(40, 80, 80, 5, '#ff8a4a') +
    mouth(53, 67, 82, 5.5, '#7a2a00', '#7a3d00') + `</g>` +
    spark(14, 30, 7, 's1') + spark(106, 40, 6, 's2') + spark(100, 112, 5, 's3') + `</svg>`;
}

const ART = { shield, friend, bee, bot, ghost, star };
const KEYS = Object.keys(ART);

return { ART, KEYS, hemPath, starPoints, art: key => { if (!ART[key]) throw new Error('unknown creature: ' + key); return ART[key](); } };
}));
