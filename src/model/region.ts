// The region around a point, bounded by the scene's lines (paint bucket).
//
// Every line, curve and ellipse is cut where it crosses the others; the
// stretches between cuts are the edges of a planar graph whose vertices are
// the cut points. From the point, a ray to the right finds the nearest edge;
// walking along edges and always taking the sharpest turn that keeps the
// region on the left goes once around the region's boundary.
import { crossings, cutters, subChain, toChain, type Chain, type Piece } from "./trim";
import { bezierPoint } from "./curve";
import { lerp } from "./geometry";
import type { Obj, Vec } from "./types";

interface Edge {
  /** Vertex ids at the start and end. */
  u: number;
  v: number;
  pieces: Piece[];
  /** Directions leaving u and leaving v (angles). */
  au: number;
  av: number;
  obj: string;
  /** The whole of a closed object with no cuts. */
  whole: boolean;
}

const pt = (p: Piece, t: number): Vec => (p.line ? lerp(p.a, p.b, t) : bezierPoint(p, t));
const reversePiece = (p: Piece): Piece => ({ a: p.b, c1: p.c2, c2: p.c1, b: p.a, line: p.line });

/** Direction (angle) leaving the start of a run of pieces. */
function leaveAngle(ps: Piece[]): number {
  const p = ps[0];
  const q = [p.c1, p.c2, p.b, pt(p, 0.05)].find((c) => Math.hypot(c.x - p.a.x, c.y - p.a.y) > 1e-7) ?? p.b;
  return Math.atan2(q.y - p.a.y, q.x - p.a.x);
}

export interface Region {
  pieces: Piece[];
  /** The region is exactly the inside of this closed object. */
  whole?: string;
}

export function regionAt(objects: Obj[], p: Vec): Region | null {
  const chains: { o: Obj; c: Chain }[] = [];
  for (const o of objects) {
    const c = toChain(o);
    if (c && o.style.stroke !== null) chains.push({ o, c });
  }
  if (!chains.length) return null;

  // Vertices: cut points, merged when close.
  const verts: Vec[] = [];
  const TOL = 0.02;
  const vertexAt = (q: Vec) => {
    const i = verts.findIndex((v) => Math.hypot(v.x - q.x, v.y - q.y) < TOL);
    if (i >= 0) return i;
    verts.push(q);
    return verts.length - 1;
  };

  const edges: Edge[] = [];
  for (const { o, c } of chains) {
    const n = c.pieces.length;
    const others = cutters(chains.filter((x) => x.o !== o).map((x) => x.o));
    let xs = crossings(c, others).map((x) => (c.closed ? x % n : x));
    xs.sort((a, b) => a - b);
    xs = xs.filter((x, k) => k === 0 || x - xs[k - 1] > 1e-4);
    const point = (s: number) => {
      const i = Math.min(Math.floor(s), n - 1);
      return pt(c.pieces[i], s - i);
    };
    const add = (s0: number, s1: number, whole = false) => {
      if (s1 - s0 < 1e-6) return;
      const pieces = subChain(c, s0, s1);
      if (!pieces.length) return;
      const u = vertexAt(point(s0 % n));
      const v = vertexAt(point(s1 % n === 0 && s1 > 0 && !c.closed ? n : s1 % n));
      const rev = [...pieces].reverse().map(reversePiece);
      edges.push({ u, v, pieces, au: leaveAngle(pieces), av: leaveAngle(rev), obj: o.id, whole });
    };
    if (c.closed) {
      if (xs.length === 0) add(0, n, true);
      else xs.forEach((x, k) => add(x, k + 1 < xs.length ? xs[k + 1] : xs[0] + n));
    } else {
      const cuts = [0, ...xs.filter((x) => x > 1e-6 && x < n - 1e-6), n];
      for (let k = 0; k + 1 < cuts.length; k++) add(cuts[k], cuts[k + 1]);
    }
  }

  // Loose ends (a line that stops without meeting anything) bound nothing.
  let alive = edges.map(() => true);
  for (let changed = true; changed; ) {
    changed = false;
    const deg = verts.map(() => 0);
    edges.forEach((e, i) => {
      if (!alive[i]) return;
      deg[e.u]++;
      deg[e.v]++;
    });
    edges.forEach((e, i) => {
      if (alive[i] && e.u !== e.v && (deg[e.u] < 2 || deg[e.v] < 2)) {
        alive[i] = false;
        changed = true;
      }
    });
  }
  const live = edges.filter((_, i) => alive[i]);
  if (!live.length) return null;

  // Half-edges: [edge, forward?]
  type H = { e: Edge; fwd: boolean };
  const from = (h: H) => (h.fwd ? h.e.u : h.e.v);
  const to = (h: H) => (h.fwd ? h.e.v : h.e.u);
  const angle = (h: H) => (h.fwd ? h.e.au : h.e.av);
  const piecesOf = (h: H) => (h.fwd ? h.e.pieces : [...h.e.pieces].reverse().map(reversePiece));
  const out = new Map<number, H[]>();
  for (const e of live)
    for (const fwd of [true, false]) {
      const h = { e, fwd };
      const k = from(h);
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push(h);
    }

  // Nearest edge to the right of p.
  let start: H | null = null;
  let bestX = Infinity;
  for (const e of live)
    for (const pc of e.pieces) {
      const steps = pc.line ? 1 : 32;
      for (let k = 0; k < steps; k++) {
        const a = pt(pc, k / steps);
        const b = pt(pc, (k + 1) / steps);
        if ((a.y > p.y) === (b.y > p.y)) continue;
        const t = (p.y - a.y) / (b.y - a.y);
        const x = a.x + t * (b.x - a.x);
        if (x > p.x && x < bestX) {
          bestX = x;
          // Going up there: p is on its left.
          start = { e, fwd: b.y > a.y };
        }
      }
    }
  if (!start) return null;
  // Reverse the direction of the half-edge for pieces going against the
  // edge's own direction (pieces were checked in edge order).
  const startH: H = start;

  const TAU = 2 * Math.PI;
  const result: Piece[] = [];
  const used: H[] = [];
  let h = startH;
  for (let guard = 0; guard < 4 * live.length + 4; guard++) {
    used.push(h);
    result.push(...piecesOf(h));
    const v = to(h);
    // Direction back along the edge we came in on.
    const back = h.fwd ? h.e.av : h.e.au;
    const cands = out.get(v) ?? [];
    let next: H | null = null;
    let bestTurn = Infinity;
    for (const c of cands) {
      const isBack = c.e === h.e && c.fwd !== h.fwd;
      let cw = (((back - angle(c)) % TAU) + TAU) % TAU;
      if (isBack || cw < 1e-9) cw = TAU;
      if (cw < bestTurn) {
        bestTurn = cw;
        next = c;
      }
    }
    if (!next) return null;
    h = next;
    if (h.e === startH.e && h.fwd === startH.fwd) break;
    if (guard === 4 * live.length + 3) return null;
  }

  // Area: positive when we went round counter-clockwise (a bounded region).
  let area = 0;
  for (const pc of result) {
    const steps = pc.line ? 1 : 16;
    for (let k = 0; k < steps; k++) {
      const a = pt(pc, k / steps);
      const b = pt(pc, (k + 1) / steps);
      area += a.x * b.y - b.x * a.y;
    }
  }
  if (area <= 1e-9) return null;
  const objs = new Set(used.map((x) => x.e.obj));
  if (used.length === 1 && used[0].e.whole) return { pieces: result, whole: used[0].e.obj };
  if (objs.size === 1) {
    const id = [...objs][0];
    const o = objects.find((x) => x.id === id);
    // All of one closed shape (cut only by lines that stay outside it).
    const all = live.filter((e) => e.obj === id).length === used.length && o && (o.type === "ellipse" || ((o.type === "path" || o.type === "curve") && o.closed));
    if (all) return { pieces: result, whole: id };
  }
  return { pieces: result };
}
