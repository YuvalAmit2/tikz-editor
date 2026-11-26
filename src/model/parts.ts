// Pieces of an object: the stretches between its crossings with other
// objects (what the trim tool cuts away). A piece can be given its own
// stroke colour, thickness and dash, e.g. the hidden half of a sphere's
// equator drawn dashed. Pieces are found again from the current crossings,
// so a styled piece follows them when things move.
import { chainPoint, crossings, cutters, subChain, toChain, type Chain, type Piece } from "./trim";
import { geomBox } from "./geometry";
import type { Obj, PartStyle, Style, Vec } from "./types";

export interface Component {
  s0: number;
  /** May pass the end of a closed chain (wraps around). */
  s1: number;
  /** A point well inside it (its middle). */
  mid: number;
}

const cache = new WeakMap<Obj, { others: Obj[]; chain: Chain | null; comps: Component[] }>();

/** The object's chain and pieces, cut by the other objects. */
export function components(o: Obj, others: Obj[]): { chain: Chain | null; comps: Component[] } {
  const hit = cache.get(o);
  if (hit && hit.others.length === others.length && hit.others.every((x, i) => x === others[i])) return hit;
  const chain = toChain(o);
  let comps: Component[] = [];
  if (chain) {
    const n = chain.pieces.length;
    const eps = 1e-4;
    // A line's or polygon's corners split it too: each side is a piece.
    const corners = o.type === "path" ? Array.from({ length: chain.closed ? n : n - 1 }, (_, i) => (chain.closed ? i : i + 1)) : [];
    let xs = [...crossings(chain, cutters(others.filter((x) => x.id !== o.id))), ...(o.cuts ?? []), ...corners].sort((a, b) => a - b);
    // Crossings very close together are one (a curve touching another one,
    // like a sphere's equator touching its outline, crosses the outline's
    // polyline twice right next to each other): use their middle.
    const near = 0.03;
    // ...and one right next to a vertex/anchor is at it.
    const toKnot = (x: number) => (Math.abs(x - Math.round(x)) < near ? Math.round(x) : x);
    const cluster = (v: number[]) => {
      const out: number[][] = [];
      for (const x of v) {
        const g = out[out.length - 1];
        if (g && x - g[g.length - 1] < near) g.push(x);
        else out.push([x]);
      }
      return out;
    };
    if (chain.closed) {
      xs = xs.map((x) => (x >= n - eps ? x - n : x)).sort((a, b) => a - b);
      const gs = cluster(xs);
      if (gs.length >= 2 && gs[0][0] + n - gs[gs.length - 1][gs[gs.length - 1].length - 1] < near) {
        const last = gs.pop()!;
        gs[0] = [...last.map((x) => x - n), ...gs[0]];
      }
      xs = gs.map((g) => toKnot(((g.reduce((a, b) => a + b, 0) / g.length) + n) % n) % n).sort((a, b) => a - b);
      if (xs.length < 2) comps = [{ s0: 0, s1: n, mid: n / 2 }];
      else comps = xs.map((x, k) => {
        const e = k + 1 < xs.length ? xs[k + 1] : xs[0] + n;
        return { s0: x, s1: e, mid: (x + e) / 2 };
      });
    } else {
      xs = cluster(xs).map((g) => toKnot(g.reduce((a, b) => a + b, 0) / g.length));
      const inner = xs.filter((x) => x > near && x < n - near);
      const cuts = [0, ...inner, n];
      for (let k = 0; k + 1 < cuts.length; k++) if (cuts[k + 1] - cuts[k] > eps) comps.push({ s0: cuts[k], s1: cuts[k + 1], mid: (cuts[k] + cuts[k + 1]) / 2 });
    }
  }
  const r = { others, chain, comps };
  cache.set(o, r);
  return r;
}

/** Which component a chain parameter falls in (-1: none). */
export function componentAt(comps: Component[], at: number, n: number): number {
  for (let k = 0; k < comps.length; k++) {
    const c = comps[k];
    for (const a of [at, at + n]) if (a >= c.s0 - 1e-9 && a <= c.s1 + 1e-9) return k;
  }
  return -1;
}

/** Style of each component (the object's, with its part's changes). */
export function componentStyles(o: Obj, comps: Component[], n: number): Style[] {
  const out = comps.map(() => o.style);
  for (const part of o.parts ?? []) {
    const k = componentAt(comps, part.at, n);
    if (k >= 0 && out[k] === o.style) out[k] = { ...o.style, ...part.style };
  }
  return out;
}

export interface Run {
  pieces: Piece[];
  style: Style;
  /** Starts at the chain's start / ends at its end (for arrowheads). */
  first: boolean;
  last: boolean;
}

const sameStroke = (a: Style, b: Style) => a.stroke === b.stroke && a.width === b.width && a.dash === b.dash;

/** Stretches drawn with one style: neighbouring pieces with the same look
 *  are joined (so dashes run on smoothly). Null: no parts to draw. */
export function styledRuns(o: Obj, others: Obj[]): Run[] | null {
  if (!o.parts?.length) return null;
  const { chain, comps } = components(o, others);
  if (!chain || comps.length === 0) return null;
  const n = chain.pieces.length;
  const styles = componentStyles(o, comps, n);
  const runs: { s0: number; s1: number; style: Style }[] = [];
  comps.forEach((c, k) => {
    const prev = runs[runs.length - 1];
    if (prev && sameStroke(prev.style, styles[k]) && Math.abs(prev.s1 - c.s0) < 1e-9) prev.s1 = c.s1;
    else runs.push({ s0: c.s0, s1: c.s1, style: styles[k] });
  });
  if (runs.length > 1 && chain.closed && sameStroke(runs[0].style, runs[runs.length - 1].style)) {
    const last = runs.pop()!;
    runs[0] = { s0: last.s0 - n, s1: runs[0].s1, style: runs[0].style };
  }
  return runs.map((r) => ({
    pieces: r.s0 < 0 ? subChain(chain, r.s0 + n, r.s1 + n) : subChain(chain, r.s0, r.s1),
    style: r.style,
    first: !chain.closed && r.s0 < 1e-9,
    last: !chain.closed && r.s1 > n - 1e-9,
  }));
}

/** The pieces of one component (for highlighting). */
export function componentPieces(o: Obj, others: Obj[], at: number): Piece[] {
  const { chain, comps } = components(o, others);
  if (!chain) return [];
  const k = componentAt(comps, at, chain.pieces.length);
  return k < 0 ? [] : subChain(chain, comps[k].s0, comps[k].s1);
}

export function piecesSvgD(pieces: Piece[]): string {
  if (!pieces.length) return "";
  let d = `M${pieces[0].a.x},${pieces[0].a.y}`;
  for (const p of pieces) d += p.line ? ` L${p.b.x},${p.b.y}` : ` C${p.c1.x},${p.c1.y} ${p.c2.x},${p.c2.y} ${p.b.x},${p.b.y}`;
  return d;
}

/** Names for the components, by where they lie: "top", "lower left", ... */
export function componentNames(o: Obj, chain: Chain, comps: Component[]): string[] {
  const b = geomBox(o);
  const c: Vec = b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : { x: 0, y: 0 };
  const n = chain.pieces.length;
  const names = comps.map((k) => {
    const m = chainPoint(chain, k.mid % n);
    const dx = m.x - c.x;
    const dy = m.y - c.y;
    const size = b ? Math.max(b.maxX - b.minX, b.maxY - b.minY) : 1;
    if (Math.hypot(dx, dy) < 0.08 * size) return "middle";
    const i = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
    return ["right", "upper right", "top", "upper left", "left", "lower left", "bottom", "lower right"][(i + 8) % 8];
  });
  const count = new Map<string, number>();
  for (const x of names) count.set(x, (count.get(x) ?? 0) + 1);
  const seen = new Map<string, number>();
  return names.map((x) => {
    if (count.get(x)! < 2) return x;
    const k = (seen.get(x) ?? 0) + 1;
    seen.set(x, k);
    return `${x} ${k}`;
  });
}

/** Parts after giving the components at `ats` a style change. Parts whose
 *  look ends up the same as the whole object's are dropped. */
export function withPartStyle(o: Obj, others: Obj[], ats: number[], patch: Partial<Style>): { parts?: PartStyle[]; cuts?: number[] } {
  const { chain, comps } = components(o, others);
  if (!chain) return { parts: o.parts, cuts: o.cuts };
  const n = chain.pieces.length;
  const keep = (o.parts ?? []).map((p) => ({ ...p, style: { ...p.style } }));
  const pick = ((p: Partial<Style>) => {
    const r: PartStyle["style"] = {};
    if (p.stroke !== undefined) r.stroke = p.stroke;
    if (p.width !== undefined) r.width = p.width;
    if (p.dash !== undefined) r.dash = p.dash;
    // Arrows in the middle of a side (0: none, though the whole has some).
    if ("mid" in p) r.mid = p.mid ?? 0;
    return r;
  })(patch);
  for (const at of ats) {
    const k = componentAt(comps, at, n);
    if (k < 0) continue;
    const ex = keep.find((p) => componentAt(comps, p.at, n) === k);
    if (ex) Object.assign(ex.style, pick);
    else keep.push({ at: comps[k].mid % n, style: { ...pick } });
  }
  const parts = keep
    .map((p) => {
      const st: PartStyle["style"] = {};
      for (const key of ["stroke", "width", "dash", "mid"] as const) if (p.style[key] !== undefined && (p.style[key] ?? 0) !== (key === "mid" ? (o.style.mid ?? 0) : o.style[key])) (st as any)[key] = p.style[key];
      return { ...p, style: st };
    })
    .filter((p) => Object.keys(p.style).length > 0);
  if (!parts.length) return { parts: undefined, cuts: undefined };
  // Remember the ends of the styled pieces, so they stay pieces even when
  // what cut them is moved away or deleted.
  const cuts = new Set<number>();
  for (const p of parts) {
    const k = componentAt(comps, p.at, n);
    if (k < 0) continue;
    const c = comps[k];
    if (chain.closed || c.s0 > 1e-9) cuts.add(Math.round((c.s0 % n) * 1e6) / 1e6);
    if (chain.closed || c.s1 < n - 1e-9) cuts.add(Math.round((c.s1 % n) * 1e6) / 1e6);
  }
  return { parts, cuts: cuts.size ? [...cuts].sort((a, b) => a - b) : undefined };
}
