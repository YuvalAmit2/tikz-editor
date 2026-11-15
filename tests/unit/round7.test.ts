// Seventh round (overnight testing): arrows in the middle, copies.
import { describe, expect, it } from "vitest";
import { marksOf, marksTikz } from "../../src/model/marks";
import { freshCopies, nextNumbered } from "../../src/model/copies";
import { withAttached } from "../../src/model/attach";
import { waved } from "../../src/model/wave";
import { graphPieces, parseExpr } from "../../src/model/expr";
import { sampleCurve } from "../../src/model/curve";
import { parsePlot } from "../../src/insert";
import { scalingAbout, transformObj, translation } from "../../src/model/geometry";
import { fmt, sceneToTikz } from "../../src/tikz/export";
import { DEFAULT_STYLE, type Obj } from "../../src/model/types";

const line = (mid: number, closed = false): Obj => ({
  id: "a",
  type: "path",
  style: { ...DEFAULT_STYLE, mid },
  pts: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }],
  closed,
});

describe("arrows in the middle", () => {
  it("one per straight edge, at its middle, pointing along the line", () => {
    const m = marksOf(line(1));
    expect(m.map((k) => k.p)).toEqual([{ x: 1, y: 0 }, { x: 2, y: 1 }]);
    expect(m[1].dir).toEqual({ x: 0, y: 1 });
    expect(marksOf(line(-2))[0].dir.x).toBe(-1);
    expect(marksOf(line(1, true))).toHaveLength(3);
    expect(marksOf(line(0))).toHaveLength(0);
  });

  it("TikZ: a short arrow ending at each mark", () => {
    expect(marksTikz(line(1), fmt)).toBe("\\path[draw,->] (0.95,0) -- (1,0);\n\\path[draw,->] (2,0.95) -- (2,1);");
    expect(marksTikz(line(-2), fmt)).toContain("\\path[draw,->>] (1.05,0) -- (1,0);");
  });

  it("an ellipse's mark is where TikZ's ellipse is halfway round", () => {
    const e: Obj = { id: "e", type: "ellipse", style: { ...DEFAULT_STYLE, mid: 1 }, c: { x: 0, y: 0 }, rx: 2, ry: 1, rot: 0 };
    const [m] = marksOf(e);
    expect(m.p.x).toBeCloseTo(-2);
    expect(m.dir.y).toBeCloseTo(-1);
  });

  it("compiles in a scaled-down figure with small circles (decorations didn't)", () => {
    const c: Obj = { id: "c", type: "ellipse", style: { ...DEFAULT_STYLE, mid: 1 }, c: { x: 0, y: 0 }, rx: 0.2, ry: 0.2, rot: 0 };
    expect(sceneToTikz({ version: 1, objects: [c] })).not.toContain("decorat");
  });
});

describe("copies", () => {
  it("get their own group, and labels follow the copies", () => {
    const p: Obj = { id: "p", type: "point", style: DEFAULT_STYLE, p: { x: 0, y: 0 }, size: 1.5, group: "g" };
    const l: Obj = { id: "l", type: "label", style: DEFAULT_STYLE, p: { x: 0.2, y: 0 }, text: "a", textMode: false, anchor: "west", font: "", group: "g", follow: { ids: ["p"], ref: { x: 0, y: 0 }, avoid: true } };
    const [cp, cl] = freshCopies([p, l], translation(1, 0));
    expect(cp.group).not.toBe("g");
    expect(cl.group).toBe(cp.group);
    expect(cl.type === "label" && cl.follow?.ids).toEqual([cp.id]);
    // A label copied without its object is a plain label.
    const [alone] = freshCopies([l], translation(1, 0));
    expect(alone.type === "label" && alone.follow).toBeUndefined();
  });
});

describe("gap where it crosses", () => {
  it("draws a wider white line first", () => {
    const o: Obj = { ...line(0), style: { ...DEFAULT_STYLE, gap: true } };
    const t = sceneToTikz({ version: 1, objects: [o] });
    const white = t.indexOf("\\path[draw=white,line width=4.4pt] (0,0) -- (2,0) -- (2,2);");
    expect(white).toBeGreaterThan(0);
    expect(t.indexOf("\\path[draw] (0,0) -- (2,0) -- (2,2);")).toBeGreaterThan(white);
  });
});

describe("lines follow their dots", () => {
  it("moves line ends and curve anchors that were on a moved dot", () => {
    const d: Obj = { id: "d", type: "point", style: DEFAULT_STYLE, p: { x: 2, y: 0 }, size: 1.5 };
    const c: Obj = { id: "c", type: "curve", style: DEFAULT_STYLE, nodes: [{ p: { x: 0, y: 1 }, mode: "smooth" }, { p: { x: 2, y: 0 }, mode: "smooth" }], closed: false };
    const moved: Obj = { ...d, p: { x: 3, y: 1 } };
    const out = withAttached([d], [moved], [line(0), c, d]);
    expect(out).toHaveLength(3);
    const l = out.find((o) => o.id === "a")!;
    expect(l.type === "path" && l.pts[1]).toEqual({ x: 3, y: 1 });
    const cc = out.find((o) => o.id === "c")!;
    expect(cc.type === "curve" && cc.nodes[1].p).toEqual({ x: 3, y: 1 });
    // A dot elsewhere: nothing else moves.
    expect(withAttached([{ ...d, p: { x: 5, y: 5 } }], [moved], [line(0), c])).toHaveLength(1);
  });
});

describe("⌘D counts labels up", () => {
  it("the last number goes up by one", () => {
    expect(nextNumbered("a_1")).toBe("a_2");
    expect(nextNumbered("z_{9}")).toBe("z_{10}");
    expect(nextNumbered("x_1 + y_2")).toBe("x_1 + y_3");
    expect(nextNumbered("\\infty")).toBe("\\infty");
    expect(nextNumbered("\\R^2")).toBe("\\R^2");
    expect(nextNumbered("p_1^2")).toBe("p_2^2");
  });
});

describe("plotting a function", () => {
  it("reads the usual notation", () => {
    const at = (s: string, x: number) => parseExpr(s)(x);
    expect(at("x^2 - 1", 3)).toBe(8);
    expect(at("-x^2", 2)).toBe(-4);
    expect(at("2x + 1", 2)).toBe(5);
    expect(at("3sin(x)", Math.PI / 2)).toBeCloseTo(3);
    expect(at("(x+1)(x-1)", 2)).toBe(3);
    expect(at("2^3^2", 0)).toBe(512);
    expect(at("|x| + sqrt 4", -1)).toBe(3);
    expect(at("e^x", 1)).toBeCloseTo(Math.E);
    expect(at("\\sin(\\pi x)", 0.5)).toBeCloseTo(1);
    expect(() => parseExpr("x +")).toThrow();
    expect(() => parseExpr("foo(x)")).toThrow(/foo/);
  });

  it("the curve follows the function closely", () => {
    const f = parseExpr("x^3/3 - x");
    const [pts] = graphPieces(f, -2.2, 2.2);
    const c = { nodes: pts.map((p) => ({ p, mode: "smooth" as const })), closed: false };
    let worst = 0;
    for (const p of sampleCurve(c, 20)) worst = Math.max(worst, Math.abs(p.y - f(p.x)));
    expect(worst).toBeLessThan(0.01);
  });

  it("splits where the function is undefined or jumps", () => {
    expect(graphPieces(parseExpr("1/x"), -2, 2)).toHaveLength(2);
    expect(graphPieces(parseExpr("tan(x)"), -3, 3)).toHaveLength(3);
    expect(graphPieces(parseExpr("sqrt(x)"), -1, 1)).toHaveLength(1);
  });

  it("the range of x is optional", () => {
    expect(parsePlot("y = x^2, -1, 2", { cx: 0, w: 10 })).toMatchObject({ a: -1, b: 2 });
    expect(parsePlot("x^2", { cx: 0, w: 10 })).toMatchObject({ a: -3.5, b: 3.5 });
    expect(parsePlot("sin(x), -pi, pi", { cx: 0, w: 10 }).b).toBeCloseTo(Math.PI);
  });
});

describe("wavy, zigzag and coiled lines", () => {
  it("keep their ends, and are written as coordinates", () => {
    for (const wave of ["snake", "zigzag", "coil"] as const) {
      const o: Obj = { id: "w", type: "path", style: { ...DEFAULT_STYLE, wave }, pts: [{ x: 0, y: 0 }, { x: 3, y: 0 }], closed: false };
      const w = waved(o)!;
      expect(w.pts[0].x).toBeCloseTo(0, 9);
      expect(w.pts[0].y).toBeCloseTo(0, 9);
      expect(w.pts[w.pts.length - 1].x).toBeCloseTo(3, 9);
      expect(w.pts[w.pts.length - 1].y).toBeCloseTo(0, 9);
      expect(Math.max(...w.pts.map((p) => Math.abs(p.y)))).toBeGreaterThan(0.05);
      const t = sceneToTikz({ version: 1, objects: [o] });
      expect(t).not.toContain("decorat");
      expect(t.split(" -- ").length).toBeGreaterThan(20);
    }
  });
  it("end straight under an arrowhead", () => {
    const o: Obj = { id: "w", type: "path", style: { ...DEFAULT_STYLE, wave: "snake", arrowEnd: true }, pts: [{ x: 0, y: 0 }, { x: 3, y: 0 }], closed: false };
    const p = waved(o)!.pts;
    expect(p[p.length - 2].y).toBeCloseTo(0, 9);
  });
});

describe("braces, see-through fills, label backgrounds", () => {
  it("a brace bulges to the left of its line, and flipping moves it to the other side", () => {
    const o: Obj = { id: "b", type: "path", style: { ...DEFAULT_STYLE, wave: "brace" }, pts: [{ x: 0, y: 0 }, { x: 3, y: 0 }], closed: false };
    const top = Math.max(...waved(o)!.pts.map((p) => p.y));
    expect(top).toBeGreaterThan(0.1);
    const f = transformObj(o, scalingAbout({ x: 1.5, y: 0 }, 1, -1));
    expect(Math.min(...waved(f)!.pts.map((p) => p.y))).toBeCloseTo(-top, 9);
  });
  it("TikZ options", () => {
    const e: Obj = { id: "e", type: "ellipse", style: { ...DEFAULT_STYLE, fill: "red!60", opacity: 0.5 }, c: { x: 0, y: 0 }, rx: 1, ry: 1, rot: 0 };
    expect(sceneToTikz({ version: 1, objects: [e] })).toContain("fill=red!60,fill opacity=0.5");
    const l: Obj = { id: "l", type: "label", style: DEFAULT_STYLE, p: { x: 0, y: 0 }, text: "x", textMode: false, anchor: "center", font: "", bg: true };
    expect(sceneToTikz({ version: 1, objects: [l] })).toContain("fill=white] at (0,0) {$x$}");
  });
});
