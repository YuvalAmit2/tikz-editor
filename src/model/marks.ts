// Arrows in the middle of a line (style.mid): one in the middle of every
// straight edge of a line/polygon, one halfway along a curve or ellipse.
// Used for identification diagrams (a torus as a square with marked edges),
// contours, and the like.
import { sampleCurve } from "./curve";
import { ellipsePoint } from "./geometry";
import { waved } from "./wave";
import type { Obj, Vec } from "./types";

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
    // TikZ's ellipse starts at angle 0 and runs anticlockwise, so halfway is
    // at angle 180°, heading down (a circle is written without its rotation).
    const e = Math.abs(o.rx - o.ry) < 1e-9 ? { ...o, rot: 0 } : o;
    const p = ellipsePoint(e, Math.PI);
    const q = ellipsePoint(e, Math.PI + 1e-4);
    return [{ at: 0.5, mark: { p, dir: unit({ x: q.x - p.x, y: q.y - p.y }) } }];
  }
  return [];
}

/** The marks to draw: style.mid is how many arrowheads (1 or 2), negative
 *  for pointing back along the line. */
export function marksOf(o: Obj): Mark[] {
  const m = o.style.mid ?? 0;
  if (!m || !o.style.stroke) return [];
  const s = Math.sign(m);
  return midMarks(o).map(({ mark }) => ({ p: mark.p, dir: { x: mark.dir.x * s, y: mark.dir.y * s } }));
}

/** The arrows in the middle as TikZ: each a short stroke along the line
 *  ending in an arrowhead at the mark (no decorations library: those fail
 *  on small curved paths when a figure is scaled down). */
export function marksTikz(o: Obj, fmt: (n: number) => string): string | null {
  const m = o.style.mid ?? 0;
  const st = o.style;
  if (!m || !st.stroke) return null;
  const opts = [st.stroke === "black" ? "draw" : `draw=${st.stroke}`];
  if (Math.abs(st.width - 0.4) > 1e-9) opts.push(`line width=${fmt(st.width)}pt`);
  opts.push(Math.abs(m) >= 2 ? "->>" : "->");
  const c = (p: Vec) => `(${fmt(p.x)},${fmt(p.y)})`;
  const lines = marksOf(o).map(({ p, dir }) => `\\path[${opts.join(",")}] ${c({ x: p.x - dir.x * 0.05, y: p.y - dir.y * 0.05 })} -- ${c(p)};`);
  return lines.length ? lines.join("\n") : null;
}

/** The white line under an object with style.gap (wider by 2pt each side),
 *  or null. */
export function halo(o: Obj): Obj | null {
  if (!o.style.gap || !o.style.stroke || (o.type !== "path" && o.type !== "curve" && o.type !== "ellipse")) return null;
  // Under a wave, the wave's own line.
  const base = waved(o) ?? o;
  return {
    ...base,
    parts: undefined,
    text: undefined,
    style: { stroke: "white", width: o.style.width + 4, dash: "solid", fill: null, arrowStart: false, arrowEnd: false },
  } as Obj;
}
