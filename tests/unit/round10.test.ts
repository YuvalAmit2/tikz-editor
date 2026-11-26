// Tenth round: filling triangles whose sides are drawn again, circles whose
// arrows turn with them, dashes across lines, regular polygons, styled sides.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { regionAt } from "../../src/model/region";
import { rotationAbout, transformObj, scalingAbout } from "../../src/model/geometry";
import { marksOf, styledMarks } from "../../src/model/marks";
import { ngonPts, normalAngle, withSides, tickEnds } from "../../src/model/ticks";
import { components, withPartStyle } from "../../src/model/parts";
import { spotAt } from "../../src/model/labelPlace";
import { sceneToTikz } from "../../src/tikz/export";
import { DEFAULT_STYLE, type EllipseObj, type Obj, type PathObj, type PointObj, type Scene } from "../../src/model/types";

const st = { ...DEFAULT_STYLE };
const P = (id: string, closed: boolean, ...p: number[][]): PathObj => ({ id, type: "path", style: st, closed, pts: p.map(([x, y]) => ({ x, y })) });
const near = (a: number, b: number) => Math.abs((((a - b) % 180) + 180) % 180) < 1e-6 || Math.abs((((a - b) % 180) + 180) % 180 - 180) < 1e-6;

describe("paint bucket: a triangle with its sides drawn again (for arrows)", () => {
  const fixture: Scene = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/triangle-with-sides.json"), "utf8"));
  it("fills it (the user's s2-delta-complex figure)", () => {
    for (const p of [{ x: -3, y: 0 }, { x: -3.5, y: -0.5 }, { x: -2.2, y: -0.8 }]) expect(regionAt(fixture.objects, p)?.whole).toBe(fixture.objects[0].id);
  });
  it("also when there's no closed triangle, just the three sides twice", () => {
    const sides = [P("a", false, [0, 0], [4, 0]), P("b", false, [4, 0], [2, 3]), P("c", false, [2, 3], [0, 0])];
    const again = sides.map((s) => ({ ...s, id: s.id + "2" }));
    expect(regionAt([...sides, ...again], { x: 2, y: 1 })).not.toBeNull();
  });
});

describe("a circle's arrow turns with it", () => {
  const c: EllipseObj = { id: "c", type: "ellipse", style: { ...st, mid: 1 }, c: { x: 0, y: 0 }, rx: 1, ry: 1, rot: 0 };
  it("rotated a quarter turn, the arrow moves a quarter turn", () => {
    const [m0] = marksOf(c);
    const r = transformObj(c, rotationAbout({ x: 0, y: 0 }, 90)) as EllipseObj;
    const [m1] = marksOf(r);
    // (x, y) -> (-y, x)
    expect(m1.p.x).toBeCloseTo(-m0.p.y, 6);
    expect(m1.p.y).toBeCloseTo(m0.p.x, 6);
    expect(m1.dir.x).toBeCloseTo(-m0.dir.y, 6);
  });
  it("an ellipse keeps its starting point too (half a turn)", () => {
    const e: EllipseObj = { ...c, rx: 2, ry: 1 };
    const r = transformObj(e, rotationAbout({ x: 0, y: 0 }, 180)) as EllipseObj;
    const [m0] = marksOf(e);
    const [m1] = marksOf(r);
    expect(m1.p.x).toBeCloseTo(-m0.p.x, 6);
    expect(m1.p.y).toBeCloseTo(-m0.p.y, 6);
  });
  it("scaling a circle unevenly still gives an ellipse of the right size", () => {
    const r = transformObj(c, scalingAbout({ x: 0, y: 0 }, 2, 1)) as EllipseObj;
    expect([r.rx, r.ry].sort()).toEqual([1, 2]);
  });
});

describe("dashes (ticks)", () => {
  const sq = P("sq", true, [0, 0], [2, 0], [2, 2], [0, 2]);
  it("across a flat line: upright", () => expect(near(normalAngle({ x: 1, y: 0 }, [sq])!, 90)).toBe(true));
  it("across a sloping line: square to it", () => expect(near(normalAngle({ x: 1, y: 1 }, [P("l", false, [0, 0], [2, 2])])!, 135)).toBe(true));
  it("at a square's corner: diagonal", () => expect(near(normalAngle({ x: 2, y: 2 }, [sq])!, 45)).toBe(true));
  it("at the end of a line: square to it", () => expect(near(normalAngle({ x: 0, y: 0 }, [P("l", false, [0, 0], [3, 0])])!, 90)).toBe(true));
  it("on a circle: along the radius", () => {
    const c: EllipseObj = { id: "c", type: "ellipse", style: st, c: { x: 0, y: 0 }, rx: 1, ry: 1, rot: 0 };
    expect(near(normalAngle({ x: Math.SQRT1_2, y: Math.SQRT1_2 }, [c])!, 45)).toBe(true);
  });
  it("off every line: none", () => expect(normalAngle({ x: 5, y: 5 }, [sq])).toBeNull());
  it("is written as a short line, and turns with its figure", () => {
    const t: PointObj = { id: "t", type: "point", style: st, p: { x: 1, y: 0 }, size: 1.5, look: "tick", angle: 90 };
    const [a, b] = tickEnds(t);
    expect(a.x).toBeCloseTo(1, 9);
    expect(b.y - a.y).toBeGreaterThan(0.1);
    expect(sceneToTikz({ version: 1, objects: [t] })).toMatch(/\\draw\[black\] \(1,-0\.\d+\) -- \(1,0\.\d+\);/);
    expect((transformObj(t, rotationAbout({ x: 0, y: 0 }, 90)) as PointObj).angle).toBeCloseTo(180, 6);
  });
});

describe("regular polygons", () => {
  it("n equal sides, and changing n keeps its middle and size", () => {
    const h: PathObj = { ...P("h", true), regular: true, pts: ngonPts({ x: 1, y: 1 }, 2, 0, 6) };
    const sides = h.pts.map((p, i) => Math.hypot(h.pts[(i + 1) % 6].x - p.x, h.pts[(i + 1) % 6].y - p.y));
    for (const s of sides) expect(s).toBeCloseTo(2, 9);
    const p = withSides(h, 5);
    expect(p.pts.length).toBe(5);
    for (const q of p.pts) expect(Math.hypot(q.x - 1, q.y - 1)).toBeCloseTo(2, 9);
  });
});

describe("a polygon's sides are pieces of their own", () => {
  const sq = P("sq", true, [0, 0], [2, 0], [2, 2], [0, 2]);
  it("four sides, four pieces", () => expect(components(sq, [sq]).comps.length).toBe(4));
  it("one side can have its own colour and arrow; the TikZ has them", () => {
    const { parts, cuts } = withPartStyle(sq, [sq], [2.5], { stroke: "red", mid: 1 });
    const o = { ...sq, parts, cuts } as Obj;
    const marks = styledMarks(o);
    expect(marks.length).toBe(1);
    expect(marks[0].stroke).toBe("red");
    expect(marks[0].p.y).toBeCloseTo(2, 9);
    const tikz = sceneToTikz({ version: 1, objects: [o] });
    expect(tikz).toContain("\\path[draw=red] (2,2) -- (0,2);");
    expect(tikz).toContain("\\path[draw=red,->]");
  });
  it("arrows on the whole, but none on one side", () => {
    const all = { ...sq, style: { ...st, mid: 1 } };
    const { parts, cuts } = withPartStyle(all, [all], [0.5], { mid: undefined });
    expect(styledMarks({ ...all, parts, cuts } as Obj).length).toBe(3);
  });
});

describe("label positions from the 3×3 grid", () => {
  const sq = P("sq", true, [0, 0], [2, 0], [2, 2], [0, 2]);
  it("corners and sides just outside the box; the middle on top", () => {
    const ne = spotAt([sq], "north east");
    expect(ne.anchor).toBe("south west");
    expect(ne.p.x).toBeCloseTo(2.07, 9);
    expect(ne.p.y).toBeCloseTo(2.07, 9);
    expect(spotAt([sq], "south").anchor).toBe("north");
    expect(spotAt([sq], "south").p.y).toBeCloseTo(-0.07, 9);
    expect(spotAt([sq], "center")).toEqual({ p: { x: 1, y: 1 }, anchor: "center" });
  });
});
