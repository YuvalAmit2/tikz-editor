// Regular polygons, and the Point tool's dashes (ticks): which way a dash
// across a line should point.
import { bezierPoint } from "./curve";
import { toChain } from "./trim";
import type { Obj, PathObj, PointObj, Vec } from "./types";

/** The corners of a regular n-gon around c, the first at distance r and angle a (radians). */
export function ngonPts(c: Vec, r: number, a: number, n: number): Vec[] {
  const out: Vec[] = [];
  for (let k = 0; k < n; k++) {
    const t = a + (2 * Math.PI * k) / n;
    out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
  }
  return out;
}

/** A regular polygon with n sides instead, the same middle, size and turn. */
export function withSides(o: PathObj, n: number): PathObj {
  const c = o.pts.reduce((a, p) => ({ x: a.x + p.x / o.pts.length, y: a.y + p.y / o.pts.length }), { x: 0, y: 0 });
  const p0 = o.pts[0];
  return { ...o, pts: ngonPts(c, Math.hypot(p0.x - c.x, p0.y - c.y), Math.atan2(p0.y - c.y, p0.x - c.x), n) };
}

/** A tick's two ends (its length is 4 × size pt; cm here). */
export function tickEnds(o: PointObj): [Vec, Vec] {
  const h = ((o.size * 2) / 72.27) * 2.54;
  const t = ((o.angle ?? 90) * Math.PI) / 180;
  const d = { x: Math.cos(t) * h, y: Math.sin(t) * h };
  return [
    { x: o.p.x - d.x, y: o.p.y - d.y },
    { x: o.p.x + d.x, y: o.p.y + d.y },
  ];
}

/** Points along an object's line (a polyline), and whether it closes up. */
function polyline(o: Obj): { pts: Vec[]; closed: boolean } | null {
  const c = toChain(o);
  if (!c) return null;
  const pts: Vec[] = [];
  for (const pc of c.pieces) {
    const steps = pc.line ? 1 : 24;
    for (let k = 0; k < steps; k++) pts.push(pc.line ? (k === 0 ? pc.a : pc.b) : bezierPoint(pc, k / steps));
  }
  const last = c.pieces[c.pieces.length - 1].b;
  if (!c.closed) pts.push(last);
  return { pts, closed: c.closed };
}

/** The angle (degrees) of a dash across the lines through p: square to a
 *  line it's on, along the middle of a corner (diagonal at a square's
 *  corner). Null when p isn't on any line. */
export function normalAngle(p: Vec, objects: Obj[], tol = 0.03): number | null {
  const R = 0.15;
  const dirs: Vec[] = [];
  for (const o of objects) {
    if (o.type === "point" || o.type === "label" || o.hidden) continue;
    const pl = polyline(o);
    if (!pl) continue;
    const { pts, closed } = pl;
    const n = closed ? pts.length : pts.length - 1;
    const lens: number[] = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      lens.push(Math.hypot(b.x - a.x, b.y - a.y));
      total += lens[i];
    }
    // The nearest point on it (as a length along it).
    let best = Infinity;
    let s0 = 0;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const l = lens[i];
      const t = l > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (l * l))) : 0;
      const d = Math.hypot(a.x + (b.x - a.x) * t - p.x, a.y + (b.y - a.y) * t - p.y);
      if (d < best) {
        best = d;
        s0 = acc + t * l;
      }
      acc += l;
    }
    if (best > tol || total < 1e-9) continue;
    const at = (s: number): Vec => {
      if (closed) s = ((s % total) + total) % total;
      let a2 = 0;
      for (let i = 0; i < n; i++) {
        if (a2 + lens[i] >= s || i === n - 1) {
          const t = lens[i] > 0 ? (s - a2) / lens[i] : 0;
          const a = pts[i];
          const b = pts[(i + 1) % pts.length];
          return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        }
        a2 += lens[i];
      }
      return pts[0];
    };
    const r = Math.min(R, closed ? total / 3 : total);
    for (const sgn of [1, -1]) {
      const s = s0 + sgn * r;
      if (!closed && (s < -1e-9 || s > total + 1e-9)) {
        // Near the end: what's left of it, if any.
        const e = sgn > 0 ? total : 0;
        if (Math.abs(e - s0) < 1e-3) continue;
        dirs.push(unit(at(e), p));
        continue;
      }
      dirs.push(unit(at(s), p));
    }
  }
  if (!dirs.length) return null;
  const deg = (v: Vec) => (Math.atan2(v.y, v.x) * 180) / Math.PI;
  // The end of a line: square to it.
  if (dirs.length === 1) return deg(dirs[0]) + 90;
  const sum = dirs.reduce((a, d) => ({ x: a.x + d.x, y: a.y + d.y }), { x: 0, y: 0 });
  // A corner (or where lines end): along its middle.
  if (Math.hypot(sum.x, sum.y) > 0.3) return deg(sum);
  // Lines passing through: square to their average direction.
  let cx = 0;
  let cy = 0;
  for (const d of dirs) {
    const a = 2 * Math.atan2(d.y, d.x);
    cx += Math.cos(a);
    cy += Math.sin(a);
  }
  if (Math.hypot(cx, cy) < 1e-3 * dirs.length) return deg(dirs[0]) + 45;
  return (Math.atan2(cy, cx) * 90) / Math.PI + 90;
}

function unit(q: Vec, p: Vec): Vec {
  const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  return { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
}
