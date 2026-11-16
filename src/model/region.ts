// The region around a point, bounded by the scene's lines (paint bucket).
//
// Every line, curve and ellipse is cut where it crosses the others; the
// stretches between cuts are the edges of a planar graph whose vertices are
// the cut points. In each connected group of lines, a ray from the point
// finds the nearest edge; walking along edges and always taking the sharpest
// turn that keeps the region on the left goes once around the face the point
// is in. The smallest such face is the region; groups inside it are holes.
import { chunks, crossings, cutters, subChain, toChain, type Chain, type Piece } from "./trim";
import { bezierPoint } from "./curve";
import { lerp, segIntersect } from "./geometry";
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

/** Direction (angle) leaving the start of a run of pieces: towards the
 *  point 1 mm along it, so curves that touch (leave in the same direction)
 *  are told apart by how they bend. */
function leaveAngle(ps: Piece[]): number {
  const a = ps[0].a;
  let q = ps[ps.length - 1].b;
  outer: for (const pc of ps) {
    const steps = pc.line ? 1 : 24;
    for (let k = 1; k <= steps; k++) {
      const c = pt(pc, k / steps);
      if (Math.hypot(c.x - a.x, c.y - a.y) >= 0.1) {
        q = c;
        break outer;
      }
    }
  }
  if (Math.hypot(q.x - a.x, q.y - a.y) < 1e-9) q = ps[0].b;
  return Math.atan2(q.y - a.y, q.x - a.x);
}

export interface Region {
  pieces: Piece[];
  /** Holes in it (each its own closed outline). */
  holes?: Piece[][];
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
  // Looked up in a grid of TOL-sized cells (there can be thousands). Loose
  // points (where lines touch) join anything within LOOSE.
  const LOOSE = 0.06;
  const loose: boolean[] = [];
  const grid = new Map<string, number[]>();
  const vertexAt = (q: Vec, isLoose = false) => {
    const cx = Math.floor(q.x / TOL);
    const cy = Math.floor(q.y / TOL);
    let best = -1;
    let bd = Infinity;
    for (let dx = -3; dx <= 3; dx++)
      for (let dy = -3; dy <= 3; dy++)
        for (const i of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const d = Math.hypot(verts[i].x - q.x, verts[i].y - q.y);
          if (d < (isLoose || loose[i] ? LOOSE : TOL) && d < bd) {
            bd = d;
            best = i;
          }
        }
    if (best >= 0) {
      if (isLoose) loose[best] = true;
      return best;
    }
    verts.push(q);
    loose.push(isLoose);
    const key = `${cx},${cy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(verts.length - 1);
    return verts.length - 1;
  };

  const edges: Edge[] = [];
  for (const { o, c } of chains) {
    const n = c.pieces.length;
    const others = cutters(chains.filter((x) => x.o !== o).map((x) => x.o));
    const cr = [...crossings(c, others), ...selfCrossings(c)];
    const tc = touches(c, others, cr);
    let xs = [...cr, ...tc].map((x) => (c.closed ? x % n : x));
    xs.sort((a, b) => a - b);
    xs = xs.filter((x, k) => k === 0 || x - xs[k - 1] > 1e-4);
    const point = (s: number) => {
      const i = Math.min(Math.floor(s), n - 1);
      return pt(c.pieces[i], s - i);
    };
    // Where lines touch (several crossings close together, or no crossing at
    // all) the two lines' points can be a little apart: they join more
    // loosely than crossings do.
    const soft = new Set<number>(tc.map((x) => (c.closed ? x % n : x)));
    xs = mergeNear(xs, point, n, c.closed, soft);
    const add = (s0: number, s1: number, whole = false) => {
      if (s1 - s0 < 1e-6) return;
      const pieces = subChain(c, s0, s1);
      if (!pieces.length) return;
      const isSoft = (x: number) => [...soft].some((y) => Math.abs(y - (((x % n) + n) % n)) < 1e-9);
      const u = vertexAt(point(s0 % n), isSoft(s0));
      const v = vertexAt(point(s1 % n === 0 && s1 > 0 && !c.closed ? n : s1 % n), isSoft(s1));
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

  // The face around p in each connected group of lines (the nearest line to
  // the right may be a shape p is outside of, e.g. a hole); the smallest wins.
  const comp = components(live);
  const groups = new Map<number, Edge[]>();
  for (const e of live) {
    const id = comp.get(e)!;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(e);
  }
  let outer: ReturnType<typeof walk> = null;
  for (const es of groups.values()) {
    const w = walk(es, p);
    if (w && w.area > 1e-9 && (!outer || w.area < outer.area)) outer = w;
  }
  if (!outer) return null;
  const { pieces: result, used } = outer;

  // Holes: lines that don't touch the boundary, inside it (a ring between
  // two circles, a disc with punctures). Each is cut out along its outside.
  const usedEdges = new Set(used.map((h) => h.e));
  const touched = new Set(live.filter((e) => usedEdges.has(e)).map((e) => comp.get(e)));
  const outline = sample(result);
  const holes: Piece[][] = [];
  const holePolys: Vec[][] = [];
  const byComp = new Map<number, Edge[]>();
  for (const e of live) {
    const id = comp.get(e)!;
    if (touched.has(id)) continue;
    if (!byComp.has(id)) byComp.set(id, []);
    byComp.get(id)!.push(e);
  }
  for (const es of byComp.values()) {
    if (!inside(es[0].pieces[0].a, outline)) continue;
    const pts = es.flatMap((e) => sample(e.pieces));
    // Its outside: walk round it from a point just left of it.
    const minX = Math.min(...pts.map((q) => q.x));
    const ys = pts.map((q) => q.y);
    const from = { x: minX - 1, y: (Math.min(...ys) + Math.max(...ys)) / 2 + 1e-7 };
    const w = walk(es, from);
    if (!w || w.area >= 0) continue;
    holes.push(w.pieces);
    holePolys.push(sample(w.pieces));
  }
  // A shape inside a hole isn't a hole of this region.
  const keep = holes.filter((_, k) => !holePolys.some((q, j) => j !== k && inside(holePolys[k][0], q)));

  const objs = new Set(used.map((x) => x.e.obj));
  const whole = (id: string) => (keep.length ? { pieces: result, holes: keep } : { pieces: result, whole: id });
  if (used.length === 1 && used[0].e.whole) return whole(used[0].e.obj);
  if (objs.size === 1) {
    const id = [...objs][0];
    const o = objects.find((x) => x.id === id);
    // All of one closed shape (cut only by lines that stay outside it).
    const all = live.filter((e) => e.obj === id).length === used.length && o && (o.type === "ellipse" || ((o.type === "path" || o.type === "curve") && o.closed));
    if (all) return whole(id);
  }
  return keep.length ? { pieces: result, holes: keep } : { pieces: result };
}

type H = { e: Edge; fwd: boolean };

/** Once round the face of the edges' graph that p is in: from the nearest
 *  edge to the right of p, always taking the sharpest turn that keeps the
 *  face on the left. Area > 0: a bounded face, < 0: the outside of them. */
function walk(live: Edge[], p: Vec): { pieces: Piece[]; used: H[]; area: number } | null {
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

  // The nearest edge along a ray from p: to the right, or turned a little
  // when that would pass right by a place where lines meet (ambiguous).
  const ends = live.flatMap((e) => [e.pieces[0].a, e.pieces[e.pieces.length - 1].b]);
  let dir = { x: 1, y: 0 };
  for (const ang of [0, 0.31, -0.29, 0.67, -0.71, 1.13, -1.21, 1.9, 2.6, 3.5, 4.4, 5.3]) {
    const d = { x: Math.cos(ang), y: Math.sin(ang) };
    const clear = ends.every((v) => {
      const along = (v.x - p.x) * d.x + (v.y - p.y) * d.y;
      return along < 0 || Math.abs((v.x - p.x) * d.y - (v.y - p.y) * d.x) > 0.05;
    });
    if (clear) {
      dir = d;
      break;
    }
  }
  // In the ray's own frame: along it (u) and to its left (w).
  const U = (q: Vec) => (q.x - p.x) * dir.x + (q.y - p.y) * dir.y;
  const W = (q: Vec) => -(q.x - p.x) * dir.y + (q.y - p.y) * dir.x;
  let start: H | null = null;
  let bestX = Infinity;
  for (const e of live)
    for (const pc of e.pieces) {
      const steps = pc.line ? 1 : 32;
      for (let k = 0; k < steps; k++) {
        const a = pt(pc, k / steps);
        const b = pt(pc, (k + 1) / steps);
        const wa = W(a);
        const wb = W(b);
        if (wa > 0 === wb > 0) continue;
        const t = wa / (wa - wb);
        const x = U(a) + t * (U(b) - U(a));
        if (x > 0 && x < bestX) {
          bestX = x;
          // Crossing the ray from right to left: p is on its left.
          start = { e, fwd: wb > wa };
        }
      }
    }
  if (!start) return null;
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
  const poly = sample(result);
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k];
    const b = poly[(k + 1) % poly.length];
    area += a.x * b.y - b.x * a.y;
  }
  return { pieces: result, used, area: area / 2 };
}

/** Points along pieces (a polygon for inside tests and areas). */
function sample(ps: Piece[]): Vec[] {
  const out: Vec[] = [];
  for (const pc of ps) {
    const steps = pc.line ? 1 : 16;
    for (let k = 0; k < steps; k++) out.push(pt(pc, k / steps));
  }
  return out;
}

function inside(q: Vec, poly: Vec[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** Connected pieces of the graph: edge -> component number. */
function components(es: Edge[]): Map<Edge, number> {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    // Shorten the path for next time.
    while (x !== r) {
      const nx = parent.get(x)!;
      parent.set(x, r);
      x = nx;
    }
    return r;
  };
  for (const e of es) {
    if (!parent.has(e.u)) parent.set(e.u, e.u);
    if (!parent.has(e.v)) parent.set(e.v, e.v);
    const a = find(e.u);
    const b = find(e.v);
    if (a !== b) parent.set(a, b);
  }
  return new Map(es.map((e) => [e, find(e.u)]));
}

/** Where a chain crosses itself (a loop in a curve), as chain parameters:
 *  both of each crossing. */
function selfCrossings(c: Chain): number[] {
  const segs: { a: Vec; b: Vec; s0: number; s1: number }[] = [];
  c.pieces.forEach((pc, i) => {
    const steps = pc.line ? 1 : 32;
    for (let k = 0; k < steps; k++) segs.push({ a: pt(pc, k / steps), b: pt(pc, (k + 1) / steps), s0: i + k / steps, s1: i + (k + 1) / steps });
  });
  const out: number[] = [];
  const m = segs.length;
  for (let i = 0; i < m; i++) {
    const A = segs[i];
    const ax0 = Math.min(A.a.x, A.b.x);
    const ax1 = Math.max(A.a.x, A.b.x);
    const ay0 = Math.min(A.a.y, A.b.y);
    const ay1 = Math.max(A.a.y, A.b.y);
    for (let j = i + 2; j < m; j++) {
      if (c.closed && i === 0 && j === m - 1) continue;
      const B = segs[j];
      if (Math.max(B.a.x, B.b.x) < ax0 || Math.min(B.a.x, B.b.x) > ax1 || Math.max(B.a.y, B.b.y) < ay0 || Math.min(B.a.y, B.b.y) > ay1) continue;
      const x = segIntersect(A.a, A.b, B.a, B.b);
      if (!x) continue;
      // Not where neighbouring pieces meet (a corner of a polygon).
      const ta = Math.hypot(x.x - A.a.x, x.y - A.a.y) / (Math.hypot(A.b.x - A.a.x, A.b.y - A.a.y) || 1);
      const tb = Math.hypot(x.x - B.a.x, x.y - B.a.y) / (Math.hypot(B.b.x - B.a.x, B.b.y - B.a.y) || 1);
      const sa = A.s0 + (A.s1 - A.s0) * ta;
      const sb = B.s0 + (B.s1 - B.s0) * tb;
      const n = c.pieces.length;
      if (Math.abs(sa - sb) < 1e-6 || (c.closed && Math.abs(Math.abs(sa - sb) - n) < 1e-6)) continue;
      out.push(sa, sb);
    }
  }
  return out;
}

/** Where a chain touches the other lines without crossing them (a circle
 *  inside another one, touching it; a line tangent to a circle), as chain
 *  parameters. Not near a crossing (`cr`). */
function touches(c: Chain, polys: Vec[][], cr: number[]): number[] {
  const TOUCH = 0.004;
  const ch = chunks(polys, TOUCH * 4);
  const n = c.pieces.length;
  const at = (s: number) => {
    const i = Math.min(Math.floor(s), n - 1);
    return pt(c.pieces[i], s - i);
  };
  const distAt = (s: number) => {
    const q = at(s);
    let d = Infinity;
    for (const b of ch) {
      if (q.x < b.x0 || q.x > b.x1 || q.y < b.y0 || q.y > b.y1) continue;
      for (let j = b.j0; j < b.j1; j++) d = Math.min(d, distToSegment(q, b.poly[j], b.poly[j + 1]));
    }
    return d;
  };
  const S: number[] = [];
  for (let i = 0; i < n; i++) for (let k = 0; k < 32; k++) S.push(i + k / 32);
  S.push(n);
  const D = S.map(distAt);
  const crossAt = cr.map(at);
  const out: number[] = [];
  for (let k = 0; k < S.length; k++) {
    if (D[k] > TOUCH * 4) continue;
    const prev = k > 0 ? D[k - 1] : c.closed ? D[S.length - 2] : Infinity;
    const next = k + 1 < S.length ? D[k + 1] : Infinity;
    if (D[k] > prev || D[k] > next) continue;
    const near = at(S[k]);
    if (crossAt.some((x) => Math.hypot(x.x - near.x, x.y - near.y) < 0.05)) continue;
    // The closest point between the neighbouring samples.
    let lo = S[Math.max(0, k - 1)];
    let hi = S[Math.min(S.length - 1, k + 1)];
    for (let it = 0; it < 40; it++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (distAt(m1) < distAt(m2)) hi = m2;
      else lo = m1;
    }
    const s = (lo + hi) / 2;
    if (distAt(s) > TOUCH) continue;
    const q = at(s);
    if (crossAt.some((x) => Math.hypot(x.x - q.x, x.y - q.y) < 0.03)) continue;
    if (out.some((x) => Math.hypot(at(x).x - q.x, at(x).y - q.y) < 0.03)) continue;
    out.push(s);
  }
  return out;
}

function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Crossings very close together are one: where curves touch, their
 *  polylines cross a few times right next to each other. Each group becomes
 *  its middle. */
function mergeNear(xs: number[], point: (s: number) => Vec, n: number, closed: boolean, soft: Set<number>): number[] {
  const NEAR = 0.06;
  if (xs.length < 2) return xs;
  const groups: number[][] = [];
  for (const x of xs) {
    const g = groups[groups.length - 1];
    const q = point(x);
    const last = g ? point(g[g.length - 1]) : null;
    // Close together along the line too (not the two passes of a loop).
    const mid = g ? point((x + g[g.length - 1]) / 2) : null;
    if (g && last && mid && Math.hypot(q.x - last.x, q.y - last.y) < NEAR && Math.hypot(mid.x - q.x, mid.y - q.y) < NEAR) g.push(x);
    else groups.push([x]);
  }
  // Round the end of a closed line: the last group may join the first.
  if (closed && groups.length > 1) {
    const a = point(groups[0][0]);
    const lastG = groups[groups.length - 1];
    const b = point(lastG[lastG.length - 1]);
    const m = point(((((lastG[lastG.length - 1] - n + groups[0][0]) / 2) % n) + n) % n);
    if (Math.hypot(a.x - b.x, a.y - b.y) < NEAR && Math.hypot(m.x - a.x, m.y - a.y) < NEAR) {
      groups.pop();
      groups[0] = [...lastG.map((x) => x - n), ...groups[0]];
    }
  }
  return groups
    .map((g) => {
      const m = g.reduce((a, b) => a + b, 0) / g.length;
      if (g.length > 1) soft.add(closed ? ((m % n) + n) % n : m);
      return closed ? ((m % n) + n) % n : m;
    })
    .sort((a, b) => a - b);
}
