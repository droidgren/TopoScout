/* Deterministic synthetic terrain + marching-squares contours.
   Produces genuine topographic contour geometry: lines crowd where the
   surface is steep and spread where it is flat, exactly like a real map. */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* A height field: one dominant summit, a couple of shoulders, plus gentle
   warping so the rings never look like tidy concentric ovals. */
function makeField(seed, opts = {}) {
  const rnd = mulberry32(seed);
  const peaks = [];
  const main = opts.main || { x: 0.62, y: 0.44, amp: 1.0, sx: 0.20, sy: 0.17 };
  peaks.push(main);
  const extra = opts.extra != null ? opts.extra : 5;
  for (let i = 0; i < extra; i++) {
    peaks.push({
      x: 0.05 + rnd() * 0.95,
      y: 0.05 + rnd() * 0.95,
      amp: 0.30 + rnd() * 0.50,
      sx: 0.14 + rnd() * 0.26,
      sy: 0.12 + rnd() * 0.24,
    });
  }
  const wp = { a: rnd() * 6.283, b: rnd() * 6.283, c: rnd() * 6.283 };

  return function h(x, y) {
    // warp the sampling position -> organic, non-elliptical rings
    const wx = x + 0.045 * Math.sin(y * 7.1 + wp.a) + 0.025 * Math.sin(y * 13.3 + wp.c);
    const wy = y + 0.045 * Math.cos(x * 6.3 + wp.b) + 0.025 * Math.cos(x * 11.7 + wp.a);
    let v = 0;
    for (const p of peaks) {
      const dx = (wx - p.x) / p.sx;
      const dy = (wy - p.y) / p.sy;
      v += p.amp * Math.exp(-(dx * dx + dy * dy) * 0.5);
    }
    // a long ridge keeps the lower ground from going featureless
    v += 0.16 * Math.exp(-Math.pow((wy - 0.80 - 0.10 * Math.sin(wx * 4.0)) / 0.16, 2) * 0.5);
    // an optional regional slope: a linear ramp yields evenly spaced contours
    // right across the frame, which is what a crop of a real topo map looks like
    if (opts.tilt) v += opts.tilt.gx * wx + opts.tilt.gy * wy;
    return v;
  };
}

/* Marching squares over [0,1]x[0,1], returned in card pixel space. */
function contourLines(h, level, nx, ny, W, H) {
  const segs = [];
  const gx = 1 / nx, gy = 1 / ny;
  const interp = (xa, ya, va, xb, yb, vb) => {
    const t = (level - va) / (vb - va);
    return [xa + (xb - xa) * t, ya + (yb - ya) * t];
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x0 = i * gx, y0 = j * gy, x1 = x0 + gx, y1 = y0 + gy;
      const v00 = h(x0, y0), v10 = h(x1, y0), v11 = h(x1, y1), v01 = h(x0, y1);
      let idx = 0;
      if (v00 > level) idx |= 8;
      if (v10 > level) idx |= 4;
      if (v11 > level) idx |= 2;
      if (v01 > level) idx |= 1;
      if (idx === 0 || idx === 15) continue;
      const top = () => interp(x0, y0, v00, x1, y0, v10);
      const right = () => interp(x1, y0, v10, x1, y1, v11);
      const bottom = () => interp(x1, y1, v11, x0, y1, v01);
      const left = () => interp(x0, y1, v01, x0, y0, v00);
      let pairs = [];
      switch (idx) {
        case 1: case 14: pairs = [[left(), bottom()]]; break;
        case 2: case 13: pairs = [[bottom(), right()]]; break;
        case 3: case 12: pairs = [[left(), right()]]; break;
        case 4: case 11: pairs = [[top(), right()]]; break;
        case 6: case 9:  pairs = [[top(), bottom()]]; break;
        case 7: case 8:  pairs = [[left(), top()]]; break;
        case 5:          pairs = [[left(), top()], [bottom(), right()]]; break;
        case 10:         pairs = [[left(), bottom()], [top(), right()]]; break;
      }
      for (const [a, b] of pairs) segs.push([a[0] * W, a[1] * H, b[0] * W, b[1] * H]);
    }
  }
  return joinSegments(segs);
}

/* Stitch loose segments into polylines so strokes are continuous. */
function joinSegments(segs) {
  const key = (x, y) => Math.round(x * 20) + ':' + Math.round(y * 20);
  const map = new Map();
  const push = (k, s) => { if (!map.has(k)) map.set(k, []); map.get(k).push(s); };
  const items = segs.map((s) => ({ s, used: false }));
  for (const it of items) {
    push(key(it.s[0], it.s[1]), it);
    push(key(it.s[2], it.s[3]), it);
  }
  const out = [];
  for (const it of items) {
    if (it.used) continue;
    it.used = true;
    let pts = [[it.s[0], it.s[1]], [it.s[2], it.s[3]]];
    // extend from both ends
    for (let dir = 0; dir < 2; dir++) {
      for (;;) {
        const end = dir === 0 ? pts[pts.length - 1] : pts[0];
        const cand = (map.get(key(end[0], end[1])) || []).find((c) => !c.used);
        if (!cand) break;
        cand.used = true;
        const [ax, ay, bx, by] = cand.s;
        const next = (key(ax, ay) === key(end[0], end[1])) ? [bx, by] : [ax, ay];
        if (dir === 0) pts.push(next); else pts.unshift(next);
      }
    }
    if (pts.length > 2) out.push(pts);
  }
  return out;
}

/* Catmull-Rom -> cubic bezier, for smooth contour and route strokes. */
function smoothPath(pts, closedTol = 6) {
  if (pts.length < 2) return '';
  const closed = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < closedTol;
  const p = pts.slice();
  if (closed) p.pop();
  const n = p.length;
  const at = (i) => p[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  let d = `M ${at(0)[0].toFixed(2)} ${at(0)[1].toFixed(2)}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  if (closed) d += ' Z';
  return d;
}
