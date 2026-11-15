// Shapes made from a description (command palette): regular polygons and
// graphs of functions.
import { canvasSize } from "./actions";
import { graphPieces, parseExpr } from "./model/expr";
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
