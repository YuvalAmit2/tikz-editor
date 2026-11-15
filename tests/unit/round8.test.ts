// Eighth round: paint bucket (holes, loops, touching shapes), Show height,
// trimming sides, brace labels.
import { describe, expect, it } from "vitest";
import { regionAt } from "../../src/model/region";
import { bezierPoint } from "../../src/model/curve";
import { strokeRuns } from "../../src/model/height";
import { trimAt } from "../../src/model/trim";
import { braceTip } from "../../src/model/wave";
import { placeLabel } from "../../src/model/labelPlace";
import { freshCopies } from "../../src/model/copies";
import { translation } from "../../src/model/geometry";
import { sceneToTikz } from "../../src/tikz/export";
import { DEFAULT_STYLE, type Obj, type PathObj } from "../../src/model/types";

const st = { ...DEFAULT_STYLE };
const C = (id: string, x: number, y: number, r: number): Obj => ({ id, type: "ellipse", style: st, c: { x, y }, rx: r, ry: r, rot: 0 });
const L = (id: string, ...p: number[][]): PathObj => ({ id, type: "path", style: st, closed: false, pts: p.map(([x, y]) => ({ x, y })) });
const P = (id: string, ...p: number[][]): PathObj => ({ id, type: "path", style: st, closed: true, pts: p.map(([x, y]) => ({ x, y })) });
const K = (id: string, closed: boolean, ...p: number[][]): Obj => ({ id, type: "curve", style: st, closed, nodes: p.map(([x, y]) => ({ p: { x, y }, mode: "smooth" as const })) });

/** Area of the region at (x, y), holes taken off. */
function area(objs: Obj[], x: number, y: number): number | null {
  const r = regionAt(objs, { x, y });
  if (!r) return null;
  const ring = (ps: typeof r.pieces) => {
    let a = 0;
    for (const pc of ps)
      for (let k = 0; k < 32; k++) {
        const f = (t: number) => (pc.line ? { x: pc.a.x + (pc.b.x - pc.a.x) * t, y: pc.a.y + (pc.b.y - pc.a.y) * t } : bezierPoint(pc, t));
        const p = f(k / 32);
        const q = f((k + 1) / 32);
        a += (p.x * q.y - q.x * p.y) / 2;
      }
    return Math.abs(a);
  };
  return ring(r.pieces) - (r.holes ?? []).reduce((s, h) => s + ring(h), 0);
}

describe("paint bucket", () => {
  it("a ring between two circles has a hole", () => {
    const ann = [C("a", 0, 0, 2), C("b", 0, 0, 1)];
    expect(regionAt(ann, { x: 1.5, y: 0 })?.holes).toHaveLength(1);
    expect(area(ann, 1.5, 0)).toBeCloseTo(3 * Math.PI, 1);
    expect(regionAt(ann, { x: 0.2, y: 0 })?.whole).toBe("b");
  });
  it("a disc with two punctures; an island in a hole isn't a hole", () => {
    expect(area([C("a", 0, 0, 3), C("h1", -1.2, 0, 0.5), C("h2", 1.2, 0, 0.5)], 0, 1.5)).toBeCloseTo(9 * Math.PI - 0.5 * Math.PI, 1);
    const isl = [C("a", 0, 0, 3), C("h", 0, 0, 2), C("i", 0, 0, 1)];
    expect(regionAt(isl, { x: 0, y: 2.5 })?.holes).toHaveLength(1);
    expect(area(isl, 0, 1.5)).toBeCloseTo(3 * Math.PI, 1);
  });
  it("a loop in one curve, and each lobe of a figure eight", () => {
    expect(area([K("k", false, [0, 0], [3, 2], [4, 1], [3, 0], [1, 2])], 3.3, 1)).toBeGreaterThan(1);
    expect(area([K("k", true, [0, 0], [1, 1], [2, 0], [3, -1], [4, 0], [3, 1], [2, 0], [1, -1])], 3, 0)).toBeGreaterThan(1);
  });
  it("shapes that touch: circles inside a circle, circles resting on a line", () => {
    const tg = [C("a", 0, 0, 2), C("b", 1, 0, 1)];
    expect(area(tg, -1, 0)).toBeCloseTo(3 * Math.PI, 1);
    expect(area(tg, 1, 0)).toBeCloseTo(Math.PI, 2);
    expect(area([L("x", [-3, 0], [3, 0]), C("a", -1, 1, 1), C("b", 1, 1, 1)], 0, 0.1)).toBeCloseTo(2 - Math.PI / 2, 2);
    expect(area([C("o", 0, 0, 2), C("a", -1, 0, 1), C("b", 1, 0, 1)], 0, 1.5)).toBeCloseTo(Math.PI, 0);
  });
  it("lines meeting at their ends, T-junctions, pie slices", () => {
    expect(area([L("a", [0, 0], [4, 0]), L("b", [4, 0], [2, 3]), L("c", [2, 3], [0, 0])], 2, 1)).toBeCloseTo(6, 3);
    expect(area([P("r", [0, 0], [4, 0], [4, 2], [0, 2]), L("l", [2, 0], [2, 1]), L("m", [2, 1], [4, 1])], 3, 0.5)).toBeCloseTo(2, 3);
    expect(area([C("a", 0, 0, 2), L("l", [0, 0], [2, 0]), L("m", [0, 0], [0, 2])], 0.5, 0.5)).toBeCloseTo(Math.PI, 2);
  });
  it("is quick on a busy figure", () => {
    let seed = 1;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const many: Obj[] = [];
    for (let i = 0; i < 40; i++) many.push(K("k" + i, rnd() < 0.3, ...Array.from({ length: 5 }, () => [rnd() * 10, rnd() * 10])));
    regionAt(many, { x: 5, y: 5 });
    const t0 = performance.now();
    regionAt(many, { x: 5, y: 5 });
    expect(performance.now() - t0).toBeLessThan(1500);
  });
  it("a fill with holes is written with the even odd rule", () => {
    const ring: Obj = { ...P("f", [0, 0], [4, 0], [4, 4], [0, 4]), style: { ...st, stroke: null, fill: "gray!30" }, holes: [P("h", [1, 1], [3, 1], [3, 3], [1, 3])] };
    expect(sceneToTikz({ version: 1, objects: [ring] })).toContain("\\path[fill=gray!30,even odd rule] (0,0) -- (4,0) -- (4,4) -- (0,4) -- cycle (1,1) -- (3,1) -- (3,3) -- (1,3) -- cycle;");
    const [moved] = freshCopies([ring], translation(1, 0));
    expect(moved.type === "path" && moved.holes?.[0].type === "path" && moved.holes[0].pts[0]).toEqual({ x: 2, y: 1 });
  });
});

describe("show height", () => {
  const under = { ...L("u", [0, 0], [4, 0]), cross: ["o"] };
  const over = { ...L("o", [2, -1], [2, 1]), cross: ["u"] };
  it("the line behind gets a gap where the one in front crosses it", () => {
    const sr = strokeRuns(under, [under, over])!;
    expect(sr.runs).toHaveLength(2);
    const endA = sr.runs[0].pieces[sr.runs[0].pieces.length - 1].b.x;
    const startB = sr.runs[1].pieces[0].a.x;
    expect(endA).toBeLessThan(2);
    expect(startB).toBeGreaterThan(2);
    // 2pt on each side plus half the line in front: about 1.6 mm.
    expect(startB - endA).toBeCloseTo((2 * (0.2 + 2)) / 28.4528, 2);
    // The one in front is drawn whole; swapped order, the other way round.
    expect(strokeRuns(over, [under, over])).toBeNull();
    expect(strokeRuns(over, [over, under])!.runs).toHaveLength(2);
  });
  it("a fill stays whole; the TikZ has the line in two pieces", () => {
    const filled = { ...C("c", 0, 0, 1), style: { ...st, fill: "gray!30" }, cross: ["l"] } as Obj;
    const l = { ...L("l", [-2, 0], [2, 0]), cross: ["c"] };
    const sr = strokeRuns(filled, [filled, l])!;
    expect(sr.fill?.style.stroke).toBeNull();
    expect(sr.runs).toHaveLength(2);
    const t = sceneToTikz({ version: 1, objects: [filled, l] });
    expect(t).toContain("\\path[fill=gray!30] (0,0) ellipse");
    expect(t.match(/\\path\[draw\] \(/g)?.length).toBe(3);
  });
  it("copies keep it only with what was copied along", () => {
    const [a] = freshCopies([under], translation(0, 1));
    expect(a.cross).toBeUndefined();
    const [b, c] = freshCopies([under, over], translation(0, 1));
    expect(b.cross).toEqual([c.id]);
  });
});

describe("trim", () => {
  it("takes one side of a rectangle", () => {
    const r = P("r", [0, 0], [4, 0], [4, 2], [0, 2]);
    const t = trimAt(r, { x: 2, y: 0 }, [])!;
    expect(t.kept).toHaveLength(1);
    const k = t.kept[0];
    expect(k.type === "path" && k.pts).toEqual([{ x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 0 }]);
  });
  it("takes one segment of a polyline", () => {
    const t = trimAt(L("p", [0, 0], [1, 0], [2, 0], [3, 0]), { x: 1.5, y: 0 }, [])!;
    expect(t.kept).toHaveLength(2);
  });
});

describe("brace label", () => {
  it("goes at the tip", () => {
    const b = { ...L("b", [0, 0], [4, 0]), style: { ...st, wave: "brace" as const } };
    const tip = braceTip(b)!;
    expect(tip.tip.x).toBeCloseTo(2, 6);
    expect(tip.tip.y).toBeGreaterThan(0);
    const { p, anchor } = placeLabel([b], [b], { w: 0.3, h: 0.3 }, () => null);
    expect(anchor).toBe("south");
    expect(p.x).toBeCloseTo(2, 6);
    expect(p.y).toBeGreaterThan(tip.tip.y);
  });
});
