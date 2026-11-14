import { describe, expect, it } from "vitest";
import { curveSegments, sampleCurve } from "../../src/model/curve";
import type { CurveNode } from "../../src/model/types";

const nodes = (pts: [number, number][], mode: CurveNode["mode"] = "smooth"): CurveNode[] => pts.map(([x, y]) => ({ p: { x, y }, mode }));
const maxRadiusError = (pts: { x: number; y: number }[], r: number, c = { x: 0, y: 0 }) => Math.max(...pts.map((p) => Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r)));

describe("auto-smooth curves", () => {
  it("four points on a circle give (almost) that circle", () => {
    const pts = sampleCurve({ nodes: nodes([[1, 0], [0, 1], [-1, 0], [0, -1]]), closed: true }, 40);
    expect(maxRadiusError(pts, 1)).toBeLessThan(0.002);
  });
  it("three points on a circle give its arc", () => {
    const s2 = Math.SQRT1_2;
    const pts = sampleCurve({ nodes: nodes([[1, 0], [s2, s2], [0, 1]]), closed: false }, 40);
    expect(maxRadiusError(pts, 1)).toBeLessThan(0.003);
  });
  it("collinear points give a straight line", () => {
    const pts = sampleCurve({ nodes: nodes([[0, 0], [1, 0], [3, 0]]), closed: false });
    expect(Math.max(...pts.map((p) => Math.abs(p.y)))).toBeLessThan(1e-9);
  });
  it("is symmetric for symmetric input", () => {
    const segs = curveSegments({ nodes: nodes([[-2, 0], [-1, 1], [1, 1], [2, 0]]), closed: false });
    expect(segs[0].c1.x).toBeCloseTo(-segs[2].c2.x, 9);
    expect(segs[0].c1.y).toBeCloseTo(segs[2].c2.y, 9);
  });
  it("corner anchors make sharp turns; manual handles are used as given", () => {
    const n = nodes([[0, 0], [1, 1], [2, 0]]);
    n[1].mode = "corner";
    const segs = curveSegments({ nodes: n, closed: false });
    // Both pieces straight when the corner frees them
    expect(segs[0].c1.y / segs[0].c1.x).toBeCloseTo(1, 6);
    const m = nodes([[0, 0], [1, 0]]);
    m[0] = { p: { x: 0, y: 0 }, mode: "manual", hout: { x: 0, y: 1 }, hin: { x: 0, y: -1 } };
    expect(curveSegments({ nodes: m, closed: false })[0].c1).toEqual({ x: 0, y: 1 });
  });
  it("handles a large closed curve without blowing up", () => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 30; i++) pts.push([Math.cos(i / 5) * (2 + Math.sin(i)), Math.sin(i / 5) * 2 + i * 0.1]);
    for (const p of sampleCurve({ nodes: nodes(pts), closed: true })) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});
