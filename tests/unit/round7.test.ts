// Seventh round (overnight testing): arrows in the middle, copies.
import { describe, expect, it } from "vitest";
import { marksOf, marksTikz } from "../../src/model/marks";
import { freshCopies, nextNumbered } from "../../src/model/copies";
import { withAttached } from "../../src/model/attach";
import { translation } from "../../src/model/geometry";
import { fmt, sceneToPicture, sceneToTikz } from "../../src/tikz/export";
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

  it("TikZ marks at the edges' middles, as fractions of the length", () => {
    expect(marksTikz(line(1), fmt)).toBe("postaction={decorate,decoration={markings,mark=at position 0.25 with {\\arrow{>}},mark=at position 0.75 with {\\arrow{>}}}}");
    expect(marksTikz(line(-2), fmt)).toContain("\\arrow{<<}");
  });

  it("an ellipse's mark is where TikZ's ellipse is halfway round", () => {
    const e: Obj = { id: "e", type: "ellipse", style: { ...DEFAULT_STYLE, mid: 1 }, c: { x: 0, y: 0 }, rx: 2, ry: 1, rot: 0 };
    const [m] = marksOf(e);
    expect(m.p.x).toBeCloseTo(-2);
    expect(m.dir.y).toBeCloseTo(-1);
  });

  it("a pasted picture names the library it needs", () => {
    expect(sceneToPicture({ version: 1, objects: [line(1)] })).toContain("decorations.markings");
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
