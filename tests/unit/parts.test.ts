// Pieces of an object get their own stroke style.
import { describe, expect, it } from "vitest";
import { components, componentNames, styledRuns, withPartStyle } from "../../src/model/parts";
import { DEFAULT_STYLE, type EllipseObj, type PathObj } from "../../src/model/types";

const st = { ...DEFAULT_STYLE };
const sphere: EllipseObj = { id: "s", type: "ellipse", style: st, c: { x: 0, y: 0 }, rx: 2, ry: 2, rot: 0 };
const equator: EllipseObj = { id: "e", type: "ellipse", style: st, c: { x: 0, y: 0 }, rx: 2, ry: 0.4, rot: 0 };

describe("pieces", () => {
  it("a sphere's equator (touching the outline at its ends) has an upper and a lower half", () => {
    const { chain, comps } = components(equator, [sphere, equator]);
    expect(comps).toHaveLength(2);
    expect(componentNames(equator, chain!, comps).sort()).toEqual(["bottom", "top"]);
  });

  it("dashing the upper half: two runs, the top one dashed", () => {
    const { chain, comps } = components(equator, [sphere]);
    const names = componentNames(equator, chain!, comps);
    const top = comps[names.indexOf("top")].mid;
    const { parts, cuts } = withPartStyle(equator, [sphere], [top], { dash: "dashed" });
    expect(parts).toHaveLength(1);
    const runs = styledRuns({ ...equator, parts, cuts }, [sphere])!;
    expect(runs).toHaveLength(2);
    const dashed = runs.find((r) => r.style.dash === "dashed")!;
    for (const p of dashed.pieces) expect(p.c1.y + p.c2.y).toBeGreaterThan(-1e-9);
    // Setting it back to solid removes the part
    expect(withPartStyle({ ...equator, parts, cuts }, [sphere], [top], { dash: "solid" }).parts).toBeUndefined();
  });

  it("a line cut by two others: three pieces; neighbours with the same look are joined", () => {
    const l: PathObj = { id: "l", type: "path", style: st, closed: false, pts: [{ x: 0, y: 0 }, { x: 6, y: 0 }] };
    const v = (id: string, x: number): PathObj => ({ id, type: "path", style: st, closed: false, pts: [{ x, y: -1 }, { x, y: 1 }] });
    const others = [v("a", 2), v("b", 4)];
    const { comps } = components(l, others);
    expect(comps.map((c) => [c.s0, c.s1])).toEqual([[0, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 1]].map(([a, b]) => [expect.closeTo(a, 6), expect.closeTo(b, 6)]));
    const { parts, cuts } = withPartStyle(l, others, [comps[1].mid], { stroke: "red" });
    const runs = styledRuns({ ...l, parts, cuts }, others)!;
    expect(runs.map((r) => r.style.stroke)).toEqual(["black", "red", "black"]);
    expect(runs[0].first && runs[2].last).toBe(true);
  });

  it("a styled piece stays when what cut it is deleted", () => {
    const line: PathObj = { id: "l", type: "path", style: st, closed: false, pts: [{ x: -3, y: 0 }, { x: 3, y: 0 }] };
    const { comps } = components(sphere, [line]);
    expect(comps).toHaveLength(2);
    const { parts, cuts } = withPartStyle(sphere, [line], [comps[0].mid], { stroke: "red" });
    const alone = { ...sphere, parts, cuts };
    expect(components(alone, []).comps).toHaveLength(2);
    expect(styledRuns(alone, [])!.map((r) => r.style.stroke).sort()).toEqual(["black", "red"]);
  });
});
