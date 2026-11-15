// Randomised checks of the model: curves, transforms, export, snapping.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { curveSegments, sampleCurve, bezierPoint } from "../../src/model/curve";
import { applyAffine, rotationAbout, scalingAbout, transformObj, translation, type Affine } from "../../src/model/geometry";
import { buildSnapIndex } from "../../src/model/snap";
import { sceneToTikz, tikzToScene } from "../../src/tikz/export";
import { DEFAULT_STYLE, LINE_WIDTHS, type CurveNode, type Obj, type Scene, type Style } from "../../src/model/types";

let seed = 12345;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const r = (a: number, b: number) => a + (b - a) * rnd();
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
// "+ 0": JSON has no -0
const pt = () => ({ x: Math.round(r(-5, 5) * 4) / 4 + 0, y: Math.round(r(-5, 5) * 4) / 4 + 0 });

function randomStyle(): Style {
  return {
    stroke: pick(["black", "red", "blue!60", "green!60!black", null]),
    width: pick(LINE_WIDTHS).pt,
    dash: pick(["solid", "dashed", "dotted"] as const),
    fill: pick([null, null, "orange!15", "gray!30"]),
    arrowStart: rnd() < 0.2,
    arrowEnd: rnd() < 0.3,
    mid: pick([0, 0, 0, 1, 2, -1]),
  };
}
function randomNodes(n: number): CurveNode[] {
  return Array.from({ length: n }, () => {
    const mode = pick(["smooth", "smooth", "corner", "manual"] as const);
    const p = pt();
    return mode === "manual" ? { p, mode, hin: { x: r(-1, 1), y: r(-1, 1) }, hout: { x: r(-1, 1), y: r(-1, 1) } } : { p, mode };
  });
}
let idn = 0;
function randomObj(): Obj {
  const id = "o" + idn++;
  const style = randomStyle();
  switch (pick(["path", "curve", "ellipse", "point", "label"] as const)) {
    case "path":
      return { id, type: "path", style, pts: Array.from({ length: 2 + Math.floor(r(0, 4)) }, pt), closed: rnd() < 0.5 };
    case "curve":
      return { id, type: "curve", style, nodes: randomNodes(2 + Math.floor(r(0, 5))), closed: rnd() < 0.4 };
    case "ellipse":
      return { id, type: "ellipse", style, c: pt(), rx: r(0.2, 3), ry: r(0.2, 3), rot: pick([0, 0, 30, 45]) };
    case "point":
      return { id, type: "point", style, p: pt(), size: pick([1, 1.5, 2, 3]) };
    case "label":
      return {
        id,
        type: "label",
        style: { ...style, fill: null, stroke: pick(["black", "red", "blue"]) },
        p: pt(),
        ...pick([
          { text: "x", textMode: false },
          { text: "\\alpha_1", textMode: false },
          { text: "a+b", textMode: false },
          { text: "Consider $x^2$", textMode: false },
          { text: "torus", textMode: true },
          { text: "\\frac{1}{2}", textMode: false },
          { text: "100\\%", textMode: true },
          { text: "\\{x\\}", textMode: false },
          { text: "line one \\\\ line two", textMode: true },
          { text: "a \\\\ b", textMode: false },
        ]),
        anchor: pick(["center", "north", "south west", "east"] as const),
        font: pick(["", "\\small", "\\scriptsize"] as const),
      };
  }
}
const randomScene = (n: number): Scene => ({ version: 1, objects: Array.from({ length: n }, randomObj) });

describe("curves (random)", () => {
  it("pass through every anchor and stay finite", () => {
    for (let k = 0; k < 300; k++) {
      const nodes = randomNodes(2 + Math.floor(r(0, 7)));
      const closed = rnd() < 0.4;
      const segs = curveSegments({ nodes, closed });
      const n = nodes.length;
      expect(segs.length).toBe(closed && n >= 3 ? n : n - 1);
      segs.forEach((s, i) => {
        expect(s.a).toEqual(nodes[i].p);
        expect(s.b).toEqual(nodes[(i + 1) % n].p);
        for (const q of [s.c1, s.c2]) expect(Number.isFinite(q.x) && Number.isFinite(q.y)).toBe(true);
      });
    }
  });

  it("are smooth at smooth anchors (no kink)", () => {
    for (let k = 0; k < 200; k++) {
      const nodes = randomNodes(4).map((n) => ({ p: n.p, mode: "smooth" as const }));
      // avoid repeated points
      if (new Set(nodes.map((n) => `${n.p.x},${n.p.y}`)).size < 4) continue;
      const segs = curveSegments({ nodes, closed: true });
      for (let i = 0; i < 4; i++) {
        const into = segs[(i + 3) % 4];
        const out = segs[i];
        const a = { x: into.b.x - into.c2.x, y: into.b.y - into.c2.y };
        const b = { x: out.c1.x - out.a.x, y: out.c1.y - out.a.y };
        const cross = a.x * b.y - a.y * b.x;
        const dot = a.x * b.x + a.y * b.y;
        if (Math.hypot(a.x, a.y) < 1e-9 || Math.hypot(b.x, b.y) < 1e-9) continue;
        expect(Math.abs(Math.atan2(cross, dot))).toBeLessThan(1e-6);
      }
    }
  });

  it("move with their anchors under rotations, flips and uniform scaling", () => {
    for (let k = 0; k < 100; k++) {
      const o: Obj = { id: "c", type: "curve", style: DEFAULT_STYLE, nodes: randomNodes(4), closed: rnd() < 0.5 };
      const maps: Affine[] = [rotationAbout(pt(), pick([90, 37, -120])), scalingAbout(pt(), -1, 1), scalingAbout(pt(), 1.7, 1.7), translation(r(-3, 3), r(-3, 3))];
      for (const m of maps) {
        const t = transformObj(o, m) as typeof o;
        const a = sampleCurve(o, 8).map((p) => applyAffine(m, p));
        const b = sampleCurve(t, 8);
        a.forEach((p, i) => {
          expect(b[i].x).toBeCloseTo(p.x, 6);
          expect(b[i].y).toBeCloseTo(p.y, 6);
        });
      }
    }
  });

  it("stretch exactly under non-uniform scaling", () => {
    for (let k = 0; k < 100; k++) {
      const o: Obj = { id: "c", type: "curve", style: DEFAULT_STYLE, nodes: randomNodes(4).map((n) => ({ p: n.p, mode: "smooth" as const })), closed: false };
      const m = scalingAbout(pt(), r(0.3, 3), r(0.3, 3));
      const t = transformObj(o, m) as typeof o;
      const sa = curveSegments(o);
      const sb = curveSegments(t);
      sa.forEach((s, i) => {
        for (const u of [0.25, 0.5, 0.75]) {
          const p = applyAffine(m, bezierPoint(s, u));
          const q = bezierPoint(sb[i], u);
          expect(q.x).toBeCloseTo(p.x, 6);
          expect(q.y).toBeCloseTo(p.y, 6);
        }
      });
    }
  });
});

describe("export (random scenes)", () => {
  it("round-trips through the .tikz file", () => {
    for (let k = 0; k < 50; k++) {
      const s = randomScene(8);
      expect(tikzToScene(sceneToTikz(s))).toEqual(s);
    }
  });

  it("compiles with pdflatex (40 random figures, every object type and style)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tikz-random-"));
    mkdirSync(path.join(dir, "graphics"));
    copyFileSync(path.join(__dirname, "../../tex/tikzfig.sty"), path.join(dir, "tikzfig.sty"));
    const calls: string[] = [];
    for (let k = 0; k < 40; k++) {
      writeFileSync(path.join(dir, "graphics", `f${k}.tikz`), sceneToTikz(randomScene(10)));
      calls.push(`\\tikzfig${k % 3 === 0 ? "[4cm]" : ""}{f${k}}\\par`);
    }
    writeFileSync(
      path.join(dir, "t.tex"),
      `\\documentclass{article}\\usepackage{amssymb}\\usepackage{tikzfig}\\begin{document}\n${calls.join("\n")}\n\\end{document}\n`,
    );
    let ok = true;
    try {
      execFileSync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", "t.tex"], { cwd: dir, stdio: "pipe" });
    } catch {
      ok = false;
    }
    const log = readFileSync(path.join(dir, "t.log"), "utf8");
    if (!ok) console.log(log.split("\n").filter((l) => l.startsWith("!")).slice(0, 5).join("\n"), dir);
    expect(ok).toBe(true);
  }, 60_000);
});

describe("snapping", () => {
  it("a single curve adds no intersection points with itself unless it crosses itself", () => {
    const o: Obj = { id: "c", type: "curve", style: DEFAULT_STYLE, closed: false, nodes: [{ p: { x: 0, y: 0 }, mode: "smooth" }, { p: { x: 1, y: 1 }, mode: "smooth" }, { p: { x: 2, y: 0 }, mode: "smooth" }] };
    expect(buildSnapIndex([o]).points.filter((p) => p.kind === "intersection")).toHaveLength(0);
    const loop: Obj = { ...o, nodes: [{ p: { x: 0, y: 0 }, mode: "smooth" }, { p: { x: 2, y: 2 }, mode: "smooth" }, { p: { x: 2, y: 0 }, mode: "smooth" }, { p: { x: 0, y: 2 }, mode: "smooth" }] };
    expect(buildSnapIndex([loop]).points.filter((p) => p.kind === "intersection").length).toBeGreaterThan(0);
  });
});
