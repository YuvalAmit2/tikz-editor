import { describe, expect, it } from "vitest";
import { ellipsePoint, rotationAbout, scalingAbout, transformEllipse, applyAffine } from "../../src/model/geometry";
import { buildSnapIndex, snap } from "../../src/model/snap";
import { hasMathDelimiters, labelBody } from "../../src/labels/mode";
import { fmt } from "../../src/tikz/export";
import { DEFAULT_STYLE, type EllipseObj, type Obj } from "../../src/model/types";

const E = (rx: number, ry: number, rot: number): EllipseObj => ({ id: "e", type: "ellipse", style: DEFAULT_STYLE, c: { x: 1, y: 2 }, rx, ry, rot });

describe("ellipse transforms", () => {
  it("maps every point of the ellipse correctly (rotation + non-uniform scale)", () => {
    const e = E(3, 1, 30);
    const m = scalingAbout({ x: 0, y: 0 }, 2, 0.5);
    const e2 = transformEllipse(e, m);
    // Each image point must lie on the new ellipse: check via implicit equation.
    for (let k = 0; k < 12; k++) {
      const q = applyAffine(m, ellipsePoint(e, (k / 12) * 2 * Math.PI));
      const r = (-e2.rot * Math.PI) / 180;
      const dx = q.x - e2.c.x;
      const dy = q.y - e2.c.y;
      const u = (dx * Math.cos(r) - dy * Math.sin(r)) / e2.rx;
      const w = (dx * Math.sin(r) + dy * Math.cos(r)) / e2.ry;
      expect(u * u + w * w).toBeCloseTo(1, 6);
    }
  });
  it("rotation adds to the angle", () => {
    const e2 = transformEllipse(E(2, 1, 10), rotationAbout({ x: 0, y: 0 }, 25));
    expect(e2.rot).toBeCloseTo(35, 6);
    expect(e2.rx).toBeCloseTo(2, 9);
  });
});

describe("snapping", () => {
  const objs: Obj[] = [
    { id: "a", type: "path", closed: false, style: DEFAULT_STYLE, pts: [{ x: 0, y: 0 }, { x: 4, y: 4 }] },
    { id: "b", type: "path", closed: false, style: DEFAULT_STYLE, pts: [{ x: 0, y: 4 }, { x: 4, y: 0 }] },
  ];
  const idx = buildSnapIndex(objs);
  const opts = { radius: 0.3, gridSize: 0.25, snapToGrid: true, snapToObjects: true };
  it("finds intersections", () => {
    const r = snap({ x: 2.1, y: 1.9 }, idx, opts);
    expect(r.kind === "intersection" || r.kind === "midpoint").toBe(true);
    expect(r.p.x).toBeCloseTo(2);
    expect(r.p.y).toBeCloseTo(2);
  });
  it("falls back to the grid", () => {
    const r = snap({ x: 3.1, y: 0.62 }, idx, opts);
    expect(r).toEqual({ p: { x: 3, y: 0.5 }, kind: "grid" });
  });
  it("constrains angles to 15 degrees", () => {
    const r = snap({ x: 3, y: 0.2 }, null, { ...opts, angleFrom: { x: 0, y: 0 } });
    expect(r.p.y).toBeCloseTo(0);
    expect(r.p.x).toBeCloseTo(3);
  });
});

describe("labels: math by default", () => {
  it("detects math delimiters", () => {
    expect(hasMathDelimiters("\\cO_K")).toBe(false);
    expect(hasMathDelimiters("Consider $\\cO_K$")).toBe(true);
    expect(hasMathDelimiters("costs \\$5")).toBe(false);
    expect(hasMathDelimiters("\\(x\\)")).toBe(true);
  });
  it("wraps plain labels in math", () => {
    expect(labelBody("\\cO_K", false)).toBe("$\\cO_K$");
    expect(labelBody("Consider $\\cO_K$", false)).toBe("Consider $\\cO_K$");
    expect(labelBody("torus", true)).toBe("torus");
    expect(labelBody("a\\\\b", false)).toBe("$a$\\\\$b$");
    expect(labelBody("  ", false)).toBe("");
  });
});

describe("number formatting", () => {
  it("rounds to 3 decimals without trailing zeros", () => {
    expect(fmt(1.23456)).toBe("1.235");
    expect(fmt(2)).toBe("2");
    expect(fmt(-0.0001)).toBe("0");
    expect(fmt(0.5)).toBe("0.5");
  });
});
