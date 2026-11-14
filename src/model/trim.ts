// Trim: remove the piece of an object between its nearest crossings with
// other objects (like "trim" in CAD programs). Works the same for every
// shape: the object is turned into a chain of line/cubic pieces, cut at the
// crossings around the clicked point, and what's left becomes a path (all
// straight pieces) or a curve with manual handles.
import { curveSegments, bezierPoint, type Seg } from "./curve";
import { closestOnSegment, dist, ellipsePolyline, lerp, pathSegments, segIntersect } from "./geometry";
import { sampleCurve } from "./curve";
import { newId, type CurveNode, type Obj, type Vec } from "./types";

export interface Piece extends Seg {
  line: boolean;
}

export interface Chain {
  pieces: Piece[];
  closed: boolean;
}

const K = 0.5522847498307936; // cubic approximation of a quarter circle

/** An object as a chain of pieces (null: not trimmable). */
export function toChain(o: Obj): Chain | null {
  if (o.type === "path") {
    if (o.pts.length < 2) return null;
    const pieces = pathSegments(o).map(([a, b]) => linePiece(a, b));
    return { pieces, closed: o.closed && o.pts.length >= 3 };
  }
  if (o.type === "curve") {
    const segs = curveSegments(o);
    if (!segs.length) return null;
    return { pieces: segs.map((s) => ({ ...s, line: false })), closed: o.closed && o.nodes.length >= 3 };
  }
  if (o.type === "ellipse") {
    const r = (o.rot * Math.PI) / 180;
    const cs = Math.cos(r);
    const sn = Math.sin(r);
    const P = (x: number, y: number): Vec => ({ x: o.c.x + x * o.rx * cs - y * o.ry * sn, y: o.c.y + x * o.rx * sn + y * o.ry * cs });
    const quarter = (k: number): Piece => {
      const t0 = (k * Math.PI) / 2;
      const t1 = t0 + Math.PI / 2;
      const [x0, y0, x1, y1] = [Math.cos(t0), Math.sin(t0), Math.cos(t1), Math.sin(t1)];
      return { a: P(x0, y0), c1: P(x0 - K * y0, y0 + K * x0), c2: P(x1 + K * y1, y1 - K * x1), b: P(x1, y1), line: false };
    };
    return { pieces: [0, 1, 2, 3].map(quarter), closed: true };
  }
  return null;
}

const linePiece = (a: Vec, b: Vec): Piece => ({ a, c1: lerp(a, b, 1 / 3), c2: lerp(a, b, 2 / 3), b, line: true });

const pieceAt = (p: Piece, t: number): Vec => (p.line ? lerp(p.a, p.b, t) : bezierPoint(p, t));

/** Point at chain parameter s (piece index + local t). */
export function chainPoint(c: Chain, s: number): Vec {
  const i = Math.min(Math.floor(s), c.pieces.length - 1);
  return pieceAt(c.pieces[i], s - i);
}

/** Split a piece at t into [0,t] and [t,1]. */
function splitPiece(p: Piece, t: number): [Piece, Piece] {
  if (p.line) {
    const m = lerp(p.a, p.b, t);
    return [linePiece(p.a, m), linePiece(m, p.b)];
  }
  const ab = lerp(p.a, p.c1, t);
  const bc = lerp(p.c1, p.c2, t);
  const cd = lerp(p.c2, p.b, t);
  const abc = lerp(ab, bc, t);
  const bcd = lerp(bc, cd, t);
  const m = lerp(abc, bcd, t);
  return [
    { a: p.a, c1: ab, c2: abc, b: m, line: false },
    { a: m, c1: bcd, c2: cd, b: p.b, line: false },
  ];
}

/** The part of a piece between t0 and t1 (0 <= t0 < t1 <= 1). */
function subPiece(p: Piece, t0: number, t1: number): Piece {
  let q = p;
  if (t1 < 1) q = splitPiece(q, t1)[0];
  if (t0 > 0) q = splitPiece(q, t0 / t1)[1];
  return q;
}

/** Pieces of the chain from s0 to s1 (s1 may pass the end of a closed chain). */
export function subChain(c: Chain, s0: number, s1: number): Piece[] {
  const n = c.pieces.length;
  const out: Piece[] = [];
  let s = s0;
  while (s1 - s > 1e-9) {
    const i = Math.floor(s + 1e-12);
    const t0 = s - i;
    const e = Math.min(s1, i + 1);
    const t1 = e - i;
    if (t1 - t0 > 1e-9) out.push(subPiece(c.pieces[((i % n) + n) % n], t0, t1));
    s = e;
  }
  return out;
}

/** Pieces back to a scene object. */
export function piecesToObj(pieces: Piece[], base: Obj): Obj | null {
  if (!pieces.length) return null;
  const style = base.style;
  if (pieces.every((p) => p.line)) {
    return { id: newId(), type: "path", style, pts: [pieces[0].a, ...pieces.map((p) => p.b)], closed: false };
  }
  const nodes: CurveNode[] = [];
  const zero = { x: 0, y: 0 };
  pieces.forEach((p, i) => {
    const hin = i === 0 ? zero : { x: pieces[i - 1].c2.x - p.a.x, y: pieces[i - 1].c2.y - p.a.y };
    nodes.push({ p: p.a, mode: "manual", hin, hout: { x: p.c1.x - p.a.x, y: p.c1.y - p.a.y } });
  });
  const last = pieces[pieces.length - 1];
  nodes.push({ p: last.b, mode: "manual", hin: { x: last.c2.x - last.b.x, y: last.c2.y - last.b.y }, hout: zero });
  return { id: newId(), type: "curve", style, nodes, closed: false };
}

/** Other objects as polylines (what the chain gets cut against). */
export function cutters(objs: Obj[]): Vec[][] {
  const out: Vec[][] = [];
  for (const o of objs) {
    if (o.type === "path") out.push(o.closed ? [...o.pts, o.pts[0]] : o.pts);
    else if (o.type === "curve") out.push(sampleCurve(o, 48));
    else if (o.type === "ellipse") {
      const p = ellipsePolyline(o, 256);
      out.push([...p, p[0]]);
    }
  }
  return out;
}

const STEPS = 64;

/** Chain parameters where the chain crosses the cutters (sorted). */
export function crossings(c: Chain, cut: Vec[][]): number[] {
  const out: number[] = [];
  c.pieces.forEach((p, i) => {
    const steps = p.line ? 1 : STEPS;
    for (let k = 0; k < steps; k++) {
      const t0 = k / steps;
      const t1 = (k + 1) / steps;
      const a = pieceAt(p, t0);
      const b = pieceAt(p, t1);
      for (const poly of cut)
        for (let j = 0; j + 1 < poly.length; j++) {
          const x = segIntersect(a, b, poly[j], poly[j + 1]);
          if (!x) continue;
          let t = t0 + (t1 - t0) * (dist(a, x) / (dist(a, b) || 1));
          if (!p.line) t = refine(p, t0, t1, poly[j], poly[j + 1], t);
          out.push(i + t);
        }
    }
  });
  out.sort((x, y) => x - y);
  // Merge duplicates (a crossing exactly at a sample point is found twice).
  return out.filter((s, k) => k === 0 || s - out[k - 1] > 1e-7);
}

/** Bisection on which side of the line (u, v) the piece is. */
function refine(p: Piece, t0: number, t1: number, u: Vec, v: Vec, guess: number): number {
  const side = (t: number) => {
    const q = pieceAt(p, t);
    return (v.x - u.x) * (q.y - u.y) - (v.y - u.y) * (q.x - u.x);
  };
  let lo = t0;
  let hi = t1;
  let flo = side(lo);
  if (flo * side(hi) > 0) return guess;
  for (let k = 0; k < 50; k++) {
    const m = (lo + hi) / 2;
    const fm = side(m);
    if (fm * flo <= 0) hi = m;
    else {
      lo = m;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

/** Chain parameter of the point nearest p. */
export function nearestParam(c: Chain, p: Vec): number {
  let best = 0;
  let bd = Infinity;
  c.pieces.forEach((pc, i) => {
    const steps = pc.line ? 1 : STEPS;
    for (let k = 0; k < steps; k++) {
      const a = pieceAt(pc, k / steps);
      const b = pieceAt(pc, (k + 1) / steps);
      const q = closestOnSegment(p, a, b);
      const d = dist(q, p);
      if (d < bd) {
        bd = d;
        best = i + (k + (dist(a, q) / (dist(a, b) || 1))) / steps;
      }
    }
  });
  return best;
}

export interface TrimResult {
  /** The piece that goes (for the hover preview). */
  removed: Piece[];
  /** What replaces the object (empty: the object is deleted). */
  kept: Obj[];
}

/** Trim object o at point p, cutting against `others`. */
export function trimAt(o: Obj, p: Vec, others: Obj[]): TrimResult | null {
  const c = toChain(o);
  if (!c) return null;
  const n = c.pieces.length;
  const xs = crossings(c, cutters(others));
  const s = nearestParam(c, p);
  if (!c.closed) {
    const inner = xs.filter((x) => x > 1e-6 && x < n - 1e-6);
    const lo = [...inner].reverse().find((x) => x < s) ?? 0;
    const hi = inner.find((x) => x > s) ?? n;
    const kept: Obj[] = [];
    for (const part of [subChain(c, 0, lo), subChain(c, hi, n)]) {
      const obj = piecesToObj(part, o);
      if (obj) kept.push(obj);
    }
    return { removed: subChain(c, lo, hi), kept };
  }
  // Closed: needs two crossings; the piece between them that contains s goes.
  if (xs.length < 2) return { removed: c.pieces, kept: [] };
  let lo = [...xs].reverse().find((x) => x < s);
  let hi = xs.find((x) => x > s);
  if (lo === undefined) lo = xs[xs.length - 1] - n;
  if (hi === undefined) hi = xs[0] + n;
  const removed = subChain(c, lo < 0 ? lo + n : lo, lo < 0 ? hi + n : hi);
  const keep = subChain(c, hi, lo + n);
  const obj = piecesToObj(keep, o);
  return { removed, kept: obj ? [obj] : [] };
}
