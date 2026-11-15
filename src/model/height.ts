// "Show height": where two objects cross, the one in front goes over and the
// one behind has a gap in its line there (knots, braids, a curve passing in
// front of a surface). Each of the two lists the other in `cross`; which one
// goes over is the drawing order, so ⌘] / ⌘[ swap them. Only the line gets
// gaps: fills stay whole (the old white-line trick covered them too).
import { chainPoint, crossings, cutters, subChain, toChain, type Chain, type Piece } from "./trim";
import { styledRuns, type Run } from "./parts";
import { waved } from "./wave";
import { closestOnSegment, dist, ptToCm } from "./geometry";
import type { Obj, Vec } from "./types";

const LINE = new Set(["path", "curve", "ellipse"]);

/** Can this object take part in "Show height"? */
export const crossable = (o: Obj) => LINE.has(o.type) && !!o.style.stroke;

/** Do a and b show which is on top where they cross? */
export const showsHeight = (a: Obj, b: Obj) => !!(a.cross?.includes(b.id) || b.cross?.includes(a.id));

/** The objects that go over o: shown with it, and drawn after it. */
export function overOf(o: Obj, objects: Obj[]): Obj[] {
  if (!crossable(o)) return [];
  const i = objects.findIndex((x) => x.id === o.id);
  if (i < 0) return [];
  const out: Obj[] = [];
  for (let j = i + 1; j < objects.length; j++) {
    const x = objects[j];
    if (!x.hidden && crossable(x) && (o.cross?.includes(x.id) || x.cross?.includes(o.id))) out.push(x);
  }
  return out;
}

/** The line an object draws (a wave's or brace's own line). */
const drawn = (o: Obj): Obj => waved(o) ?? o;

/** Do the lines of a and b cross? */
export function cross(a: Obj, b: Obj): boolean {
  const c = toChain(drawn(a));
  return !!c && crossings(c, cutters([drawn(b)])).length > 0;
}

export interface Stroke {
  runs: Run[];
  /** Filled with this (stroke off), or nothing. */
  fill: Obj | null;
  arrowStart: boolean;
  arrowEnd: boolean;
}

/** The object's line as stretches with their own look: pieces styled on
 *  their own (model/parts.ts) and gaps where something goes over it. Null
 *  when it's drawn as one plain line. */
export function strokeRuns(o: Obj, objects: Obj[]): Stroke | null {
  if (!LINE.has(o.type)) return null;
  const over = overOf(o, objects);
  const parted = o.parts?.length ? styledRuns(o, objects) : null;
  if (!parted && !over.length) return null;
  const line = drawn(o);
  let runs: Run[];
  let closed = false;
  if (parted) runs = parted;
  else {
    const c = toChain(line);
    if (!c) return null;
    closed = c.closed;
    runs = [{ pieces: c.pieces, style: line.style, first: !c.closed, last: !c.closed }];
  }
  if (over.length) {
    const cut = over.map((x) => ({ x, polys: cutters([drawn(x)]) }));
    runs = runs.flatMap((r) => withGaps(r, closed && runs.length === 1, cut));
  }
  const fill = o.style.fill ? ({ ...line, parts: undefined, style: { ...line.style, stroke: null, mid: undefined } } as Obj) : null;
  return { runs, fill, arrowStart: line.style.arrowStart, arrowEnd: line.style.arrowEnd };
}

/** Lengths along a chain, sampled (to go between parameter and length). */
function lengths(c: Chain): { s: number[]; l: number[] } {
  const s = [0];
  const l = [0];
  c.pieces.forEach((p, i) => {
    const steps = p.line ? 1 : 24;
    let prev = chainPoint(c, i);
    for (let k = 1; k <= steps; k++) {
      const q = chainPoint(c, Math.min(i + k / steps, c.pieces.length - 1e-12));
      s.push(i + k / steps);
      l.push(l[l.length - 1] + dist(prev, q));
      prev = q;
    }
  });
  return { s, l };
}

function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  let lo = 0;
  let hi = xs.length - 1;
  if (x >= xs[hi]) return ys[hi];
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m] <= x) lo = m;
    else hi = m;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + (ys[hi] - ys[lo]) * t;
}

/** One run with gaps cut where the objects in `cut` cross it. */
function withGaps(r: Run, closed: boolean, cut: { x: Obj; polys: Vec[][] }[]): Run[] {
  const c: Chain = { pieces: r.pieces, closed };
  const n = c.pieces.length;
  const { s: S, l: L } = lengths(c);
  const total = L[L.length - 1];
  const gaps: [number, number][] = [];
  for (const { x, polys } of cut) {
    // Half the gap: half the line going over, plus 2pt on each side (as
    // TikZ's white-line trick does), longer where they cross at a slant.
    const h = ptToCm(x.style.width / 2 + 2);
    for (const s of crossings(c, polys)) {
      const p = chainPoint(c, Math.min(s, n - 1e-9));
      const a = chainPoint(c, Math.max(0, s - 0.01));
      const b = chainPoint(c, Math.min(n - 1e-9, s + 0.01));
      const t = { x: b.x - a.x, y: b.y - a.y };
      let u: Vec | null = null;
      let best = Infinity;
      for (const poly of polys)
        for (let j = 0; j + 1 < poly.length; j++) {
          const d = dist(closestOnSegment(p, poly[j], poly[j + 1]), p);
          if (d < best) {
            best = d;
            u = { x: poly[j + 1].x - poly[j].x, y: poly[j + 1].y - poly[j].y };
          }
        }
      const tl = Math.hypot(t.x, t.y);
      const ul = u ? Math.hypot(u.x, u.y) : 0;
      const sin = tl && ul ? Math.abs(t.x * u!.y - t.y * u!.x) / (tl * ul) : 1;
      const len = interp(S, L, s);
      const half = h / Math.max(sin, 0.3);
      gaps.push([len - half, len + half]);
    }
  }
  if (!gaps.length) return [r];
  gaps.sort((a, b) => a[0] - b[0]);
  // Merge gaps that touch.
  const merged: [number, number][] = [];
  for (const g of gaps) {
    const m = merged[merged.length - 1];
    if (m && g[0] <= m[1]) m[1] = Math.max(m[1], g[1]);
    else merged.push([...g]);
  }
  const at = (len: number) => interp(L, S, len);
  const out: Run[] = [];
  const keep = (l0: number, l1: number, first: boolean, last: boolean) => {
    if (l1 - l0 < 1e-6) return;
    const s0 = at(l0);
    const s1 = l1 > total ? at(l1 - total) + n : at(l1);
    const pieces: Piece[] = subChain(c, s0, s1);
    if (pieces.length) out.push({ pieces, style: r.style, first, last });
  };
  if (closed) {
    // Around the loop, from the end of each gap to the start of the next.
    for (let k = 0; k < merged.length; k++) {
      const a = merged[k][1];
      const b = k + 1 < merged.length ? merged[k + 1][0] : merged[0][0] + total;
      keep(((a % total) + total) % total, ((a % total) + total) % total + (b - a), false, false);
    }
    return out;
  }
  let from = 0;
  for (const [g0, g1] of merged) {
    keep(from, Math.min(g0, total), r.first && from === 0, false);
    from = Math.max(from, g1);
  }
  keep(from, total, r.first && from === 0, r.last);
  return out;
}
