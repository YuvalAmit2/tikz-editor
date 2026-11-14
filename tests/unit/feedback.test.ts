// Trim, smart label placement, symmetric dragging, magnetic grid lines.
import { describe, expect, it } from "vitest";
import { trimAt, toChain, chainPoint } from "../../src/model/trim";
import { placeLabel, segHitsBox } from "../../src/model/labelPlace";
import { mirrorOf } from "../../src/tools/controller";
import { snapGridLines } from "../../src/model/snap";
import { curveSegments, bezierPoint } from "../../src/model/curve";
import { DEFAULT_STYLE, type CurveObj, type EllipseObj, type Obj, type PathObj } from "../../src/model/types";
import { closestOnEllipse, dist } from "../../src/model/geometry";

const st = { ...DEFAULT_STYLE };
const line = (id: string, a: [number, number], b: [number, number]): PathObj => ({ id, type: "path", style: st, pts: [{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }], closed: false });
const circle: EllipseObj = { id: "c", type: "ellipse", style: st, c: { x: 0, y: 0 }, rx: 2, ry: 2, rot: 0 };

/** Points along an object (for checking where it is). */
function samples(o: Obj): { x: number; y: number }[] {
  if (o.type === "path") return o.pts;
  if (o.type === "curve") return curveSegments(o).flatMap((s) => [0, 0.25, 0.5, 0.75, 1].map((t) => bezierPoint(s, t)));
  return [];
}

describe("trim", () => {
  it("cuts a circle in half along a line through it", () => {
    const cut = line("l", [-3, 0], [3, 0]);
    const r = trimAt(circle, { x: 0, y: 2 }, [cut])!;
    expect(r.kept).toHaveLength(1);
    const half = r.kept[0] as CurveObj;
    expect(half.type).toBe("curve");
    // What's left is the lower half: ends on the line, all points on the circle, below it.
    const pts = samples(half);
    for (const p of pts) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(2, 2);
      expect(p.y).toBeLessThan(1e-6);
    }
    const ends = [half.nodes[0].p, half.nodes[half.nodes.length - 1].p];
    for (const e of ends) expect(Math.abs(e.y)).toBeLessThan(1e-6);
    expect(Math.abs(ends[0].x)).toBeCloseTo(2, 6);
  });

  it("cuts a circle by any amount: a chord at y = 1 removes a cap", () => {
    const r = trimAt(circle, { x: 0, y: 2 }, [line("l", [-3, 1], [3, 1])])!;
    const keep = r.kept[0] as CurveObj;
    for (const p of samples(keep)) expect(p.y).toBeLessThan(1 + 1e-6);
    expect(keep.nodes[0].p.y).toBeCloseTo(1, 6);
  });

  it("removes the middle of a line between two crossings, keeping both ends", () => {
    const l = line("a", [0, 0], [6, 0]);
    const r = trimAt(l, { x: 3, y: 0 }, [line("b", [2, -1], [2, 1]), line("c", [4, -1], [4, 1])])!;
    expect(r.kept.map((o) => (o as PathObj).pts)).toEqual([
      [{ x: 0, y: 0 }, { x: 2, y: 0 }],
      [{ x: 4, y: 0 }, { x: 6, y: 0 }],
    ]);
  });

  it("removes an end piece, and a lone object entirely", () => {
    const l = line("a", [0, 0], [6, 0]);
    const r = trimAt(l, { x: 5, y: 0 }, [line("b", [2, -1], [2, 1])])!;
    expect(r.kept).toHaveLength(1);
    expect((r.kept[0] as PathObj).pts).toEqual([{ x: 0, y: 0 }, { x: 2, y: 0 }]);
    expect(trimAt(l, { x: 5, y: 0 }, [])!.kept).toHaveLength(0);
  });

  it("opens a rectangle at a side cut by a line", () => {
    const rect: PathObj = { id: "r", type: "path", style: st, closed: true, pts: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }] };
    const r = trimAt(rect, { x: 4, y: 1 }, [line("l", [2, -1], [2, 3])])!;
    const k = r.kept[0] as PathObj;
    expect(k.closed).toBe(false);
    expect(k.pts).toEqual([{ x: 2, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 0 }, { x: 2, y: 0 }]);
  });

  it("ellipse chain matches the ellipse closely", () => {
    const e: EllipseObj = { id: "e", type: "ellipse", style: st, c: { x: 1, y: 2 }, rx: 3, ry: 1, rot: 30 };
    const c = toChain(e)!;
    for (let s = 0; s < 4; s += 0.1) {
      const p = chainPoint(c, s);
      // distance to the true ellipse (dense search)
      expect(dist(p, closestOnEllipse(e, p))).toBeLessThan(0.002);
    }
  });

  it("cuts a curve against a curve exactly at the crossing", () => {
    const a: CurveObj = { id: "a", type: "curve", style: st, closed: false, nodes: [{ p: { x: -2, y: 0 }, mode: "smooth" }, { p: { x: 0, y: 1 }, mode: "smooth" }, { p: { x: 2, y: 0 }, mode: "smooth" }] };
    const b = line("b", [0.5, -1], [0.5, 3]);
    const r = trimAt(a, { x: 1.5, y: 0.5 }, [b])!;
    const k = r.kept[0] as CurveObj;
    expect(k.nodes[k.nodes.length - 1].p.x).toBeCloseTo(0.5, 6);
  });
});

describe("smart labels", () => {
  it("segment/box test", () => {
    const b = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    expect(segHitsBox({ x: -1, y: 0.5 }, { x: 2, y: 0.5 }, b)).toBe(true);
    expect(segHitsBox({ x: -1, y: 2 }, { x: 2, y: 2 }, b)).toBe(false);
    expect(segHitsBox({ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.3 }, b)).toBe(true);
  });

  it("puts a label beside a line, clear of it and of a crossing line", () => {
    const l = line("a", [0, 0], [4, 0]);
    const cross = line("x", [2, -2], [2, 2]);
    const size = { w: 0.6, h: 0.4 };
    const { p, anchor } = placeLabel([l], [l, cross], size, () => null);
    const fx = anchor.includes("west") ? 0 : anchor.includes("east") ? 1 : 0.5;
    const fy = anchor.includes("south") ? 0 : anchor.includes("north") ? 1 : 0.5;
    const box = { minX: p.x - fx * size.w, minY: p.y - fy * size.h, maxX: p.x - fx * size.w + size.w, maxY: p.y - fy * size.h + size.h };
    for (const o of [l, cross]) expect(segHitsBox(o.pts[0], o.pts[1], box)).toBe(false);
    // near the line
    expect(Math.min(Math.abs(box.minY), Math.abs(box.maxY))).toBeLessThan(0.3);
  });

  it("labels a circle outside it and avoids a line leaving it to the upper right", () => {
    const ray = line("r", [1.4, 1.4], [4, 4]);
    const size = { w: 0.5, h: 0.4 };
    const { p, anchor } = placeLabel([circle], [circle, ray], size, () => null);
    expect(Math.hypot(p.x, p.y)).toBeGreaterThan(2);
    expect(anchor).not.toBe("south west"); // the upper-right spot is taken by the ray
  });
});

describe("symmetric dragging", () => {
  it("a line's other end moves through the midpoint", () => {
    const m = mirrorOf([{ x: 0, y: 0 }, { x: 2, y: 0 }], false, 1)!;
    expect(m.partner).toBe(0);
    // midpoint (1, 0): dragging the end out to 3 moves the start out to -1
    expect(m.R({ x: 3, y: 0 })).toEqual({ x: -1, y: 0 });
  });

  it("a three-point arch mirrors across its axis", () => {
    const m = mirrorOf([{ x: -2, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 0 }], false, 2)!;
    expect(m.partner).toBe(0);
    const q = m.R({ x: 3, y: -1 });
    expect(q.x).toBeCloseTo(-3, 9);
    expect(q.y).toBeCloseTo(-1, 9);
    expect(mirrorOf([{ x: -2, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 0 }], false, 1)).toBeNull();
    expect(mirrorOf([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], true, 0)).toBeNull();
  });
});

describe("magnetic grid lines", () => {
  // grid 0.25 cm at 80 px/cm: 20 px apart, band = min(6 px, 5 px) = 5 px = 0.0625 cm
  const r = 10 / 80;
  it("locks an axis near a grid line and leaves the other free", () => {
    const s = snapGridLines({ x: 1.02, y: 0.62 }, 0.25, 80, r);
    expect(s.p.x).toBe(1);
    expect(s.p.y).toBe(0.62);
    expect(s.kind).toBe("grid");
  });
  it("snaps to a grid point when near both, nothing when near neither", () => {
    expect(snapGridLines({ x: 1.02, y: 0.51 }, 0.25, 80, r).p).toEqual({ x: 1, y: 0.5 });
    expect(snapGridLines({ x: 1.12, y: 0.62 }, 0.25, 80, r).kind).toBe("none");
  });
  it("uses the grid that's drawn when zoomed out", () => {
    // 0.25 cm at 30 px/cm is 7.5 px: drawn (and snapped) every 0.5 cm
    expect(snapGridLines({ x: 0.26, y: 0.49 }, 0.25, 30, 10 / 30).p).toEqual({ x: 0.26, y: 0.5 });
  });
});
