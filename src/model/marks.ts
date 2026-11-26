// Arrows in the middle of a line (style.mid): one in the middle of every
// straight edge of a line/polygon, one halfway along a curve or ellipse.
// Used for identification diagrams (a torus as a square with marked edges),
// contours, and the like.
import { sampleCurve } from "./curve";
import { ellipsePoint } from "./geometry";
import type { Obj, Vec } from "./types";
import { componentAt, components, componentStyles } from "./parts";

export interface Mark {
  /** Where the arrow's tip is. */
  p: Vec;
  /** Unit direction it points. */
  dir: Vec;
}

const unit = (v: Vec): Vec => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

/** Positions along the object (fractions of its length) and the marks
 *  there, pointing along the line (before style.mid's sign). */
export function midMarks(o: Obj): { at: number; mark: Mark }[] {
  if (o.type === "path") {
    const pts = o.closed ? [...o.pts, o.pts[0]] : o.pts;
    const lens: number[] = [];
    for (let i = 0; i + 1 < pts.length; i++) lens.push(Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y));
    const total = lens.reduce((a, b) => a + b, 0);
    if (total < 1e-9) return [];
    const out: { at: number; mark: Mark }[] = [];
    let acc = 0;
    lens.forEach((l, i) => {
      if (l > 1e-9) {
        const a = pts[i];
        const b = pts[i + 1];
        out.push({ at: (acc + l / 2) / total, mark: { p: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dir: unit({ x: b.x - a.x, y: b.y - a.y }) } });
      }
      acc += l;
    });
    return out;
  }
  if (o.type === "curve") {
    const pts = sampleCurve(o, 48);
    const lens: number[] = [];
    for (let i = 0; i + 1 < pts.length; i++) lens.push(Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y));
    const total = lens.reduce((a, b) => a + b, 0);
    if (total < 1e-9) return [];
    let acc = 0;
    for (let i = 0; i < lens.length; i++) {
      if (acc + lens[i] >= total / 2 && lens[i] > 0) {
        const t = (total / 2 - acc) / lens[i];
        const a = pts[i];
        const b = pts[i + 1];
        return [{ at: 0.5, mark: { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, dir: unit({ x: b.x - a.x, y: b.y - a.y }) } }];
      }
      acc += lens[i];
    }
    return [];
  }
  if (o.type === "ellipse") {
    // Halfway round from its starting point (angle 0, which turns with it),
    // running anticlockwise.
    const p = ellipsePoint(o, Math.PI);
    const q = ellipsePoint(o, Math.PI + 1e-4);
    return [{ at: 0.5, mark: { p, dir: unit({ x: q.x - p.x, y: q.y - p.y }) } }];
  }
  return [];
}

/** The marks to draw: style.mid is how many arrowheads (1 or 2), negative
 *  for pointing back along the line. */
export function marksOf(o: Obj): Mark[] {
  return styledMarks(o);
}

export interface StyledMark extends Mark {
  /** Arrowheads (1 or 2; the sign is already in dir). */
  heads: number;
  stroke: string;
  width: number;
}

/** Each mark with its own look: a side of a line or polygon picked out
 *  (double-click it) can have its own arrows and colour. */
export function styledMarks(o: Obj): StyledMark[] {
  const st = o.style;
  const make = (mark: Mark, mid: number, stroke: string | null, width: number): StyledMark[] => {
    if (!mid || !stroke) return [];
    const s = Math.sign(mid);
    return [{ p: mark.p, dir: { x: mark.dir.x * s, y: mark.dir.y * s }, heads: Math.min(2, Math.abs(mid)), stroke, width }];
  };
  if (o.type === "path" && o.parts?.length) {
    const { chain, comps } = components(o, []);
    if (chain) {
      const n = chain.pieces.length;
      const styles = componentStyles(o, comps, n);
      const pts = o.closed ? [...o.pts, o.pts[0]] : o.pts;
      const out: StyledMark[] = [];
      let side = 0;
      for (const { mark } of midMarks(o)) {
        // Which side this mark is on (sides of no length have none).
        while (side + 1 < pts.length && Math.hypot(pts[side + 1].x - pts[side].x, pts[side + 1].y - pts[side].y) <= 1e-9) side++;
        const k = componentAt(comps, side + 0.5, n);
        const ps = k >= 0 ? styles[k] : st;
        out.push(...make(mark, ps.mid ?? 0, ps.stroke, ps.width));
        side++;
      }
      return out;
    }
  }
  return midMarks(o).flatMap(({ mark }) => make(mark, st.mid ?? 0, st.stroke, st.width));
}

/** The arrows in the middle as TikZ: each a short stroke along the line
 *  ending in an arrowhead at the mark (no decorations library: those fail
 *  on small curved paths when a figure is scaled down). */
export function marksTikz(o: Obj, fmt: (n: number) => string): string | null {
  const c = (p: Vec) => `(${fmt(p.x)},${fmt(p.y)})`;
  const lines = styledMarks(o).map(({ p, dir, heads, stroke, width }) => {
    const opts = [stroke === "black" ? "draw" : `draw=${stroke}`];
    if (Math.abs(width - 0.4) > 1e-9) opts.push(`line width=${fmt(width)}pt`);
    opts.push(heads >= 2 ? "->>" : "->");
    return `\\path[${opts.join(",")}] ${c({ x: p.x - dir.x * 0.05, y: p.y - dir.y * 0.05 })} -- ${c(p)};`;
  });
  return lines.length ? lines.join("\n") : null;
}
