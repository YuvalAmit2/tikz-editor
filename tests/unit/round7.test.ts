// Seventh round (overnight testing): arrows in the middle, copies.
import { describe, expect, it } from "vitest";
import { marksOf, marksTikz } from "../../src/model/marks";
import { freshCopies } from "../../src/model/copies";
import { translation } from "../../src/model/geometry";
import { fmt, sceneToPicture } from "../../src/tikz/export";
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
