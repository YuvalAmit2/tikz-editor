// Shapes made from a description (command palette): regular polygons and
// graphs of functions.
import { canvasSize } from "./actions";
import { graphPieces, parseExpr } from "./model/expr";
import { sampleCurve } from "./model/curve";
import { ellipsePoint } from "./model/geometry";
import { newId, type CurveObj, type Obj, type PathObj } from "./model/types";
import { askText, store } from "./store";

function place(objs: Obj[]) {
  const s = store.get();
  store.commit({ ...s.scene, objects: [...s.scene.objects, ...objs] }, { selection: objs.map((o) => o.id), tool: "select", pointEdit: null, editingLabel: null });
}

/** A regular n-gon (flat bottom), radius 1 cm, in the middle of the view. */
export function regularPolygonAt(n: number, c: { x: number; y: number }, r = 1): PathObj {
  const s = store.get();
  const pts = Array.from({ length: n }, (_, k) => {
    const a = ((-90 + 180 / n + (360 * k) / n) * Math.PI) / 180;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
  return { id: newId(), type: "path", style: { ...s.style, arrowStart: false, arrowEnd: false }, pts, closed: true };
}

export async function insertRegularPolygon() {
  const v = await askText("Regular polygon", { label: "Number of sides", initial: "6", ok: "Insert" });
  if (v === null) return;
  const n = parseInt(v, 10);
  if (!(n >= 3 && n <= 100)) return store.flash("Give a number of sides from 3 to 100");
  const { cx, cy } = store.get().view;
  place([regularPolygonAt(n, { x: Math.round(cx * 4) / 4, y: Math.round(cy * 4) / 4 })]);
}

/** "x^2 - 1" or "x^2 - 1, -2, 2" (the range of x; by default the width of the view). */
export function parsePlot(text: string, view: { cx: number; w: number }): { f: (x: number) => number; a: number; b: number } {
  // Split at top-level commas.
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  const expr = parts[0].replace(/^\s*(y|f\(x\))\s*=/, "");
  const f = parseExpr(expr);
  let a: number;
  let b: number;
  if (parts.length >= 3) {
    const num = (t: string) => parseExpr(t)(0);
    a = num(parts[1]);
    b = num(parts[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) throw new Error("the range of x should be two different numbers");
    if (a > b) [a, b] = [b, a];
  } else {
    a = Math.round((view.cx - view.w * 0.35) * 2) / 2;
    b = Math.round((view.cx + view.w * 0.35) * 2) / 2;
  }
  return { f, a, b };
}

let lastPlot = "sin(x)";

export async function plotFunction() {
  const s = store.get();
  const v = await askText("Plot a function", { label: "y =  (optionally followed by the range of x: , from, to)", initial: lastPlot, placeholder: "x^2/2 - 1, -2, 2", ok: "Plot" });
  if (v === null || !v.trim()) return;
  lastPlot = v;
  let plot;
  try {
    plot = parsePlot(v, { cx: s.view.cx, w: canvasSize().w / s.view.zoom });
  } catch (e) {
    return store.flash(`Couldn't read that: ${(e as Error).message}`);
  }
  const pieces = graphPieces(plot.f, plot.a, plot.b);
  if (!pieces.length) return store.flash("Nothing to draw: the function isn't defined there");
  const curves: CurveObj[] = pieces.map((pts) => ({
    id: newId(),
    type: "curve",
    style: { ...s.style, fill: null },
    nodes: pts.map((p) => ({ p, mode: "smooth" as const })),
    closed: false,
  }));
  place(curves);
  store.flash(`y = ${v.split(",")[0].trim()} for ${plot.a} ≤ x ≤ ${plot.b}`);
}

/** Points along a line or curve, evenly by length (k points). */
function resample(o: Obj, k: number): { x: number; y: number }[] | null {
  let pts: { x: number; y: number }[];
  if (o.type === "path") pts = o.closed ? [...o.pts, o.pts[0]] : o.pts;
  else if (o.type === "curve") pts = sampleCurve(o, 30);
  else if (o.type === "ellipse") {
    pts = [];
    for (let i = 0; i <= 120; i++) pts.push(ellipsePoint(o, (i / 120) * 2 * Math.PI));
  } else return null;
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = acc[acc.length - 1];
  if (total < 1e-9) return null;
  const out: { x: number; y: number }[] = [];
  let j = 1;
  for (let i = 0; i < k; i++) {
    const s = (total * i) / (k - 1);
    while (j < acc.length - 1 && acc[j] < s) j++;
    const u = (s - acc[j - 1]) / (acc[j] - acc[j - 1] || 1);
    out.push({ x: pts[j - 1].x + (pts[j].x - pts[j - 1].x) * u, y: pts[j - 1].y + (pts[j].y - pts[j - 1].y) * u });
  }
  return out;
}

/** n objects evenly between a and b (curves, lines, ellipses). Two lines
 *  with the same number of points, or two curves with the same number of
 *  anchors, blend point by point; anything else as smooth curves. */
export function blendBetween(a: Obj, b: Obj, n: number): Obj[] {
  const out: Obj[] = [];
  const lerp = (p: { x: number; y: number }, q: { x: number; y: number }, t: number) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  const closed = (o: Obj) => (o.type === "path" || o.type === "curve" ? o.closed : o.type === "ellipse");
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const style = { ...a.style, mid: undefined };
    if (a.type === "path" && b.type === "path" && a.pts.length === b.pts.length && a.closed === b.closed) {
      out.push({ id: newId(), type: "path", style, pts: a.pts.map((p, j) => lerp(p, b.pts[j], t)), closed: a.closed });
    } else if (a.type === "curve" && b.type === "curve" && a.nodes.length === b.nodes.length && a.closed === b.closed) {
      out.push({ id: newId(), type: "curve", style, nodes: a.nodes.map((nd, j) => ({ p: lerp(nd.p, b.nodes[j].p, t), mode: nd.mode === "corner" ? "corner" : "smooth" })), closed: a.closed });
    } else if (a.type === "ellipse" && b.type === "ellipse") {
      out.push({ id: newId(), type: "ellipse", style, c: lerp(a.c, b.c, t), rx: a.rx + (b.rx - a.rx) * t, ry: a.ry + (b.ry - a.ry) * t, rot: a.rot + (b.rot - a.rot) * t });
    } else {
      const both = closed(a) && closed(b);
      // From a straight-sided shape: fine polylines (a smooth curve through a
      // few points of a square wobbles); between curves: smooth curves.
      const straight = a.type === "path" || b.type === "path";
      const k = straight ? 64 : 16;
      const pa = resample(a, both ? k + 1 : k);
      const pb = resample(b, both ? k + 1 : k);
      if (!pa || !pb) return [];
      let qb = pb;
      if (both) {
        // Closed: start b where it lines up best with a, going the same way round.
        const ring = pb.slice(0, k);
        let best = Infinity;
        for (const dir of [1, -1])
          for (let r = 0; r < k; r++) {
            const cand = Array.from({ length: k }, (_, j) => ring[(((r + dir * j) % k) + k) % k]);
            const cost = cand.reduce((sum, q, j) => sum + Math.hypot(q.x - pa[j].x, q.y - pa[j].y), 0);
            if (cost < best) {
              best = cost;
              qb = [...cand, cand[0]];
            }
          }
      }
      const pts = pa.map((p, j) => lerp(p, qb[j], t));
      if (both) pts.pop();
      if (straight) out.push({ id: newId(), type: "path", style, pts, closed: both });
      else out.push({ id: newId(), type: "curve", style, nodes: pts.map((p) => ({ p, mode: "smooth" as const })), closed: both });
    }
  }
  return out;
}

export async function blendSelection() {
  const sel = store.selected().filter((o) => o.type === "path" || o.type === "curve" || o.type === "ellipse");
  if (sel.length !== 2) return store.flash("Select two lines, curves or ellipses to blend between");
  const v = await askText("Blend", { label: "How many in between", initial: "3", ok: "Blend" });
  if (v === null) return;
  const n = parseInt(v, 10);
  if (!(n >= 1 && n <= 50)) return store.flash("Give a number from 1 to 50");
  // Open lines run the same way (else the blend twists).
  let [a, b] = sel;
  const ends = (o: Obj) => (o.type === "path" && !o.closed ? [o.pts[0], o.pts[o.pts.length - 1]] : o.type === "curve" && !o.closed ? [o.nodes[0].p, o.nodes[o.nodes.length - 1].p] : null);
  const ea = ends(a);
  const eb = ends(b);
  if (ea && eb) {
    const d = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
    if (d(ea[0], eb[0]) + d(ea[1], eb[1]) > d(ea[0], eb[1]) + d(ea[1], eb[0])) {
      if (b.type === "path") b = { ...b, pts: [...b.pts].reverse() };
      if (b.type === "curve") b = { ...b, nodes: [...b.nodes].reverse().map((nd) => ({ ...nd, ...(nd.hin || nd.hout ? { hin: nd.hout, hout: nd.hin } : {}) })) };
    }
  }
  place(blendBetween(a, b, n));
}
