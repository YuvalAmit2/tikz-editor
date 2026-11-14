// Smooth curves through anchor points ("auto-smooth anchors").
//
// A curve is a list of anchors. Between two anchors it is one cubic Bézier.
// Each anchor is one of:
//   smooth  - the handles are computed so the curve bends as evenly as possible
//   corner  - computed too, but the curve may turn sharply here
//   manual  - the handles were dragged by hand and are stored (hin/hout)
//
// The computed handles come from a Hobby-style solve: at every smooth anchor
// the tangent is continuous and the (linearised) curvature of the two pieces
// meeting there is equal; at the ends and at corners each piece gets "curl 1"
// (its curvature at that end equals the curvature at its other end, which
// makes three points on a circle give that circle's arc). Handle lengths use
// Hobby's velocity function, so four points on a circle give a near-perfect
// circle.
import type { CurveNode, CurveObj, Vec } from "./types";

export interface Seg {
  a: Vec;
  c1: Vec;
  c2: Vec;
  b: Vec;
}

const TAU = 2 * Math.PI;
const wrap = (t: number) => {
  let x = (t + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
};
const dir = (t: number): Vec => ({ x: Math.cos(t), y: Math.sin(t) });
const hasLen = (v: Vec | undefined) => !!v && Math.hypot(v.x, v.y) > 1e-9;

/** Hobby's velocity function (tension 1): handle length / chord length. */
export function velocity(theta: number, phi: number): number {
  const st = Math.sin(theta);
  const sp = Math.sin(phi);
  const ct = Math.cos(theta);
  const cp = Math.cos(phi);
  const n = 2 + Math.SQRT2 * (st - sp / 16) * (sp - st / 16) * (ct - cp);
  const d = 3 * (1 + 0.5 * (Math.sqrt(5) - 1) * ct + 0.5 * (3 - Math.sqrt(5)) * cp);
  const r = n / d;
  return Math.max(0, Math.min(r, 4 / 3));
}

/** Solve A x = b (dense, partial pivoting). Returns null if singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Is the curve smooth (tangent-continuous) at this anchor? */
function isSmooth(nodes: CurveNode[], j: number, closed: boolean): boolean {
  const n = nodes.length;
  const hasIn = closed || j > 0;
  const hasOut = closed || j < n - 1;
  return nodes[j].mode === "smooth" && hasIn && hasOut;
}

/** Fixed handle directions of a manual anchor (null when not fixed). */
function manualOut(node: CurveNode): number | null {
  return node.mode === "manual" && hasLen(node.hout) ? Math.atan2(node.hout!.y, node.hout!.x) : null;
}
function manualIn(node: CurveNode): number | null {
  // Direction of travel arriving at the anchor: from the in-handle towards it.
  return node.mode === "manual" && hasLen(node.hin) ? Math.atan2(-node.hin!.y, -node.hin!.x) : null;
}

/** The Bézier pieces of a curve. */
export function curveSegments(o: { nodes: CurveNode[]; closed: boolean }): Seg[] {
  const nodes = o.nodes;
  const n = nodes.length;
  if (n < 2) return [];
  const closed = o.closed && n >= 3;
  const m = closed ? n : n - 1;
  const end = (k: number) => (k + 1) % n;

  const ang: number[] = [];
  const d: number[] = [];
  for (let k = 0; k < m; k++) {
    const a = nodes[k].p;
    const b = nodes[end(k)].p;
    ang.push(Math.atan2(b.y - a.y, b.x - a.x));
    d.push(Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1e-9));
  }

  // Unknowns: theta_k (index k) and phi_k (index m + k) for each segment k:
  // the out-angle at its start and the in-angle at its end, relative to the chord.
  const N = 2 * m;
  const A: number[][] = [];
  const B: number[] = [];
  const eq = (coefs: [number, number][], rhs: number) => {
    const row = new Array(N).fill(0);
    for (const [i, c] of coefs) row[i] += c;
    A.push(row);
    B.push(rhs);
  };
  const T = (k: number) => k;
  const P = (k: number) => m + k;
  /** Is this end of segment k "free" (curl) rather than tied to a neighbour or a manual handle? */
  const freeStart = (k: number) => !isSmooth(nodes, k, closed) && manualOut(nodes[k]) === null;
  const freeEnd = (k: number) => !isSmooth(nodes, end(k), closed) && manualIn(nodes[end(k)]) === null;

  for (let j = 0; j < n; j++) {
    const out = closed || j < n - 1 ? j : -1; // segment leaving anchor j
    const inc = closed ? (j - 1 + n) % n : j - 1; // segment arriving at anchor j
    if (isSmooth(nodes, j, closed) && manualOut(nodes[j]) === null) {
      // Tangent continuity and equal curvature.
      const psi = wrap(ang[out] - ang[inc]);
      eq([[T(out), 1], [P(inc), 1]], -psi);
      eq(
        [
          [P(inc), 2 / d[inc]],
          [T(inc), -1 / d[inc]],
          [T(out), -2 / d[out]],
          [P(out), 1 / d[out]],
        ],
        0,
      );
      continue;
    }
    if (out >= 0) {
      const mo = manualOut(nodes[j]);
      if (mo !== null) eq([[T(out), 1]], wrap(mo - ang[out]));
      else if (freeEnd(out)) eq([[T(out), 1]], 0); // both ends free: straight
      else eq([[T(out), 1], [P(out), -1]], 0); // curl 1
    }
    if (inc >= 0) {
      const mi = manualIn(nodes[j]);
      if (mi !== null) eq([[P(inc), 1]], wrap(ang[inc] - mi));
      else if (freeStart(inc)) eq([[P(inc), 1]], 0);
      else eq([[P(inc), 1], [T(inc), -1]], 0);
    }
  }

  const x = A.length === N ? solve(A, B) : null;
  const segs: Seg[] = [];
  for (let k = 0; k < m; k++) {
    const na = nodes[k];
    const nb = nodes[end(k)];
    const th = x ? x[T(k)] : 0;
    const ph = x ? x[P(k)] : 0;
    const c1 =
      na.mode === "manual" && na.hout
        ? { x: na.p.x + na.hout.x, y: na.p.y + na.hout.y }
        : add(na.p, scale(dir(ang[k] + th), d[k] * velocity(th, ph)));
    const c2 =
      nb.mode === "manual" && nb.hin
        ? { x: nb.p.x + nb.hin.x, y: nb.p.y + nb.hin.y }
        : add(nb.p, scale(dir(ang[k] - ph), -d[k] * velocity(ph, th)));
    segs.push({ a: na.p, c1, c2, b: nb.p });
  }
  return segs;
}

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });

export function bezierPoint(s: Seg, t: number): Vec {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const e = t * t * t;
  return { x: a * s.a.x + b * s.c1.x + c * s.c2.x + e * s.b.x, y: a * s.a.y + b * s.c1.y + c * s.c2.y + e * s.b.y };
}

/** The curve as a polyline (for hit testing, snapping and boxes). */
export function sampleCurve(o: { nodes: CurveNode[]; closed: boolean }, perSeg = 20): Vec[] {
  const segs = curveSegments(o);
  if (segs.length === 0) return o.nodes.map((n) => n.p);
  const pts: Vec[] = [segs[0].a];
  for (const s of segs) for (let i = 1; i <= perSeg; i++) pts.push(bezierPoint(s, i / perSeg));
  return pts;
}

/** The handles each anchor currently has (computed or manual), as offsets. */
export function nodeHandles(o: CurveObj): { hin: Vec | null; hout: Vec | null }[] {
  const segs = curveSegments(o);
  const n = o.nodes.length;
  const closed = o.closed && n >= 3;
  return o.nodes.map((node, j) => {
    const outSeg = closed || j < n - 1 ? segs[j] : undefined;
    const inSeg = closed ? segs[(j - 1 + n) % n] : j > 0 ? segs[j - 1] : undefined;
    return {
      hout: outSeg ? { x: outSeg.c1.x - node.p.x, y: outSeg.c1.y - node.p.y } : null,
      hin: inSeg ? { x: inSeg.c2.x - node.p.x, y: inSeg.c2.y - node.p.y } : null,
    };
  });
}

/** SVG path data for a curve. */
export function curvePathD(o: { nodes: CurveNode[]; closed: boolean }): string {
  const segs = curveSegments(o);
  if (segs.length === 0) return o.nodes.length ? `M${o.nodes[0].p.x},${o.nodes[0].p.y}` : "";
  let d = `M${segs[0].a.x},${segs[0].a.y}`;
  for (const s of segs) d += ` C${s.c1.x},${s.c1.y} ${s.c2.x},${s.c2.y} ${s.b.x},${s.b.y}`;
  if (o.closed && o.nodes.length >= 3) d += " Z";
  return d;
}
