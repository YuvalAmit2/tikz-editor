// Geometry helpers: vectors, affine maps, bounding boxes, hit testing.
import type { CurveObj, EllipseObj, Obj, Vec } from "./types";
import { nodeHandles, sampleCurve } from "./curve";

export const PT_PER_CM = 72.27 / 2.54; // TeX points
export const ptToCm = (pt: number) => pt / PT_PER_CM;

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
export const len = (a: Vec) => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boxOf(pts: Vec[]): Box | null {
  if (pts.length === 0) return null;
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pts) {
    b.minX = Math.min(b.minX, p.x);
    b.minY = Math.min(b.minY, p.y);
    b.maxX = Math.max(b.maxX, p.x);
    b.maxY = Math.max(b.maxY, p.y);
  }
  return b;
}

export function unionBox(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Affine map x' = a x + c y + e, y' = b x + d y + f. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
export const translation = (dx: number, dy: number): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: dx, f: dy });

/** Scale by (sx, sy) about the point o. */
export function scalingAbout(o: Vec, sx: number, sy: number): Affine {
  return { a: sx, b: 0, c: 0, d: sy, e: o.x - sx * o.x, f: o.y - sy * o.y };
}

export function rotationAbout(o: Vec, deg: number): Affine {
  const t = (deg * Math.PI) / 180;
  const cs = Math.cos(t);
  const sn = Math.sin(t);
  return { a: cs, b: sn, c: -sn, d: cs, e: o.x - cs * o.x + sn * o.y, f: o.y - sn * o.x - cs * o.y };
}

export const applyAffine = (m: Affine, p: Vec): Vec => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });

/** Ellipse after an arbitrary affine map: write it as L * R(rot) * diag(rx, ry)
 *  applied to the unit circle and take the SVD of that 2x2 matrix. */
export function transformEllipse(o: EllipseObj, m: Affine): EllipseObj {
  const t = (o.rot * Math.PI) / 180;
  const cs = Math.cos(t);
  const sn = Math.sin(t);
  // M = R * diag(rx, ry) = [[cs*rx, -sn*ry], [sn*rx, cs*ry]]
  const M = [
    [cs * o.rx, -sn * o.ry],
    [sn * o.rx, cs * o.ry],
  ];
  // N = L * M with L = [[a, c], [b, d]]
  const N = [
    [m.a * M[0][0] + m.c * M[1][0], m.a * M[0][1] + m.c * M[1][1]],
    [m.b * M[0][0] + m.d * M[1][0], m.b * M[0][1] + m.d * M[1][1]],
  ];
  const { s1, s2, angle } = svd2(N);
  return { ...o, c: applyAffine(m, o.c), rx: s1, ry: s2, rot: normDeg(angle) };
}

/** Singular values of a 2x2 matrix and the angle (deg) of its first left singular vector. */
export function svd2(N: number[][]) {
  const [[p, q], [r, s]] = N;
  const E = (p + s) / 2;
  const F = (p - s) / 2;
  const G = (r + q) / 2;
  const H = (r - q) / 2;
  const Q = Math.hypot(E, H);
  const R = Math.hypot(F, G);
  const s1 = Q + R;
  const s2 = Math.abs(Q - R);
  const a1 = Math.atan2(G, F);
  const a2 = Math.atan2(H, E);
  const angle = ((a2 + a1) / 2) * (180 / Math.PI);
  return { s1, s2, angle };
}

export function normDeg(d: number): number {
  let x = d % 180;
  if (x < 0) x += 180;
  return Math.abs(x - 180) < 1e-9 ? 0 : x;
}

export function transformObj(o: Obj, m: Affine): Obj {
  const r = transformOne(o, m);
  if ((r.type === "path" || r.type === "curve") && r.holes) return { ...r, holes: r.holes.map((h) => transformOne(h, m) as typeof h) };
  return r;
}

function transformOne(o: Obj, m: Affine): Obj {
  // A mirror image of a brace or wave should bulge to the mirrored side, which
  // is the other side of the line: reverse the line.
  if (o.style.wave && !o.parts?.length && m.a * m.d - m.b * m.c < 0) {
    if (o.type === "path") o = { ...o, pts: [...o.pts].reverse() };
    if (o.type === "curve") o = { ...o, nodes: [...o.nodes].reverse().map((n) => ({ ...n, ...(n.hin || n.hout ? { hin: n.hout, hout: n.hin } : {}) })) };
  }
  switch (o.type) {
    case "path":
      return { ...o, pts: o.pts.map((p) => applyAffine(m, p)) };
    case "ellipse":
      return transformEllipse(o, m);
    case "point":
      return { ...o, p: applyAffine(m, o.p) };
    case "label":
      return { ...o, p: applyAffine(m, o.p), ...(o.follow ? { follow: { ...o.follow, ref: applyAffine(m, o.follow.ref) } } : {}), ...(o.inkAt ? { inkAt: applyAffine(m, o.inkAt) } : {}) };
    case "curve":
      return transformCurve(o, m);
  }
}

/** Linear part of an affine map applied to a vector (for handle offsets). */
export const applyLinear = (m: Affine, p: Vec): Vec => ({ x: m.a * p.x + m.c * p.y, y: m.b * p.x + m.d * p.y });

/** Rotations, reflections, uniform scaling and moves (shape-preserving maps). */
export function isSimilarity(m: Affine): boolean {
  const s1 = m.a * m.a + m.b * m.b;
  const s2 = m.c * m.c + m.d * m.d;
  return Math.abs(s1 - s2) < 1e-9 * Math.max(1, s1) && Math.abs(m.a * m.c + m.b * m.d) < 1e-9 * Math.max(1, s1);
}

function transformCurve(o: CurveObj, m: Affine): CurveObj {
  // Automatic handles are recomputed from the anchors, which commutes with
  // shape-preserving maps but not with stretching or shearing. For those, fix
  // every handle at its current value first, so the result is exactly the
  // stretched curve.
  if (!isSimilarity(m)) {
    const hs = nodeHandles(o);
    const zero = { x: 0, y: 0 };
    o = { ...o, nodes: o.nodes.map((n, j) => (n.mode === "manual" ? n : { p: n.p, mode: "manual" as const, hin: hs[j].hin ?? zero, hout: hs[j].hout ?? zero })) };
  }
  return {
    ...o,
    nodes: o.nodes.map((n) => ({
      ...n,
      p: applyAffine(m, n.p),
      ...(n.hin ? { hin: applyLinear(m, n.hin) } : {}),
      ...(n.hout ? { hout: applyLinear(m, n.hout) } : {}),
    })),
  };
}

/** Point on an ellipse at parameter t (radians). */
export function ellipsePoint(o: EllipseObj, t: number): Vec {
  const r = (o.rot * Math.PI) / 180;
  const x = o.rx * Math.cos(t);
  const y = o.ry * Math.sin(t);
  return { x: o.c.x + x * Math.cos(r) - y * Math.sin(r), y: o.c.y + x * Math.sin(r) + y * Math.cos(r) };
}

export function ellipseBox(o: EllipseObj): Box {
  const r = (o.rot * Math.PI) / 180;
  const hw = Math.hypot(o.rx * Math.cos(r), o.ry * Math.sin(r));
  const hh = Math.hypot(o.rx * Math.sin(r), o.ry * Math.cos(r));
  return { minX: o.c.x - hw, maxX: o.c.x + hw, minY: o.c.y - hh, maxY: o.c.y + hh };
}

/** Bounding box of the geometry of an object (labels: just the anchor point). */
export function geomBox(o: Obj): Box | null {
  switch (o.type) {
    case "path":
      return boxOf(o.pts);
    case "ellipse":
      return ellipseBox(o);
    case "point":
    case "label":
      return boxOf([o.p]);
    case "curve":
      return boxOf(sampleCurve(o));
  }
}

/** Natural size of a figure: the box of everything except labels. Labels
 *  are included only when the figure has nothing else. */
export function sceneGeomBox(objs: Obj[]): Box | null {
  let b: Box | null = null;
  for (const o of objs) if (o.type !== "label") b = unionBox(b, geomBox(o));
  if (!b) for (const o of objs) b = unionBox(b, geomBox(o));
  return b;
}

export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, lerp(a, b, t));
}

export function closestOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return lerp(a, b, t);
}

export function pathSegments(o: { pts: Vec[]; closed: boolean }): [Vec, Vec][] {
  const s: [Vec, Vec][] = [];
  for (let i = 0; i + 1 < o.pts.length; i++) s.push([o.pts[i], o.pts[i + 1]]);
  if (o.closed && o.pts.length > 2) s.push([o.pts[o.pts.length - 1], o.pts[0]]);
  return s;
}

export function pointInPolygon(p: Vec, pts: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Ellipse in its own frame: p -> (u, v) with the ellipse = unit circle. */
function ellipseLocal(o: EllipseObj, p: Vec): Vec {
  const r = (-o.rot * Math.PI) / 180;
  const dx = p.x - o.c.x;
  const dy = p.y - o.c.y;
  return { x: (dx * Math.cos(r) - dy * Math.sin(r)) / (o.rx || 1e-9), y: (dx * Math.sin(r) + dy * Math.cos(r)) / (o.ry || 1e-9) };
}

/** Closest point on an ellipse (sampled, then refined). */
export function closestOnEllipse(o: EllipseObj, p: Vec): Vec {
  let bestT = 0;
  let best = Infinity;
  const N = 72;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * 2 * Math.PI;
    const d = dist(ellipsePoint(o, t), p);
    if (d < best) {
      best = d;
      bestT = t;
    }
  }
  let step = (2 * Math.PI) / N;
  for (let k = 0; k < 20; k++) {
    step /= 2;
    for (const t of [bestT - step, bestT + step]) {
      const d = dist(ellipsePoint(o, t), p);
      if (d < best) {
        best = d;
        bestT = t;
      }
    }
  }
  return ellipsePoint(o, bestT);
}

/** Distance (cm) from p to the object, 0 if inside a filled shape.
 *  Labels need their rendered size, given by labelBox. */
export function hitDistance(o: Obj, p: Vec, labelBox?: (o: Obj) => Box | null): number {
  switch (o.type) {
    case "path": {
      let d = Infinity;
      for (const [a, b] of pathSegments(o)) d = Math.min(d, distToSegment(p, a, b));
      if (o.pts.length === 1) d = dist(p, o.pts[0]);
      if (o.closed && o.style.fill && pointInPolygon(p, o.pts)) d = 0;
      return d;
    }
    case "ellipse": {
      const q = ellipseLocal(o, p);
      if (o.style.fill && q.x * q.x + q.y * q.y <= 1) return 0;
      return dist(p, closestOnEllipse(o, p));
    }
    case "point":
      return Math.max(0, dist(p, o.p) - ptToCm(o.size));
    case "curve": {
      const pts = sampleCurve(o);
      let d = Infinity;
      for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, distToSegment(p, pts[i], pts[i + 1]));
      if (pts.length === 1) d = dist(p, pts[0]);
      if (o.closed && o.style.fill && pointInPolygon(p, pts)) d = 0;
      return d;
    }
    case "label": {
      const b = labelBox?.(o);
      if (!b) return dist(p, o.p);
      const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX);
      const dy = Math.max(b.minY - p.y, 0, p.y - b.maxY);
      return Math.hypot(dx, dy);
    }
  }
}

/** Does the object lie entirely inside the box? (for marquee selection) */
export function insideBox(o: Obj, b: Box, labelBox?: (o: Obj) => Box | null): boolean {
  const ob = o.type === "label" ? (labelBox?.(o) ?? geomBox(o)) : geomBox(o);
  if (!ob) return false;
  return ob.minX >= b.minX && ob.maxX <= b.maxX && ob.minY >= b.minY && ob.maxY <= b.maxY;
}

/** Intersection of segments ab and cd, if any. */
export function segIntersect(a: Vec, b: Vec, c: Vec, d: Vec): Vec | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return lerp(a, b, t);
}

/** Intersections of segment ab with an ellipse. */
export function segEllipseIntersect(a: Vec, b: Vec, o: EllipseObj): Vec[] {
  const p = ellipseLocal(o, a);
  const q = ellipseLocal(o, b);
  const d = sub(q, p);
  const A = dot(d, d);
  const B = 2 * dot(p, d);
  const C = dot(p, p) - 1;
  const disc = B * B - 4 * A * C;
  if (A === 0 || disc < 0) return [];
  const out: Vec[] = [];
  for (const sgn of [-1, 1]) {
    const t = (-B + sgn * Math.sqrt(disc)) / (2 * A);
    if (t >= -1e-9 && t <= 1 + 1e-9) out.push(lerp(a, b, t));
  }
  return out;
}

/** Segments approximating an ellipse (for ellipse-ellipse intersections). */
export function ellipsePolyline(o: EllipseObj, n = 96): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i < n; i++) pts.push(ellipsePoint(o, (i / n) * 2 * Math.PI));
  return pts;
}
