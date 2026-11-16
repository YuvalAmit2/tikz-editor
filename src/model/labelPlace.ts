// Smart labels: where to put a label for some objects so that it sits close
// to them without crossing any lines (the inside of a filled shape is fine).
import { dist, ellipsePoint, geomBox, pathSegments, unionBox, type Box } from "./geometry";
import { sampleCurve } from "./curve";
import type { Anchor, LabelObj, Obj, Vec } from "./types";
import { braceTip } from "./wave";

interface Candidate {
  p: Vec;
  anchor: Anchor;
  /** Small preference order (earlier is nicer). */
  rank: number;
}

/** The anchor that makes a label grow away from the object in direction (dx, dy). */
function anchorFor(dx: number, dy: number): Anchor {
  const a = Math.atan2(dy, dx);
  const k = Math.round(a / (Math.PI / 4));
  const names: Anchor[] = ["west", "south west", "south", "south east", "east", "north east", "north", "north west"];
  return names[(k + 8) % 8];
}

/** Stroked pieces of every object, as segments. */
function strokes(objs: Obj[]): [Vec, Vec][] {
  const out: [Vec, Vec][] = [];
  for (const o of objs) {
    if (o.style.stroke === null && o.type !== "point") continue;
    if (o.type === "path") out.push(...pathSegments(o));
    else if (o.type === "curve") {
      const pts = sampleCurve(o, 16);
      for (let i = 0; i + 1 < pts.length; i++) out.push([pts[i], pts[i + 1]]);
    } else if (o.type === "ellipse") {
      for (let k = 0; k < 64; k++) out.push([ellipsePoint(o, (k * Math.PI) / 32), ellipsePoint(o, ((k + 1) * Math.PI) / 32)]);
    } else if (o.type === "point") {
      const r = 0.05;
      out.push([{ x: o.p.x - r, y: o.p.y }, { x: o.p.x + r, y: o.p.y }]);
      out.push([{ x: o.p.x, y: o.p.y - r }, { x: o.p.x, y: o.p.y + r }]);
    }
  }
  return out;
}

/** Does segment ab touch box b? (Liang–Barsky clipping) */
export function segHitsBox(a: Vec, c: Vec, b: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = c.x - a.x;
  const dy = c.y - a.y;
  const tests: [number, number][] = [
    [-dx, a.x - b.minX],
    [dx, b.maxX - a.x],
    [-dy, a.y - b.minY],
    [dy, b.maxY - a.y],
  ];
  for (const [p, q] of tests) {
    if (Math.abs(p) < 1e-15) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}

function anchorFrac(a: Anchor): { fx: number; fy: number } {
  return { fx: a.includes("west") ? 0 : a.includes("east") ? 1 : 0.5, fy: a.includes("south") ? 0 : a.includes("north") ? 1 : 0.5 };
}

function boxAt(p: Vec, anchor: Anchor, size: { w: number; h: number }): Box {
  const { fx, fy } = anchorFrac(anchor);
  const minX = p.x - fx * size.w;
  const minY = p.y - fy * size.h;
  return { minX, minY, maxX: minX + size.w, maxY: minY + size.h };
}

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) * Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));

/** Middle of a closed outline (its area centroid). */
function centroid(ring: Vec[]): Vec {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const c = p.x * q.y - q.x * p.y;
    a += c;
    cx += (p.x + q.x) * c;
    cy += (p.y + q.y) * c;
  }
  if (Math.abs(a) < 1e-12) return ring.reduce((s, p) => ({ x: s.x + p.x / ring.length, y: s.y + p.y / ring.length }), { x: 0, y: 0 });
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** The outermost point where the ray from c in direction d leaves the outline. */
function farthestOnRay(ring: Vec[], c: Vec, d: Vec): Vec | null {
  let best = -1;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const e = { x: b.x - a.x, y: b.y - a.y };
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - c.x) * e.y - (a.y - c.y) * e.x) / den;
    const u = ((a.x - c.x) * d.y - (a.y - c.y) * d.x) / den;
    if (t > 0 && u >= 0 && u <= 1) best = Math.max(best, t);
  }
  return best > 0 ? { x: c.x + d.x * best, y: c.y + d.y * best } : null;
}

function candidates(targets: Obj[], gap: number, near?: Vec): Candidate[] {
  const out: Candidate[] = [];
  let rank = 0;
  const around = (c: Vec, r: number) => {
    // Upper right first (the usual spot for a label), then the others.
    for (const deg of [45, 0, 90, 135, 315, 180, 270, 225]) {
      const a = (deg * Math.PI) / 180;
      const d = { x: Math.cos(a), y: Math.sin(a) };
      out.push({ p: { x: c.x + d.x * r, y: c.y + d.y * r }, anchor: anchorFor(d.x, d.y), rank: rank++ });
    }
  };
  if (targets.length === 1) {
    const o = targets[0];
    if (o.type === "point") around(o.p, gap + 0.04);
    if (o.type === "ellipse") {
      // On the ellipse, pushed outwards.
      for (const deg of [45, 0, 90, 135, 315, 180, 270, 225]) {
        const t = (deg * Math.PI) / 180;
        const q = ellipsePoint(o, t);
        const d = { x: q.x - o.c.x, y: q.y - o.c.y };
        const l = Math.hypot(d.x, d.y) || 1;
        out.push({ p: { x: q.x + (d.x / l) * gap, y: q.y + (d.y / l) * gap }, anchor: anchorFor(d.x, d.y), rank: rank++ });
      }
    }
    if (o.type === "curve" && o.closed) {
      // Just outside the outline, in each direction from its middle (a blob's
      // bounding box can be far from it), a little farther too for a sloping side.
      const ring = sampleCurve(o, 16);
      const cen = centroid(ring);
      for (const deg of [45, 0, 90, 135, 315, 180, 270, 225]) {
        const t = (deg * Math.PI) / 180;
        const d = { x: Math.cos(t), y: Math.sin(t) };
        const hit = farthestOnRay(ring, cen, d);
        if (!hit) continue;
        const r0 = rank++;
        for (const [k, r] of [gap, gap + 0.08, gap + 0.2].entries()) out.push({ p: { x: hit.x + d.x * r, y: hit.y + d.y * r }, anchor: anchorFor(d.x, d.y), rank: r0 + k * 3 });
      }
    }
    if ((o.type === "path" || o.type === "curve") && !o.closed) {
      // Beside the middle of the line, on either side, and past its ends.
      const pts = o.type === "path" ? o.pts : sampleCurve(o, 16);
      // The outer (convex) side of a bent line first: away from its centroid.
      const cen = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
      let total = 0;
      for (let i = 0; i + 1 < pts.length; i++) total += dist(pts[i], pts[i + 1]);
      for (const f of [0.5, 0.35, 0.65]) {
        let acc = 0;
        for (let i = 0; i + 1 < pts.length; i++) {
          const l = dist(pts[i], pts[i + 1]);
          if (acc + l >= total * f && l > 0) {
            const t = (total * f - acc) / l;
            const m = { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
            const n = { x: -(pts[i + 1].y - pts[i].y) / l, y: (pts[i + 1].x - pts[i].x) / l };
            const outward = (m.x - cen.x) * n.x + (m.y - cen.y) * n.y;
            for (const sgn of outward < -1e-9 ? [-1, 1] : [1, -1]) {
              const d = { x: n.x * sgn, y: n.y * sgn };
              out.push({ p: { x: m.x + d.x * gap, y: m.y + d.y * gap }, anchor: anchorFor(d.x, d.y), rank: rank++ });
            }
            break;
          }
          acc += l;
        }
      }
      const ends: [Vec, Vec][] = [
        [pts[pts.length - 1], pts[pts.length - 2]],
        [pts[0], pts[1]],
      ];
      for (const [e, prev] of ends) {
        const d = { x: e.x - prev.x, y: e.y - prev.y };
        const l = Math.hypot(d.x, d.y) || 1;
        out.push({ p: { x: e.x + (d.x / l) * gap, y: e.y + (d.y / l) * gap }, anchor: anchorFor(d.x, d.y), rank: rank++ });
      }
    }
  }
  // Around the bounding box (always: the fallback for anything).
  let b: Box | null = null;
  for (const t of targets) b = unionBox(b, geomBox(t));
  if (b) {
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const g = gap * 0.75;
    const spots: [number, number, number, number][] = [
      [b.maxX + g, b.maxY + g, 1, 1],
      [b.maxX + gap, cy, 1, 0],
      [cx, b.maxY + gap, 0, 1],
      [b.minX - g, b.maxY + g, -1, 1],
      [b.maxX + g, b.minY - g, 1, -1],
      [b.minX - gap, cy, -1, 0],
      [cx, b.minY - gap, 0, -1],
      [b.minX - g, b.minY - g, -1, -1],
    ];
    for (const [x, y, dx, dy] of spots) out.push({ p: { x, y }, anchor: anchorFor(dx, dy), rank: rank++ });
  }
  // Spots on the object itself, last (they win when it was clicked there):
  // outside the middle of a polygon's edges, beside the clicked point of a line.
  if (targets.length === 1) {
    const o = targets[0];
    if (o.type === "path" && o.closed && o.pts.length >= 3) {
      // Outside the middle of each edge (away from the middle of the shape).
      const cen = o.pts.reduce((a, p) => ({ x: a.x + p.x / o.pts.length, y: a.y + p.y / o.pts.length }), { x: 0, y: 0 });
      o.pts.forEach((a, i) => {
        const e = o.pts[(i + 1) % o.pts.length];
        const l = dist(a, e);
        if (l < 1e-9) return;
        const m = { x: (a.x + e.x) / 2, y: (a.y + e.y) / 2 };
        let n = { x: -(e.y - a.y) / l, y: (e.x - a.x) / l };
        if ((m.x - cen.x) * n.x + (m.y - cen.y) * n.y < 0) n = { x: -n.x, y: -n.y };
        out.push({ p: { x: m.x + n.x * gap, y: m.y + n.y * gap }, anchor: anchorFor(n.x, n.y), rank: rank++ });
      });
    }
    if (near && (o.type === "path" || o.type === "curve") && !o.closed) {
      const pts = o.type === "path" ? o.pts : sampleCurve(o, 16);
      let best: { m: Vec; n: Vec; d: number } | null = null;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i];
        const e = pts[i + 1];
        const l = dist(a, e);
        if (l < 1e-9) continue;
        const t = Math.max(0, Math.min(1, ((near.x - a.x) * (e.x - a.x) + (near.y - a.y) * (e.y - a.y)) / (l * l)));
        const m = { x: a.x + (e.x - a.x) * t, y: a.y + (e.y - a.y) * t };
        const d = dist(m, near);
        if (!best || d < best.d) best = { m, n: { x: -(e.y - a.y) / l, y: (e.x - a.x) / l }, d };
      }
      // A box's corner can touch a sloping line: a little farther out too.
      if (best)
        for (const sgn of [1, -1])
          for (const r of [gap, gap + 0.06, gap + 0.12]) {
            const d = { x: best.n.x * sgn, y: best.n.y * sgn };
            out.push({ p: { x: best.m.x + d.x * r, y: best.m.y + d.y * r }, anchor: anchorFor(d.x, d.y), rank: rank++ });
          }
    }
  }
  return out;
}

/** Does a label's (ink) box cross any line of the scene? */
export function labelCrossesLines(b: Box, scene: Obj[], ignore: string[] = []): boolean {
  const ign = new Set(ignore);
  // A hair inside the box: just touching its padding is fine.
  const s = 0.01;
  const inner = { minX: b.minX + s, minY: b.minY + s, maxX: b.maxX - s, maxY: b.maxY - s };
  if (inner.minX > inner.maxX || inner.minY > inner.maxY) return false;
  return strokes(scene.filter((o) => o.type !== "label" && !ign.has(o.id) && !o.hidden)).some(([a, e]) => segHitsBox(a, e, inner));
}

/** Best spot and anchor for a label of the given size labelling `targets`.
 *  The size is the box around the label's visible text (see labelBox), so
 *  the gap is the space between the text and the line. */
export function placeLabel(
  targets: Obj[],
  scene: Obj[],
  size: { w: number; h: number },
  labelBoxOf: (o: LabelObj) => Box | null,
  ignore: string[] = [],
  near?: Vec,
): { p: Vec; anchor: Anchor } {
  // Between the text's box (which has 1pt of padding) and the line: about 1 mm in all.
  const gap = 0.07;
  // A brace's label goes at its tip.
  const brace = targets.length === 1 ? braceTip(targets[0]) : null;
  if (brace) return { p: { x: brace.tip.x + brace.n.x * gap, y: brace.tip.y + brace.n.y * gap }, anchor: anchorFor(brace.n.x, brace.n.y) };
  const ign = new Set(ignore);
  const segs = strokes(scene.filter((o) => o.type !== "label" && !ign.has(o.id) && !o.hidden));
  const labels = scene.filter((o): o is LabelObj => o.type === "label" && !ign.has(o.id)).map(labelBoxOf).filter((b): b is Box => !!b);
  let best: Candidate | null = null;
  let bestScore = Infinity;
  const pad = 0.04;
  let tb: Box | null = null;
  for (const t of targets) tb = unionBox(tb, geomBox(t));
  for (const c of candidates(targets, gap, near)) {
    const b = boxAt(c.p, c.anchor, size);
    const padded = { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
    let hits = 0;
    for (const [a, e] of segs) if (segHitsBox(a, e, padded)) hits++;
    let lab = 0;
    for (const lb of labels) lab += overlap(padded, lb);
    // Labels for several objects shouldn't sit inside their box.
    const inside = targets.length > 1 && tb ? overlap(b, tb) / (size.w * size.h) : 0;
    // Clicked somewhere on the object: the spots nearest that come first.
    const far = near ? Math.hypot((b.minX + b.maxX) / 2 - near.x, (b.minY + b.maxY) / 2 - near.y) : 0;
    const score = hits * 10 + lab * 50 + inside * 5 + c.rank * 0.05 + far * 2;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best ? { p: best.p, anchor: best.anchor } : { p: { x: 0, y: 0 }, anchor: "center" };
}

