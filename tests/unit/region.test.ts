import { describe, expect, it } from "vitest";
import { regionAt } from "../../src/model/region";
import { DEFAULT_STYLE, type EllipseObj, type PathObj } from "../../src/model/types";

const st = { ...DEFAULT_STYLE };
const circle: EllipseObj = { id: "c", type: "ellipse", style: st, c: { x: 0, y: 0 }, rx: 2, ry: 2, rot: 0 };
const line = (id: string, a: [number, number], b: [number, number]): PathObj => ({ id, type: "path", style: st, closed: false, pts: [{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }] });
const ys = (r: NonNullable<ReturnType<typeof regionAt>>) => r.pieces.flatMap((p) => [p.a.y, p.b.y]);

describe("paint bucket regions", () => {
  it("inside a lone circle: the circle itself", () => {
    expect(regionAt([circle], { x: 0.3, y: 0.2 })?.whole).toBe("c");
  });
  it("a line across a circle: the top half is the arc and the chord", () => {
    const r = regionAt([circle, line("l", [-3, 0], [3, 0])], { x: 0, y: 1 })!;
    expect(r.whole).toBeUndefined();
    expect(Math.min(...ys(r))).toBeGreaterThan(-1e-6);
    expect(Math.max(...ys(r))).toBeCloseTo(2, 2);
  });
  it("a triangle made of three separate lines", () => {
    const r = regionAt([line("a", [0, 0], [4, 0]), line("b", [3.5, -1], [1, 3]), line("c", [0.5, -1], [3, 3])], { x: 2, y: 0.5 })!;
    expect(r).not.toBeNull();
    expect(r.pieces.length).toBe(3);
  });
  it("outside everything: nothing", () => {
    expect(regionAt([circle], { x: 5, y: 0 })).toBeNull();
  });
});
