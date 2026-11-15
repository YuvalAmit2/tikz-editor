// Wavy, zigzag and coiled lines (style.wave): branch cuts, photon lines,
// springs. The wave is computed here and written out as coordinates, so the
// PDF is exactly what the editor shows (and no TikZ library is needed).
// A whole number of waves fits the line, so both ends stay where they are.
import { sampleCurve } from "./curve";
import { ellipsePoint, ptToCm } from "./geometry";
import type { Obj, PathObj, Vec } from "./types";

export type Wave = "snake" | "zigzag" | "coil" | "brace";

export const WAVES: { w: Wave; name: string }[] = [
  { w: "snake", name: "Wavy" },
  { w: "zigzag", name: "Zigzag" },
  { w: "coil", name: "Coil" },
  { w: "brace", name: "Brace" },
];

/** Amplitude and length of one wave, in pt (TikZ's defaults). */
const AMP = 2.5;
const LEN = 10;

/** The line the wave runs along, as a fine polyline. */
function baseLine(o: Obj): { pts: Vec[]; closed: boolean } | null {
  if (o.type === "path") {
    if (o.pts.length < 2) return null;
    const pts = o.closed ? [...o.pts, o.pts[0]] : o.pts;
    return { pts, closed: o.closed };
  }
  if (o.type === "curve") return o.nodes.length < 2 ? null : { pts: sampleCurve(o, 40), closed: o.closed && o.nodes.length >= 3 };
  if (o.type === "ellipse") {
    const pts: Vec[] = [];
    for (let i = 0; i <= 160; i++) pts.push(ellipsePoint(o, (i / 160) * 2 * Math.PI));
    return { pts, closed: true };
  }
  return null;
}

/** Point and unit tangent at arclength s along a polyline (cumulative lengths `acc`). */
function at(pts: Vec[], acc: number[], s: number): { p: Vec; t: Vec } {
  let i = 1;
  while (i < acc.length - 1 && acc[i] < s) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const l = acc[i] - acc[i - 1] || 1;
  const u = Math.max(0, Math.min(1, (s - acc[i - 1]) / l));
  return { p: { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }, t: { x: (b.x - a.x) / l, y: (b.y - a.y) / l } };
}

/** The object drawn as a wave: a polyline with the same style (no wave). */
export function waved(o: Obj): PathObj | null {
  const w = o.style.wave;
  if (!w) return null;
  const base = baseLine(o);
  if (!base) return null;
  if (w === "brace") return brace(o, base.pts[0], base.pts[base.pts.length - 1]);
  const { pts } = base;
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = acc[acc.length - 1];
  if (total < 1e-9) return null;
  // Thicker lines get bigger waves, as TikZ users usually set them.
  const grow = 1 + Math.max(0, o.style.width - 0.4) * 0.6;
  const A = ptToCm(AMP) * grow;
  // An arrowhead needs a short straight end to point along the line.
  const tail = ptToCm(3) * grow;
  const t0 = !base.closed && o.style.arrowStart ? tail : 0;
  const t1 = !base.closed && o.style.arrowEnd ? tail : 0;
  const span = total - t0 - t1;
  if (span < 1e-9) return null;
  const n = Math.max(1, Math.round(span / (ptToCm(LEN) * grow)));
  const L = span / n;
  const out: Vec[] = t0 ? [pts[0]] : [];
  const steps = w === "zigzag" ? 4 : w === "coil" ? 24 : 16;
  for (let k = 0; k <= n * steps; k++) {
    const s = t0 + (k / steps) * L;
    const th = (2 * Math.PI * k) / steps;
    const { p, t } = at(pts, acc, Math.min(s, total));
    const nrm = { x: -t.y, y: t.x };
    // Zigzag and wave go from side to side; a coil also swings back along
    // the line (loops seen from the side), back on the line after each turn.
    const off = w === "zigzag" ? [0, 1, 0, -1][k % 4] * A : Math.sin(th) * A;
    const back = w === "coil" ? (1 - Math.cos(th)) * A * 1.2 : 0;
    out.push({ x: p.x + nrm.x * off - t.x * back, y: p.y + nrm.y * off - t.y * back });
  }
  if (t1) out.push(pts[pts.length - 1]);
  if (base.closed) out.pop();
  const { wave: _, ...style } = o.style;
  return { id: o.id, type: "path", style, pts: out, closed: base.closed, ...(o.hidden ? { hidden: true } : {}) };
}

/** A curly brace from the line's first point to its last, on its left
 *  (draw it the other way, or flip it, for the other side). */
function brace(o: Obj, a: Vec, b: Vec): PathObj | null {
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  if (l < 1e-9) return null;
  const t = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  const n = { x: -t.y, y: t.x };
  // Half the brace's height; smaller braces on short lines.
  const h = Math.min(ptToCm(2.5) * (1 + Math.max(0, o.style.width - 0.4) * 0.6), l / 6);
  const loc: Vec[] = [];
  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    for (let k = 0; k <= 8; k++) {
      const th = a0 + ((a1 - a0) * k) / 8;
      loc.push({ x: cx + h * Math.cos(th), y: cy + h * Math.sin(th) });
    }
  };
  const P = Math.PI;
  arc(h, 0, P, P / 2); // up from the start
  arc(l / 2 - h, 2 * h, -P / 2, 0); // up to the tip
  arc(l / 2 + h, 2 * h, P, (3 * P) / 2); // down from the tip
  arc(l - h, 0, P / 2, 0); // down to the end
  const pts = loc.map((q) => ({ x: a.x + t.x * q.x + n.x * q.y, y: a.y + t.y * q.x + n.y * q.y }));
  const { wave: _, ...style } = o.style;
  return { id: o.id, type: "path", style: { ...style, fill: null, arrowStart: false, arrowEnd: false }, pts, closed: false, ...(o.hidden ? { hidden: true } : {}) };
}
