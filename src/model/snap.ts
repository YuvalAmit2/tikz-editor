// Snapping: special points of objects (vertices, midpoints, centres,
// quadrant points, intersections), points on objects, the grid, and 15° angles.
import {
  closestOnEllipse,
  closestOnSegment,
  dist,
  ellipsePoint,
  ellipsePolyline,
  lerp,
  pathSegments,
  segEllipseIntersect,
  segIntersect,
} from "./geometry";
import type { EllipseObj, Obj, Vec } from "./types";
import { sampleCurve } from "./curve";

export type SnapKind = "vertex" | "midpoint" | "center" | "quadrant" | "intersection" | "grid-crossing" | "on-object" | "grid" | "angle" | "none";

export interface SnapResult {
  p: Vec;
  kind: SnapKind;
}

export interface SnapIndex {
  points: { p: Vec; kind: SnapKind }[];
  segments: [Vec, Vec][];
  ellipses: EllipseObj[];
}

export function buildSnapIndex(objs: Obj[]): SnapIndex {
  const points: SnapIndex["points"] = [];
  const segments: [Vec, Vec][] = [];
  // Which object (and which piece of it) each segment came from, so that
  // neighbouring pieces of one object don't "intersect" at their shared end.
  const owner: { id: number; i: number; n: number; closed: boolean }[] = [];
  const ellipses: EllipseObj[] = [];
  const addPolyline = (pts: Vec[], closed: boolean, id: number) => {
    const segs = pathSegments({ pts, closed });
    segs.forEach((s, i) => {
      segments.push(s);
      owner.push({ id, i, n: segs.length, closed });
    });
  };
  objs.forEach((o, id) => {
    if (o.type === "path") {
      for (const p of o.pts) points.push({ p, kind: "vertex" });
      for (const [a, b] of pathSegments(o)) points.push({ p: lerp(a, b, 0.5), kind: "midpoint" });
      addPolyline(o.pts, o.closed, id);
    } else if (o.type === "curve") {
      for (const n of o.nodes) points.push({ p: n.p, kind: "vertex" });
      addPolyline(sampleCurve(o, 24), false, id);
    } else if (o.type === "ellipse") {
      ellipses.push(o);
      points.push({ p: o.c, kind: "center" });
      for (let k = 0; k < 4; k++) points.push({ p: ellipsePoint(o, (k * Math.PI) / 2), kind: "quadrant" });
    } else if (o.type === "point" || o.type === "label") {
      points.push({ p: o.p, kind: "vertex" });
    }
  });
  const neighbours = (i: number, j: number) => {
    const a = owner[i];
    const b = owner[j];
    if (a.id !== b.id) return false;
    const d = Math.abs(a.i - b.i);
    return d <= 1 || (a.closed && d === a.n - 1);
  };
  // Intersections: sweep over x so only segments whose boxes overlap are compared.
  const order = segments.map((_, i) => i).sort((i, j) => Math.min(segments[i][0].x, segments[i][1].x) - Math.min(segments[j][0].x, segments[j][1].x));
  const minX = (i: number) => Math.min(segments[i][0].x, segments[i][1].x);
  const maxX = (i: number) => Math.max(segments[i][0].x, segments[i][1].x);
  const minY = (i: number) => Math.min(segments[i][0].y, segments[i][1].y);
  const maxY = (i: number) => Math.max(segments[i][0].y, segments[i][1].y);
  for (let a = 0; a < order.length; a++) {
    const i = order[a];
    const xi = maxX(i);
    for (let b = a + 1; b < order.length && minX(order[b]) <= xi + 1e-12; b++) {
      const j = order[b];
      if (minY(j) > maxY(i) + 1e-12 || maxY(j) < minY(i) - 1e-12) continue;
      if (neighbours(i, j)) continue;
      const x = segIntersect(segments[i][0], segments[i][1], segments[j][0], segments[j][1]);
      if (x) points.push({ p: x, kind: "intersection" });
    }
  }
  for (const e of ellipses)
    for (const [a, b] of segments) for (const x of segEllipseIntersect(a, b, e)) points.push({ p: x, kind: "intersection" });
  for (let i = 0; i < ellipses.length; i++)
    for (let j = i + 1; j < ellipses.length; j++) {
      const poly = ellipsePolyline(ellipses[i], 180);
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k];
        const b = poly[(k + 1) % poly.length];
        for (const x of segEllipseIntersect(a, b, ellipses[j])) points.push({ p: x, kind: "intersection" });
      }
    }
  return { points, segments, ellipses };
}

export interface SnapOptions {
  /** Snap radius in cm (screen radius / zoom). */
  radius: number;
  gridSize: number;
  /** Screen pixels per cm. When given, each coordinate snaps to the nearest
   *  visible grid line only when close to it ("magnetic" grid lines), so you
   *  can slide along a grid line. Without it, points snap to the nearest grid point. */
  gridPx?: number;
  snapToGrid: boolean;
  snapToObjects: boolean;
  /** Shift held: constrain the direction from `from` to multiples of 15°. */
  angleFrom?: Vec | null;
  /** Alt held: no snapping at all. */
  disabled?: boolean;
}

export function snapGrid(p: Vec, g: number): Vec {
  // "+ 0" turns -0 into 0
  return { x: Math.round(p.x / g) * g + 0, y: Math.round(p.y / g) * g + 0 };
}

/** The grid spacing actually drawn at this zoom (doubled until ≥ 12 px:
 *  finer lines only show when zoomed in). */
export function visibleGrid(gridSize: number, pxPerCm: number): number {
  let g = gridSize;
  while (g * pxPerCm < 12) g *= 2;
  return g;
}

/** Each coordinate sticks to a grid line when it's within a band around it. */
export function snapGridLines(p: Vec, gridSize: number, pxPerCm: number, radius: number): SnapResult {
  const g = visibleGrid(gridSize, pxPerCm);
  const band = Math.min(radius * 0.6, g * 0.25);
  const gx = Math.round(p.x / g) * g + 0;
  const gy = Math.round(p.y / g) * g + 0;
  const sx = Math.abs(p.x - gx) <= band;
  const sy = Math.abs(p.y - gy) <= band;
  if (!sx && !sy) return { p, kind: "none" };
  return { p: { x: sx ? gx : p.x, y: sy ? gy : p.y }, kind: "grid" };
}

export function snap(p: Vec, index: SnapIndex | null, o: SnapOptions): SnapResult {
  if (o.disabled) return { p, kind: "none" };

  if (o.angleFrom) {
    const from = o.angleFrom;
    const ang = Math.atan2(p.y - from.y, p.x - from.x);
    const step = Math.PI / 12;
    const a = Math.round(ang / step) * step;
    const dir = { x: Math.cos(a), y: Math.sin(a) };
    let r = (p.x - from.x) * dir.x + (p.y - from.y) * dir.y;
    // Snap the length to the grid along that direction, or to an object
    // point lying (nearly) on the ray.
    if (index && o.snapToObjects) {
      for (const c of index.points) {
        const t = (c.p.x - from.x) * dir.x + (c.p.y - from.y) * dir.y;
        const onRay = { x: from.x + dir.x * t, y: from.y + dir.y * t };
        if (t > 0 && dist(onRay, c.p) < 1e-6 && Math.abs(t - r) < o.radius) return { p: c.p, kind: c.kind };
      }
    }
    if (o.snapToGrid) {
      // Axis-aligned directions land on grid points; diagonal ones snap the length.
      r = Math.round(r / o.gridSize) * o.gridSize;
    }
    return { p: { x: from.x + dir.x * r, y: from.y + dir.y * r }, kind: "angle" };
  }

  if (index && o.snapToObjects) {
    let best: SnapResult | null = null;
    let bd = o.radius;
    // Special points win over everything else; intersections and vertices
    // first when equally close.
    for (const c of index.points) {
      const d = dist(c.p, p);
      if (d < bd - 1e-9) {
        bd = d;
        best = { p: c.p, kind: c.kind };
      }
    }
    if (best) return best;
    // A point on an object that's also on a grid line beats either alone
    // (when the object is near enough to snap onto at all).
    const near = o.radius * 0.6;
    if (o.snapToGrid) {
      const g = o.gridPx ? visibleGrid(o.gridSize, o.gridPx) : o.gridSize;
      const segs: [Vec, Vec][] = index.segments.filter(([a, b]) => dist(closestOnSegment(p, a, b), p) < near);
      for (const e of index.ellipses) {
        const poly = ellipsePolyline(e, 128);
        poly.forEach((a, k) => {
          const b = poly[(k + 1) % poly.length];
          if (dist(closestOnSegment(p, a, b), p) < near) segs.push([a, b]);
        });
      }
      let bestG: Vec | null = null;
      let bg = o.radius;
      for (const [a, b] of segs)
        for (const axis of ["x", "y"] as const) {
          const lo = Math.max(Math.min(a[axis], b[axis]), p[axis] - o.radius);
          const hi = Math.min(Math.max(a[axis], b[axis]), p[axis] + o.radius);
          if (Math.abs(b[axis] - a[axis]) < 1e-12) continue;
          for (let k = Math.ceil(lo / g - 1e-9); k * g <= hi + 1e-9; k++) {
            const v = k * g + 0;
            const t = (v - a[axis]) / (b[axis] - a[axis]);
            if (t < -1e-9 || t > 1 + 1e-9) continue;
            const c = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            c[axis] = v;
            const d = dist(c, p);
            if (d < bg) {
              bg = d;
              bestG = c;
            }
          }
        }
      if (bestG) return { p: bestG, kind: "grid-crossing" };
    }
    let bestOn: Vec | null = null;
    bd = o.radius * 0.6;
    for (const [a, b] of index.segments) {
      const q = closestOnSegment(p, a, b);
      const d = dist(q, p);
      if (d < bd) {
        bd = d;
        bestOn = q;
      }
    }
    for (const e of index.ellipses) {
      const q = closestOnEllipse(e, p);
      const d = dist(q, p);
      if (d < bd) {
        bd = d;
        bestOn = q;
      }
    }
    if (bestOn) return { p: bestOn, kind: "on-object" };
  }

  if (o.snapToGrid && o.gridPx) return snapGridLines(p, o.gridSize, o.gridPx, o.radius);
  if (o.snapToGrid) return { p: snapGrid(p, o.gridSize), kind: "grid" };
  return { p, kind: "none" };
}
