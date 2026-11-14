// Sketch tool: turn a rough mouse/trackpad stroke into a clean shape.
//
//   1. resample the stroke to even spacing and smooth out jitter
//   2. find corners (sharp turns)
//   3. fit the fewest cubic Bézier pieces between corners that stay within a
//      tolerance (Schneider's algorithm, Graphics Gems 1990)
//   4. optionally recognise a line, polygon, rectangle, circle or ellipse
// The result is an ordinary editable curve (or shape).
import type { CurveNode, Vec } from "./types";
import type { Seg } from "./curve";
import { bezierPoint } from "./curve";

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const len = (a: Vec) => Math.hypot(a.x, a.y);
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const norm = (a: Vec): Vec => {
  const l = len(a);
  return l < 1e-12 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};

export function pathLength(pts: Vec[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

/** Points at equal arc-length spacing along the polyline. */
export function resample(pts: Vec[], spacing: number): Vec[] {
  if (pts.length < 2) return pts.slice();
  const out: Vec[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let seg = dist(a, b);
    while (carry + seg >= spacing) {
      const t = (spacing - carry) / seg;
      a = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      out.push(a);
      seg = dist(a, b);
      carry = 0;
    }
    carry += seg;
  }
  const last = pts[pts.length - 1];
  if (dist(out[out.length - 1], last) > spacing * 0.3) out.push(last);
  else out[out.length - 1] = last;
  return out;
}

/** Moving-average smoothing; endpoints (and a closed stroke's seam) stay put. */
export function smooth(pts: Vec[], passes: number, closed: boolean): Vec[] {
  let p = pts.slice();
  const n = p.length;
  if (n < 3) return p;
  for (let k = 0; k < passes; k++) {
    const q = p.slice();
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      const a = p[(i - 1 + n) % n];
      const b = p[(i + 1) % n];
      q[i] = { x: (a.x + 2 * p[i].x + b.x) / 4, y: (a.y + 2 * p[i].y + b.y) / 4 };
    }
    p = q;
  }
  return p;
}

/** Indices of corners: local maxima of the turning angle over a window. */
export function findCorners(pts: Vec[], closed: boolean, minAngleDeg = 55): number[] {
  const n = pts.length;
  const k = Math.max(2, Math.min(6, Math.floor(n / 8)));
  const turn: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (!closed && (i < k || i >= n - k)) continue;
    const a = pts[(i - k + n) % n];
    const b = pts[i];
    const c = pts[(i + k) % n];
    const u = norm(sub(b, a));
    const v = norm(sub(c, b));
    turn[i] = Math.acos(Math.max(-1, Math.min(1, dot(u, v)))) * (180 / Math.PI);
  }
  const corners: number[] = [];
  for (let i = 0; i < n; i++) {
    if (turn[i] < minAngleDeg) continue;
    let isMax = true;
    for (let j = -k; j <= k && isMax; j++) {
      if (j === 0) continue;
      const idx = closed ? (i + j + n) % n : i + j;
      if (idx < 0 || idx >= n) continue;
      if (turn[idx] > turn[i] || (turn[idx] === turn[i] && j < 0)) isMax = false;
    }
    if (isMax) corners.push(i);
  }
  return corners;
}

// ---------------------------------------------------------------- Schneider

function chordParams(pts: Vec[]): number[] {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + dist(pts[i], pts[i - 1]));
  const L = u[u.length - 1] || 1;
  return u.map((x) => x / L);
}

function generateBezier(pts: Vec[], u: number[], t1: Vec, t2: Vec): Seg {
  const a = pts[0];
  const b = pts[pts.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i];
    const s = 1 - t;
    const b0 = s * s * s, b1 = 3 * t * s * s, b2 = 3 * t * t * s, b3 = t * t * t;
    const A1 = mul(t1, b1);
    const A2 = mul(t2, b2);
    c00 += dot(A1, A1);
    c01 += dot(A1, A2);
    c11 += dot(A2, A2);
    const tmp = sub(pts[i], add(mul(a, b0 + b1), mul(b, b2 + b3)));
    x0 += dot(A1, tmp);
    x1 += dot(A2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let al = det === 0 ? 0 : (x0 * c11 - x1 * c01) / det;
  let ar = det === 0 ? 0 : (c00 * x1 - c01 * x0) / det;
  const segLen = dist(a, b);
  const eps = 1e-6 * segLen;
  if (al < eps || ar < eps) al = ar = segLen / 3;
  return { a, c1: add(a, mul(t1, al)), c2: add(b, mul(t2, ar)), b };
}

function maxError(pts: Vec[], s: Seg, u: number[]): { err: number; at: number } {
  let err = 0;
  let at = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = dist(bezierPoint(s, u[i]), pts[i]);
    if (d > err) {
      err = d;
      at = i;
    }
  }
  return { err, at };
}

/** Newton-Raphson step improving the parameter of each point. */
function reparameterize(s: Seg, pts: Vec[], u: number[]): number[] {
  return u.map((t, i) => {
    const P = pts[i];
    const q = bezierPoint(s, t);
    const s1 = 1 - t;
    const d1 = add(add(mul(sub(s.c1, s.a), 3 * s1 * s1), mul(sub(s.c2, s.c1), 6 * s1 * t)), mul(sub(s.b, s.c2), 3 * t * t));
    const d2 = add(mul(add(sub(s.c2, mul(s.c1, 2)), s.a), 6 * s1), mul(add(sub(s.b, mul(s.c2, 2)), s.c1), 6 * t));
    const diff = sub(q, P);
    const den = dot(d1, d1) + dot(diff, d2);
    if (Math.abs(den) < 1e-12) return t;
    return Math.max(0, Math.min(1, t - dot(diff, d1) / den));
  });
}

function fitCubic(pts: Vec[], t1: Vec, t2: Vec, tol: number, out: Seg[], depth = 0) {
  if (pts.length === 2) {
    const d = dist(pts[0], pts[1]) / 3;
    out.push({ a: pts[0], c1: add(pts[0], mul(t1, d)), c2: add(pts[1], mul(t2, d)), b: pts[1] });
    return;
  }
  let u = chordParams(pts);
  let s = generateBezier(pts, u, t1, t2);
  let { err, at } = maxError(pts, s, u);
  if (err < tol) return void out.push(s);
  if (err < tol * 4) {
    for (let k = 0; k < 6; k++) {
      u = reparameterize(s, pts, u);
      s = generateBezier(pts, u, t1, t2);
      ({ err, at } = maxError(pts, s, u));
      if (err < tol) return void out.push(s);
    }
  }
  if (depth > 12) return void out.push(s);
  // Split at the worst point with a shared tangent there.
  at = Math.max(1, Math.min(pts.length - 2, at));
  const tc = norm(sub(pts[at - 1], pts[at + 1]));
  fitCubic(pts.slice(0, at + 1), t1, tc, tol, out, depth + 1);
  fitCubic(pts.slice(at), mul(tc, -1), t2, tol, out, depth + 1);
}

function endTangent(pts: Vec[], fromStart: boolean): Vec {
  const n = pts.length;
  const k = Math.min(3, n - 1);
  return fromStart ? norm(sub(pts[k], pts[0])) : norm(sub(pts[n - 1 - k], pts[n - 1]));
}

/** Fit Bézier pieces to the points (open) with the given max error. */
export function fitBeziers(pts: Vec[], tol: number): Seg[] {
  if (pts.length < 2) return [];
  const out: Seg[] = [];
  fitCubic(pts, endTangent(pts, true), endTangent(pts, false), tol, out);
  return out;
}

// ---------------------------------------------------------------- results

export type Recognized =
  | { kind: "line"; a: Vec; b: Vec }
  | { kind: "polygon"; pts: Vec[]; closed: boolean }
  | { kind: "ellipse"; c: Vec; rx: number; ry: number; rot: number };

export interface SketchResult {
  nodes: CurveNode[];
  closed: boolean;
  shape: Recognized | null;
}

function maxDevFromChord(pts: Vec[]): number {
  const a = pts[0];
  const b = pts[pts.length - 1];
  const d = sub(b, a);
  const L = len(d);
  if (L < 1e-12) return Math.max(...pts.map((p) => dist(p, a)));
  let m = 0;
  for (const p of pts) m = Math.max(m, Math.abs(d.x * (p.y - a.y) - d.y * (p.x - a.x)) / L);
  return m;
}

/** Principal axes of a closed stroke (for ellipse recognition). */
function fitEllipse(pts: Vec[]): { c: Vec; rx: number; ry: number; rot: number; err: number } {
  // Centroid of the polygon area (more robust than the point average when
  // the stroke speed varies), then second moments of the outline.
  let A = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const cr = p.x * q.y - q.x * p.y;
    A += cr;
    cx += (p.x + q.x) * cr;
    cy += (p.y + q.y) * cr;
  }
  const c = Math.abs(A) > 1e-12 ? { x: cx / (3 * A), y: cy / (3 * A) } : { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const rot = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  // Radii: extent along each axis (average of the far points on both sides).
  let ux = 0, uy = 0;
  const us: Vec[] = pts.map((p) => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return { x: dx * cs + dy * sn, y: -dx * sn + dy * cs };
  });
  for (const u of us) {
    ux = Math.max(ux, Math.abs(u.x));
    uy = Math.max(uy, Math.abs(u.y));
  }
  // The max overshoots for wobbly strokes; use the RMS of the radius scaled.
  let sx = 0, sy = 0;
  for (const u of us) {
    sx += u.x * u.x;
    sy += u.y * u.y;
  }
  const rx = Math.sqrt((2 * sx) / us.length);
  const ry = Math.sqrt((2 * sy) / us.length);
  // Error: how far points are from the ellipse, relative to its size.
  let err = 0;
  for (const u of us) {
    const r = Math.hypot(u.x / (rx || 1e-9), u.y / (ry || 1e-9));
    err = Math.max(err, Math.abs(r - 1));
  }
  void ux;
  void uy;
  return { c, rx, ry, rot: (rot * 180) / Math.PI, err };
}

/**
 * Turn a stroke into a curve. `tol` is the allowed error (cm) of the fit;
 * `spacing` the resampling distance (cm, about 2 screen px).
 */
export function processStroke(raw: Vec[], opts: { tol: number; spacing: number; closeDist: number; recognize: boolean }): SketchResult | null {
  // Drop repeated points
  const clean: Vec[] = [];
  for (const p of raw) if (!clean.length || dist(clean[clean.length - 1], p) > 1e-9) clean.push(p);
  if (clean.length < 2) return null;
  const total = pathLength(clean);
  if (total < opts.spacing * 3) return null;
  let closed = dist(clean[0], clean[clean.length - 1]) < Math.max(opts.closeDist, total * 0.06) && total > opts.closeDist * 6;

  let pts = resample(clean, opts.spacing);
  if (closed) {
    // Close the loop: drop the overlap at the seam
    while (pts.length > 4 && dist(pts[pts.length - 1], pts[0]) < opts.spacing * 1.5) pts.pop();
  }
  pts = smooth(pts, 3, closed);
  if (pts.length < 3) closed = false;

  let corners = findCorners(pts, closed);
  if (closed && corners.length > 0) {
    // Start the loop at a corner so every piece runs corner to corner
    const c0 = corners[0];
    pts = [...pts.slice(c0), ...pts.slice(0, c0)];
    corners = corners.map((c) => (c - c0 + pts.length) % pts.length);
  }

  // Pieces between corners (closed: around the loop)
  const pieces: Vec[][] = [];
  if (closed) {
    const cs = corners.length ? corners : [0];
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i];
      const b = i + 1 < cs.length ? cs[i + 1] : pts.length;
      pieces.push([...pts.slice(a, b), pts[b % pts.length]]);
    }
  } else {
    const cs = [0, ...corners, pts.length - 1];
    for (let i = 0; i + 1 < cs.length; i++) pieces.push(pts.slice(cs[i], cs[i + 1] + 1));
  }

  // Shape recognition
  let shape: Recognized | null = null;
  if (opts.recognize) shape = recognize(pts, pieces, corners, closed, total, opts.tol);

  // Fit. A smooth closed loop without corners: fit it as an open stroke from
  // its seam with matching end tangents.
  const nodes: CurveNode[] = [];
  const pushSegs = (segs: Seg[], firstIsCorner: boolean) => {
    segs.forEach((s, i) => {
      const prev = nodes[nodes.length - 1];
      // Pieces meet end to start: one anchor there, not two on top of each other.
      if (prev && dist(prev.p, s.a) < 1e-9) {
        prev.hout = sub(s.c1, s.a);
        if (i === 0 && firstIsCorner) prev.mode = "manual";
      } else nodes.push({ p: s.a, mode: "manual", hin: { x: 0, y: 0 }, hout: sub(s.c1, s.a) });
      nodes.push({ p: s.b, mode: "manual", hin: sub(s.c2, s.b), hout: { x: 0, y: 0 } });
    });
  };
  if (closed && corners.length === 0) {
    const n = pts.length;
    const t = norm(sub(pts[1], pts[n - 1]));
    const ring = [...pts, pts[0]];
    const out: Seg[] = [];
    fitCubic(ring, t, mul(t, -1), opts.tol, out);
    pushSegs(out, false);
  } else {
    for (const piece of pieces) pushSegs(fitBeziers(piece, opts.tol), true);
  }
  if (closed && nodes.length > 1 && dist(nodes[0].p, nodes[nodes.length - 1].p) < 1e-9) {
    nodes[0].hin = nodes[nodes.length - 1].hin;
    nodes.pop();
  }
  return { nodes, closed: closed && nodes.length >= 3, shape };
}

function recognize(pts: Vec[], pieces: Vec[][], corners: number[], closed: boolean, total: number, tol: number): Recognized | null {
  const straight = (p: Vec[]) => maxDevFromChord(p) < Math.max(tol * 1.5, pathLength(p) * 0.045);
  if (!closed) {
    if (pieces.length === 1 && straight(pts)) return { kind: "line", a: pts[0], b: pts[pts.length - 1] };
    if (pieces.length >= 2 && pieces.every(straight)) return { kind: "polygon", pts: [pieces[0][0], ...pieces.map((p) => p[p.length - 1])], closed: false };
    return null;
  }
  if (corners.length >= 3 && corners.length <= 8 && pieces.every(straight)) {
    let poly = pieces.map((p) => p[0]);
    if (poly.length === 4) poly = squareUp(poly);
    return { kind: "polygon", pts: poly, closed: true };
  }
  if (corners.length <= 1) {
    const e = fitEllipse(pts);
    if (e.err < 0.22 && total > 0) {
      let { rx, ry, rot } = e;
      if (Math.min(rx, ry) / Math.max(rx, ry) > 0.86) {
        rx = ry = (rx + ry) / 2;
        rot = 0;
      } else {
        // Nearly axis-aligned: make it exactly so
        const r = ((rot % 180) + 180) % 180;
        if (r < 8 || r > 172) rot = 0;
        else if (Math.abs(r - 90) < 8) {
          [rx, ry] = [ry, rx];
          rot = 0;
        }
      }
      return { kind: "ellipse", c: e.c, rx, ry, rot };
    }
  }
  return null;
}

/** A 4-gon with near-right angles and near-axis-aligned sides -> exact rectangle. */
function squareUp(p: Vec[]): Vec[] {
  const angOk = p.every((v, i) => {
    const a = norm(sub(p[(i + 3) % 4], v));
    const b = norm(sub(p[(i + 1) % 4], v));
    return Math.abs(dot(a, b)) < 0.26; // within ~15° of 90°
  });
  if (!angOk) return p;
  const edgeAng = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x) * (180 / Math.PI);
  const off = Math.abs(((edgeAng % 90) + 90) % 90);
  if (off > 12 && off < 78) return p;
  const xs = p.map((q) => q.x).sort((a, b) => a - b);
  const ys = p.map((q) => q.y).sort((a, b) => a - b);
  const x0 = (xs[0] + xs[1]) / 2, x1 = (xs[2] + xs[3]) / 2, y0 = (ys[0] + ys[1]) / 2, y1 = (ys[2] + ys[3]) / 2;
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}
