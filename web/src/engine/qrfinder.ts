/* Does this picture contain a QR code, whether or not it can be read? A decoder answers "what does it say?", and when it cannot, that is all it knows:
   a code half-hidden by a logo, torn, glared over, or photographed at a hard angle simply returns nothing, exactly like a picture with no code in it.
   For a safety tool those two silences must not be treated alike: if the picture has a QR code that cannot be read, falling back to reading the text
   around it ("Scan to pay Rs 5000") says nothing about where the scan would send the money.
   This finds the structure instead: the three finder patterns in the corners of every QR code, a square ring inside a square ring whose slice along any
   line crosses dark, light, dark, light, dark in the ratio 1:1:3:1:1. That ratio survives rotation, scaling and moderate perspective, and it is not
   covered by a logo in the middle. Three of them in the arrangement of a right-angled triangle is a QR code. Pure functions over { data: RGBA, width, height }. */

/** An RGBA picture: four bytes per pixel. */
export interface Rgba { data: ArrayLike<number>; width: number; height: number }
interface Plane { g: Uint8Array; w: number; h: number }
export interface Point { x: number; y: number; m: number }
/** A candidate finder pattern: where it is, how big a module is there, and on how many rows it was seen. */
export interface Candidate extends Point { hits: number }
export interface QrStructure { qr: boolean; certainty: 'full' | 'partial' | null; finders: number; points: Point[] }
// Reads inside the pixel loops below are in range by construction (each loop is bounded by the dimensions of the array it reads), so they are marked with `!`;
// tests/qrfinder.test.js and the differential test compare every result with the shipped implementation.

// A pixel is dark if it is darker than 86% of its neighbourhood's mean, less 3 levels. Chosen on one random batch of synthetic codes; checked on others (docs/BENCHMARKS.md).
const THRESH = { k: 0.86, c: 3 };
const SCALES = [1, 0.5, 2];   // as given, halved (a large, sharp code), doubled (a small one seen from far away)
const DENSITY_PAIR = 0.33;   // lower than for three finders, the missing corner being torn or covered: measured 0.35 on a code with more than half wiped, 0.32 at most on text
const DENSITY_MIN = 0.40;   // measured: ring triples in 3,800 text screenshots reach 0.397; real codes (logo, noise, tilt, blur) are 0.42 and above
const WORK_SIDE = 1000;   // the scan runs on a copy no larger than this: finder patterns are found by ratio, so the size does not matter, only the time does

function luminance(img: Rgba): Uint8Array {
  const n = img.width * img.height, g = new Uint8Array(n), d = img.data;
  for (let i = 0, p = 0; i < n; i++, p += 4) g[i] = (d[p]! * 77 + d[p + 1]! * 150 + d[p + 2]! * 29) >> 8;
  return g;
}

// Area-average shrink of a grey plane, so a huge frame costs little.
function shrink(g: Uint8Array, w: number, h: number, maxSide: number): Plane {
  const k = Math.max(w, h) / maxSide;
  if (k <= 1) return { g, w, h };
  const nw = Math.max(1, Math.round(w / k)), nh = Math.max(1, Math.round(h / k)), out = new Uint8Array(nw * nh), sx = w / nw, sy = h / nh;
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.min(h, Math.max(y0 + 1, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.min(w, Math.max(x0 + 1, Math.ceil((x + 1) * sx)));
      let s = 0, c = 0; for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += g[yy * w + xx]!; c++; }
      out[y * nw + x] = s / c;
    }
  }
  return { g: out, w: nw, h: nh };
}

// Bilinear resize of a grey plane (used to enlarge a small picture: a code seen from far away has modules only a pixel or two wide).
function resize(g: Uint8Array, w: number, h: number, k: number): Plane {
  const nw = Math.max(1, Math.round(w * k)), nh = Math.max(1, Math.round(h * k)), out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const fy = Math.min(h - 1, y / k), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < nw; x++) {
      const fx = Math.min(w - 1, x / k), x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      out[y * nw + x] = (g[y0 * w + x0]! * (1 - tx) + g[y0 * w + x1]! * tx) * (1 - ty) + (g[y1 * w + x0]! * (1 - tx) + g[y1 * w + x1]! * tx) * ty;
    }
  }
  return { g: out, w: nw, h: nh };
}

// Adaptive threshold: a pixel is dark if it is clearly darker than its neighbourhood. Works under shadows and glare gradients, where one global threshold fails.
function binarize(g: Uint8Array, w: number, h: number, invert: boolean): Uint8Array {
  const win = Math.max(15, Math.round(Math.min(w, h) / 8)) | 1, half = win >> 1, ii = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += g[y * w + x]!; ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1]! + row; } }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1), area = (x1 - x0) * (y1 - y0);
      const mean = (ii[y1 * (w + 1) + x1]! - ii[y0 * (w + 1) + x1]! - ii[y1 * (w + 1) + x0]! + ii[y0 * (w + 1) + x0]!) / area;
      const dark = g[y * w + x]! < mean * THRESH.k - THRESH.c;
      out[y * w + x] = invert ? (g[y * w + x]! > mean * (2 - THRESH.k) + THRESH.c ? 1 : 0) : (dark ? 1 : 0);
    }
  }
  return out;
}

// runs [a,b,c,d,e] (dark, light, dark, light, dark) in the ratio 1:1:3:1:1 within a tolerance; returns the module size or 0
function ratio(r: readonly number[], strict: boolean): number {
  const [r0 = 0, r1 = 0, r2 = 0, r3 = 0, r4 = 0] = r;
  const total = r0 + r1 + r2 + r3 + r4;
  if (total < 7) return 0;
  // the four thin runs within 55% of a module (blur and perspective stretch them); the middle run within 1.25 modules of three. Strict (used for light-on-dark, where
  // the adaptive threshold paints a bright halo round any dark square) allows less.
  const m = total / 7, v = m * (strict ? 0.5 : 0.55), c = m * (strict ? 0.8 : 1.25);
  return Math.abs(r0 - m) < v && Math.abs(r1 - m) < v && Math.abs(r2 - 3 * m) < c && Math.abs(r3 - m) < v && Math.abs(r4 - m) < v ? m : 0;
}

// Walks outward from (x, y) along (dx, dy) counting dark, light, dark runs; the centre pixel must be dark. Returns the 5 runs and the offset of the centre of the middle run.
function cross(bin: Uint8Array, w: number, h: number, x: number, y: number, dx: number, dy: number): number[] | null {
  const at = (px: number, py: number): number => (px < 0 || py < 0 || px >= w || py >= h ? -1 : bin[py * w + px]!);
  if (at(x, y) !== 1) return null;
  const counts = [0, 0, 0, 0, 0], limit = Math.max(w, h), inc = (i: number): void => { counts[i] = (counts[i] ?? 0) + 1; };
  let px = x, py = y, k = 0;
  while (at(px, py) === 1 && k++ < limit) { inc(2); px -= dx; py -= dy; }
  while (at(px, py) === 0 && k++ < limit) { inc(1); px -= dx; py -= dy; }
  while (at(px, py) === 1 && k++ < limit) { inc(0); px -= dx; py -= dy; }
  px = x + dx; py = y + dy;
  while (at(px, py) === 1 && k++ < limit) { inc(2); px += dx; py += dy; }
  while (at(px, py) === 0 && k++ < limit) { inc(3); px += dx; py += dy; }
  while (at(px, py) === 1 && k++ < limit) { inc(4); px += dx; py += dy; }
  return counts;
}

// Candidate finder patterns found by scanning rows for 1:1:3:1:1, then confirming down the column and along the diagonals (so a bar of text or a barcode does not pass).
function scanFinders(bin: Uint8Array, w: number, h: number, strict: boolean): Candidate[] {
  const found: { x: number; y: number; m: number; cy: number }[] = [], step = h > 500 ? 2 : 1;
  for (let y = 0; y < h; y += step) {
    const runs: { color: number; len: number; start: number }[] = []; let color = bin[y * w]!, len = 0, start = 0;
    const run = (k: number): { color: number; len: number; start: number } => runs[k]!;
    const push = (x: number): void => { runs.push({ color, len, start }); start = x; };
    for (let x = 0; x < w; x++) { if (bin[y * w + x] === color) len++; else { push(x); color = bin[y * w + x]!; len = 1; } }
    push(w);
    for (let i = 0; i + 4 < runs.length; i++) {
      if (run(i).color !== 1) continue;
      const r = [run(i).len, run(i + 1).len, run(i + 2).len, run(i + 3).len, run(i + 4).len], m = ratio(r, strict);
      if (!m) continue;
      const cx = Math.round(run(i + 2).start + run(i + 2).len / 2);
      const v = cross(bin, w, h, cx, y, 0, 1);
      if (!v) continue;
      const mv = ratio(v, strict); if (!mv) continue;
      const d1 = cross(bin, w, h, cx, y, 1, 1), d2 = cross(bin, w, h, cx, y, 1, -1);
      const dm = [d1, d2].filter((c): c is number[] => c !== null).filter(c => ratio(c, strict)).length;
      if (dm < 1) continue;   // a real finder pattern is a ring inside a ring, so at least one diagonal also crosses it as 1:1:3:1:1
      const cy = Math.round(y - ((v[2] ?? 0) / 2 - 0.5) + (v[4] === undefined ? 0 : 0));
      found.push({ x: cx, y, m: (m + mv) / 2, cy });
    }
  }
  // merge hits that are the same pattern seen on neighbouring rows
  const out: { x: number; y: number; m: number; sx: number; sy: number; sm: number; n: number }[] = [];
  for (const f of found) {
    const hit = out.find(o => Math.abs(o.x - f.x) <= Math.max(o.m, f.m) * 1.6 && Math.abs(o.y - f.y) <= Math.max(o.m, f.m) * 7);
    if (hit) { hit.sx += f.x; hit.sy += f.y; hit.sm += f.m; hit.n++; hit.x = hit.sx / hit.n; hit.y = hit.sy / hit.n; hit.m = hit.sm / hit.n; }
    else out.push({ x: f.x, y: f.y, m: f.m, sx: f.x, sy: f.y, sm: f.m, n: 1 });
  }
  const rings: Candidate[] = [];
  for (const o of out) if (o.n >= 2) { const g = ringGeometry(bin, w, h, o.x, o.y, o.m); if (g) rings.push({ x: g.x, y: g.y, m: o.m, hits: o.n }); }
  return rings;
}

// A finder pattern is three concentric squares: a solid one, a light ring round it, a dark ring round that, however it is turned or tilted. Letters in dense text and the
// bars of a barcode give 1:1:3:1:1 along a row, a column and a diagonal by accident, but not rings. Walk 16 rays out from the centre and record where the colour changes
// (dark to light, light to dark, dark to light): on a real pattern the three distances stand in the same ratios on every ray (the light ring starts 5/3 of the way out
// to the edge of the centre, the dark ring ends 7/5 beyond that), and the centre's edge is 1.5 to 2.1 modules away.
const RAYS = 16, SHARE_NEEDED = 0.7, RAYS_MIN = 10;   // of the rays that stay inside the picture, most must fit (tiny modules quantise a few rays out)
const UNIT = Array.from({ length: RAYS }, (_, k) => { const a = (k + 0.5) * 2 * Math.PI / RAYS; return { dx: Math.cos(a), dy: Math.sin(a) }; });
const sample = (bin: Uint8Array, w: number, h: number, x: number, y: number): number => {
  const px = Math.round(x), py = Math.round(y);
  return px < 0 || py < 0 || px >= w || py >= h ? -1 : bin[py * w + px] ?? -1;
};
interface Ray { edge: number[]; left: boolean }
function castRays(bin: Uint8Array, w: number, h: number, cx: number, cy: number, m: number): Ray[] {
  const step = Math.max(0.25, m / 8), reachMax = 6 * m;
  return UNIT.map(({ dx, dy }) => {
    const edge: number[] = []; let prev = 1, left = false;
    for (let d = step; d <= reachMax && edge.length < 3; d += step) {
      const v = sample(bin, w, h, cx + dx * d, cy + dy * d);
      if (v === -1) { left = true; break; }
      if (v !== prev) { edge.push(d); prev = v; }
    }
    return { edge, left };
  });
}
// The centre of the ring pattern at (x, y), or null when it is not one.
function ringGeometry(bin: Uint8Array, w: number, h: number, x: number, y: number, m: number): { x: number; y: number } | null {
  let cx = x, cy = y;
  // the row-by-row estimate of the centre is a module out on a tilted code: opposite rays should reach the edge of the solid centre at equal distances, so move the
  // centre by half their difference (a couple of times) before judging
  for (let pass = 0; pass < 3; pass++) {
    const rays = castRays(bin, w, h, cx, cy, m); let sx = 0, sy = 0, used = 0;
    for (let k = 0; k < RAYS / 2; k++) {
      const a = rays[k]!.edge[0], b = rays[k + RAYS / 2]!.edge[0];
      if (a === undefined || b === undefined) continue;
      sx += UNIT[k]!.dx * (a - b) / 2; sy += UNIT[k]!.dy * (a - b) / 2; used++;
    }
    if (used < RAYS / 4) break;
    cx += sx / (used / 2); cy += sy / (used / 2);
  }
  let ok = 0, seen = 0;
  for (const { edge, left } of castRays(bin, w, h, cx, cy, m)) {
    if (left && edge.length < 3) continue;   // this ray ran off the picture: a code against the border, nothing to judge
    seen++;
    if (edge.length === 3) {
      const [r, s, t] = edge as [number, number, number];   // edge of the centre, inner edge and outer edge of the dark ring
      if (r >= 0.9 * m && r <= 2.6 * m && s / r >= 1.15 && s / r <= 2.3 && t / s >= 1.08 && t / s <= 1.9) ok++;
    }
  }
  if (seen < RAYS_MIN || ok < SHARE_NEEDED * seen) return null;
  // the centre is a solid block 3 modules across: a disc 0.8 of the scan's module size round the middle is (almost) all dark. A letter "o" has a hole there, and a stroke is
  // narrower than the disc.
  let dark = 0, n = 0;
  for (const f of [0, 0.4, 0.8]) for (let k = 0; k < (f === 0 ? 1 : 12); k++) {
    const a = k * Math.PI / 6, v = sample(bin, w, h, cx + Math.cos(a) * f * m, cy + Math.sin(a) * f * m);
    if (v !== -1) { n++; dark += v; }
  }
  if (n < 6 || dark < 0.9 * n) return null;
  return { x: cx, y: cy };
}

// Distance from (x, y) along (dx, dy) to the end of the dark run that starts at (or within a pixel of) (x, y); -1 if the picture ends first, 0 if there is no dark there.
function reach(bin: Uint8Array, w: number, h: number, x: number, y: number, dx: number, dy: number, limit: number): number {
  let dark = false;
  for (let d = 0; d <= limit; d += 0.5) {
    const v = sample(bin, w, h, x + dx * d, y + dy * d);
    if (v === -1) return -1;
    if (v === 1) dark = true; else if (dark) return d; else if (d >= 1.5) return 0;
  }
  return dark ? limit : 0;
}

// Between two finder patterns of one code runs the timing pattern: one module wide, alternating dark, light, dark ... from the module after the separator to the one
// before the next finder pattern's, on the row of modules that is the bottom edge of the finder (3 modules from its centre). Text and clutter give no such line of
// equal runs. A turned or tilted code has a different module size along each of its axes, so both are measured from the finders themselves: the solid centre reaches
// 1.5 modules out along each axis. Looks on both sides of the line joining the centres, since which side depends on how the code is turned.
function linked(bin: Uint8Array, w: number, h: number, a: Point, b: Point): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), lim = 4 * Math.max(a.m, b.m);
  if (!(d > 0) || d < 8 * Math.min(a.m, b.m)) return false;
  const ux = dx / d, uy = dy / d;
  const mu = (reach(bin, w, h, a.x, a.y, ux, uy, lim) + reach(bin, w, h, b.x, b.y, -ux, -uy, lim)) / 2 / 1.5;   // module size along the line
  if (!(mu > 1)) return false;
  const from = 4.8 * mu, to = d - 4.8 * mu, step = Math.max(0.25, mu / 6);
  for (const side of [1, -1]) {
    const nx = -uy * side, ny = ux * side;
    const mn = (reach(bin, w, h, a.x, a.y, nx, ny, lim) + reach(bin, w, h, b.x, b.y, nx, ny, lim)) / 2 / 1.5;   // and along the other axis
    if (!(mn > 1)) continue;
    const ox = nx * 3 * mn, oy = ny * 3 * mn, runs: { v: number; len: number }[] = []; let prev = -2, len = 0, outside = false;
    for (let t = from; t <= to; t += step) {
      const v = sample(bin, w, h, a.x + ux * t + ox, a.y + uy * t + oy);
      if (v === -1) { outside = true; break; }
      if (v === prev) len += step; else { if (prev !== -2) runs.push({ v: prev, len }); prev = v; len = step; }
    }
    if (outside) continue;
    runs.push({ v: prev, len });
    // the runs must alternate at one pitch, and that pitch must be a module. Binarising fattens the dark runs a little, so the pitch is measured from the line itself
    // (its length over the number of runs) rather than trusted from the finders; the first and last run are cut by the window, so only the inner ones are judged
    const n = runs.length;
    if (n < 4) continue;
    const L = (to - from) / n; let even = L >= 0.6 * mu && L <= 1.4 * mu;
    for (let i = 1; i < n - 1 && even; i++) even = runs[i]!.len >= 0.5 * L && runs[i]!.len <= 1.7 * L;
    if (even) return true;
  }
  return false;
}

// Share of dark pixels in the data area spanned by three finder patterns (the parallelogram between their centres, minus a margin round each finder). A QR code's
// mask pattern keeps its data close to half dark; lines of text on a plain ground are mostly light. Returns null if too little of the area lies inside the picture.
function density(bin: Uint8Array, w: number, h: number, pts: readonly Point[]): number | null {
  const [p, q, r] = pts as [Point, Point, Point], d = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
  // the right-angled corner is the vertex opposite the longest side
  const sides: [number, Point][] = [[d(q, r), p], [d(p, r), q], [d(p, q), r]];
  sides.sort((a, b) => b[0] - a[0]);
  const V = sides[0]![1], [A, B] = pts.filter(o => o !== V) as [Point, Point];
  const margin = 5 * Math.max(p.m, q.m, r.m); let dark = 0, n = 0;
  for (let i = 0; i < 28; i++) for (let j = 0; j < 28; j++) {
    const u = 0.1 + 0.8 * (i + 0.5) / 28, v = 0.1 + 0.8 * (j + 0.5) / 28;
    const x = V.x + u * (A.x - V.x) + v * (B.x - V.x), y = V.y + u * (A.y - V.y) + v * (B.y - V.y);
    if (pts.some(o => Math.hypot(x - o.x, y - o.y) < margin)) continue;
    const c = sample(bin, w, h, x, y); if (c === -1) continue;
    n++; dark += c;
  }
  return n >= 40 ? dark / n : null;
}

// Two finder patterns imply a square: either could be the corner, and the missing one lies on either side. A real code (even one with a corner torn off) has data
// that is dense somewhere in that square; two letters and the text round them do not.
function impliedDense(bin: Uint8Array, w: number, h: number, a: Point, b: Point): boolean {
  let best = 0;
  for (const [c, o] of [[a, b], [b, a]] as const) for (const side of [1, -1]) {
    const third: Point = { x: c.x - (o.y - c.y) * side, y: c.y + (o.x - c.x) * side, m: c.m };
    const dn = density(bin, w, h, [c, o, third]);
    if (dn === null) return true;   // too little of it is inside the picture to judge
    best = Math.max(best, dn);
  }
  return best >= DENSITY_PAIR;
}

// Three finder patterns of one size, at the corners of a right-angled isosceles triangle, far enough apart to be the corners of a real code.
type Joined = (a: Point, b: Point) => boolean;
function triple(c: readonly Candidate[], joined?: Joined | null): { score: number; points: Point[] } | null {
  let best: { score: number; points: Point[] } | null = null;
  const list = c.slice().sort((a, b) => b.hits - a.hits).slice(0, 14);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) for (let k = j + 1; k < list.length; k++) {
    const p = [list[i]!, list[j]!, list[k]!], ms = p.map(q => q.m), size = Math.max(...ms) / Math.min(...ms);
    if (size > 2.0) continue;
    const d = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y), sides: [number, number][] = [[d(p[0]!, p[1]!), 2], [d(p[0]!, p[2]!), 1], [d(p[1]!, p[2]!), 0]];
    sides.sort((a, b) => a[0] - b[0]);
    const a = sides[0]![0], b = sides[1]![0], hyp = sides[2]![0], avgM = (ms[0]! + ms[1]! + ms[2]!) / 3;
    if (a < 8 * avgM) continue;                                   // version 1 has its finder centres 14 modules apart
    if (joined) {   // at least one of the two legs must carry a timing pattern (a torn leg is allowed, a code with neither is not)
      const legs = [sides[0]![1], sides[1]![1]].map(o => { const v = [0, 1, 2].filter(n => n !== o); return [p[v[0]!]!, p[v[1]!]!] as const; });
      if (!legs.some(([u, v]) => joined(u, v))) continue;
    }
    if (Math.abs(a - b) / Math.max(a, b) > 0.38) continue;        // two equal legs (perspective bends this, hence the slack)
    const expect = Math.SQRT2 * (a + b) / 2; if (hyp < expect * 0.74 || hyp > expect * 1.3) continue;   // and the diagonal of the square they span
    const score = list[i]!.hits + list[j]!.hits + list[k]!.hits - 50 * Math.abs(a - b) / Math.max(a, b);
    if (!best || score > best.score) best = { score, points: p.map(q => ({ x: q.x, y: q.y, m: q.m })) };
  }
  return best;
}

// Two finder patterns of one size, a plausible distance apart, each seen on several rows: a code with one corner torn, covered or out of frame.
function pair(c: readonly Candidate[], joined?: Joined | null): { points: Point[] } | null {
  const list = c.filter(q => q.hits >= 3).sort((a, b) => b.hits - a.hits).slice(0, 14);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i]!, b = list[j]!, m = (a.m + b.m) / 2, d = Math.hypot(a.x - b.x, a.y - b.y);
    if (Math.max(a.m, b.m) / Math.min(a.m, b.m) <= 1.5 && d >= 9 * m && d <= 140 * m && (!joined || joined(a, b))) return { points: [a, b].map(q => ({ x: q.x, y: q.y, m: q.m })) };
  }
  return null;
}

// { qr: boolean, certainty: 'full' | 'partial' | null, finders: number, points } for an RGBA image. Tries dark-on-light and light-on-dark.
function findQrStructure(img: Rgba | null | undefined): QrStructure {
  const none: QrStructure = { qr: false, certainty: null, finders: 0, points: [] };
  if (!img || !img.data || !(img.width > 0) || !(img.height > 0) || img.data.length < img.width * img.height * 4) return none;
  const base = shrink(luminance(img), img.width, img.height, WORK_SIDE), back = (sm: { w: number; h: number }, ps: readonly Point[]): Point[] => ps.map(p => ({ x: p.x * img.width / sm.w, y: p.y * img.height / sm.h, m: p.m * img.width / sm.w }));
  let seen = 0, partial: { sm: Plane; points: Point[]; finders: number } | null = null;
  for (const k of SCALES) {
    if (k > 1 && Math.max(base.w, base.h) * k > 1600) continue;
    if (k < 1 && Math.min(base.w, base.h) * k < 60) continue;
    const sm = k === 1 ? base : resize(base.g, base.w, base.h, k);
    for (const invert of [false, true]) {
      const bin = binarize(sm.g, sm.w, sm.h, invert), cands = scanFinders(bin, sm.w, sm.h, invert), link: Joined = (u, v) => linked(bin, sm.w, sm.h, u, v);
      // three rings at the corners of a right-angled triangle are a code if the area between them is as dense as a code's data (text never reaches it). A timing line
      // joining them is preferred when there is one, but noise and blur wipe it out at small sizes, so it is not required.
      const dense = (x: { points: Point[] } | null): boolean => { if (!x) return false; const dn = density(bin, sm.w, sm.h, x.points); return dn === null || dn >= DENSITY_MIN; };
      let t = triple(cands, link); if (!dense(t)) { t = triple(cands, null); if (!dense(t)) t = null; }
      if (t) return { qr: true, certainty: 'full', finders: cands.length, points: back(sm, t.points) };   // three corners: a QR code
      seen = Math.max(seen, cands.length);
      const pr: { points: Point[] } | null = partial ? null : pair(cands, (u, v) => link(u, v) && impliedDense(bin, sm.w, sm.h, u, v)); if (pr) partial = { sm, points: pr.points, finders: cands.length };
    }
  }
  return partial ? { qr: true, certainty: 'partial', finders: partial.finders, points: back(partial.sm, partial.points) } : { ...none, finders: seen };
}

export { findQrStructure, scanFinders, triple, pair, ratio, binarize, luminance, shrink, resize, linked, density };
