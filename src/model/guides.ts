// Smart guides: while drawing or moving, the point (or the moved selection's
// box) snaps lightly to
//   - alignment: the same x or y as a point or box edge/centre of another object,
//   - equal spacing: the same gap to the neighbours on either side, or the
//     same gap as between two other objects in the row,
//   - symmetry: the mirror image of another point about the vertical or
//     horizontal line through an object's centre.
// The guides found are drawn so you can see why something snapped.
import type { Box } from "./geometry";
import type { Vec } from "./types";

export interface Guide {
  a: Vec;
  b: Vec;
  kind: "align" | "spacing" | "symmetry";
  /** Points the guide relates (marked with a small cross). */
  marks?: Vec[];
}

export interface GuideCtx {
  /** Key points of the other objects: vertices, centres, dots. */
  points: Vec[];
  /** Boxes of the other objects. */
  boxes: Box[];
  /** Mirror axes: x of vertical ones, y of horizontal ones (object centres). */
  axesX: number[];
  axesY: number[];
}

const cx = (b: Box) => (b.minX + b.maxX) / 2;
const cy = (b: Box) => (b.minY + b.maxY) / 2;

export interface GuideResult {
  /** The adjusted point / offset; only the fixed axes changed. */
  x: number | null;
  y: number | null;
  guides: Guide[];
}

/** Guides for a single point p (drawing, dragging a vertex or a dot). */
export function pointGuides(p: Vec, ctx: GuideCtx, r: number): GuideResult {
  // Symmetry first: it fixes both coordinates.
  let sym: { m: Vec; q: Vec; axis: { x?: number; y?: number }; d: number } | null = null;
  for (const q of ctx.points) {
    for (const X of ctx.axesX) {
      if (Math.abs(q.x - X) < r) continue; // on the axis: its mirror is itself
      const m = { x: 2 * X - q.x, y: q.y };
      const d = Math.hypot(m.x - p.x, m.y - p.y);
      if (d < r && (!sym || d < sym.d)) sym = { m, q, axis: { x: X }, d };
    }
    for (const Y of ctx.axesY) {
      if (Math.abs(q.y - Y) < r) continue;
      const m = { x: q.x, y: 2 * Y - q.y };
      const d = Math.hypot(m.x - p.x, m.y - p.y);
      if (d < r && (!sym || d < sym.d)) sym = { m, q, axis: { y: Y }, d };
    }
  }
  // A mirror image that's already an object's point is just that point.
  if (sym && ctx.points.some((q) => Math.hypot(q.x - sym!.m.x, q.y - sym!.m.y) < 1e-6)) sym = null;
  if (sym) {
    const { m, q, axis } = sym;
    const ext = Math.max(r * 2, Math.hypot(q.x - m.x, q.y - m.y) / 2);
    const g: Guide =
      axis.x !== undefined
        ? { a: { x: axis.x, y: Math.min(q.y, m.y) - ext }, b: { x: axis.x, y: Math.max(q.y, m.y) + ext }, kind: "symmetry", marks: [q, m] }
        : { a: { x: Math.min(q.x, m.x) - ext, y: axis.y! }, b: { x: Math.max(q.x, m.x) + ext, y: axis.y! }, kind: "symmetry", marks: [q, m] };
    return { x: m.x, y: m.y, guides: [g, { a: q, b: m, kind: "align", marks: [] }] };
  }

  const out: GuideResult = { x: null, y: null, guides: [] };
  let bx = r;
  let by = r;
  let qx: Vec | null = null;
  let qy: Vec | null = null;
  for (const q of ctx.points) {
    const dx = Math.abs(q.x - p.x);
    // Ties: the nearer point (shorter guide line).
    if (dx < bx - 1e-9 || (qx && Math.abs(dx - bx) < 1e-9 && Math.abs(q.y - p.y) < Math.abs(qx.y - p.y))) {
      if (Math.abs(q.y - p.y) > 1e-9) {
        bx = dx;
        qx = q;
      }
    }
    const dy = Math.abs(q.y - p.y);
    if (dy < by - 1e-9 || (qy && Math.abs(dy - by) < 1e-9 && Math.abs(q.x - p.x) < Math.abs(qy.x - p.x))) {
      if (Math.abs(q.x - p.x) > 1e-9) {
        by = dy;
        qy = q;
      }
    }
  }
  if (qx) out.x = qx.x;
  if (qy) out.y = qy.y;
  const at = { x: out.x ?? p.x, y: out.y ?? p.y };
  if (qx) out.guides.push({ a: qx, b: at, kind: "align", marks: [qx, at] });
  if (qy) out.guides.push({ a: qy, b: at, kind: "align", marks: [qy, at] });
  return out;
}

/** Guides for moving a box by d: returns the adjusted offset. */
export function boxGuides(box: Box, d: Vec, ctx: GuideCtx, r: number): GuideResult {
  const out: GuideResult = { x: null, y: null, guides: [] };
  const b: Box = { minX: box.minX + d.x, maxX: box.maxX + d.x, minY: box.minY + d.y, maxY: box.maxY + d.y };
  for (const axis of ["x", "y"] as const) {
    const X = axis === "x";
    const lo = (q: Box) => (X ? q.minX : q.minY);
    const hi = (q: Box) => (X ? q.maxX : q.maxY);
    const mid = (q: Box) => (X ? cx(q) : cy(q));
    // The other axis: "in the same row", and where guides are drawn.
    const alo = (q: Box) => (X ? q.minY : q.minX);
    const ahi = (q: Box) => (X ? q.maxY : q.maxX);
    const at = (v: number, o: number): Vec => (X ? { x: v, y: o } : { x: o, y: v });
    const across = (q: Box) => (Math.max(alo(q), alo(b)) + Math.min(ahi(q), ahi(b))) / 2;
    const size = hi(b) - lo(b);

    let best = r;
    let shift = 0;
    let found: Guide[] | null = null;
    const offer = (dd: number, gs: () => Guide[], bonus = 0) => {
      if (Math.abs(dd) - bonus < best - 1e-9) {
        best = Math.abs(dd) - bonus;
        shift = dd;
        found = gs();
      }
    };

    // Equal spacing: same gap on both sides, or as between two others in the row.
    const row = ctx.boxes.filter((q) => alo(q) < ahi(b) && ahi(q) > alo(b));
    const L = row.filter((q) => hi(q) <= lo(b) + r).sort((a, c) => hi(c) - hi(a))[0];
    const R = row.filter((q) => lo(q) >= hi(b) - r).sort((a, c) => lo(a) - lo(c))[0];
    const span = (q: Box, from: number, to: number): Guide => ({ a: at(from, across(q)), b: at(to, across(q)), kind: "spacing" });
    if (L && R) {
      const target = (hi(L) + lo(R) - size) / 2;
      const gap = target - hi(L);
      if (gap > 1e-6) offer(target - lo(b), () => [span(L, hi(L), hi(L) + gap), span(R, lo(R) - gap, lo(R))], 1e-6);
    }
    const sorted = [...row].sort((a, c) => lo(a) - lo(c));
    for (let i = 0; i + 1 < sorted.length; i++) {
      const A = sorted[i];
      const C = sorted[i + 1];
      const g = lo(C) - hi(A);
      if (g <= 1e-6) continue;
      if (L && L !== A) offer(hi(L) + g - lo(b), () => [span(A, hi(A), lo(C)), span(L, hi(L), hi(L) + g)], 1e-6);
      if (R && R !== C) offer(lo(R) - g - size - lo(b), () => [span(A, hi(A), lo(C)), span(R, lo(R) - g, lo(R))], 1e-6);
    }
    // Alignment of edges and centres.
    for (const q of ctx.boxes)
      for (const v of [lo(q), mid(q), hi(q)])
        for (const m of [lo(b), mid(b), hi(b)])
          offer(v - m, () => [{ a: at(v, Math.min(alo(q), alo(b))), b: at(v, Math.max(ahi(q), ahi(b))), kind: "align" }]);
    if (found) {
      if (X) out.x = d.x + shift;
      else out.y = d.y + shift;
      out.guides.push(...(found as Guide[]));
    }
  }
  return out;
}
