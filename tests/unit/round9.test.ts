// Ninth round: the paint bucket inside shapes that hold other shapes, labels
// beside a blob (not its bounding box), clicking shapes drawn on a fill.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { regionAt } from "../../src/model/region";
import { placeLabel } from "../../src/model/labelPlace";
import { sampleCurve } from "../../src/model/curve";
import { geomBox, insideFill, insideOutline, type Box } from "../../src/model/geometry";
import { DEFAULT_STYLE, type Obj, type Scene } from "../../src/model/types";

const st = { ...DEFAULT_STYLE };
const C = (id: string, x: number, y: number, r: number): Obj => ({ id, type: "ellipse", style: st, c: { x, y }, rx: r, ry: r, rot: 0 });
const K = (id: string, ...p: number[][]): Obj => ({ id, type: "curve", style: st, closed: true, nodes: p.map(([x, y]) => ({ p: { x, y }, mode: "smooth" as const })) });

// The user's figure: a dashed blob with two dashed circles in it, inside a
// bigger dashed outline.
const fixture: Scene = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/blob-with-holes.json"), "utf8"));
const [blob, outer] = fixture.objects;

describe("paint bucket: the nearest line may belong to a shape you're outside of", () => {
  it("fills everywhere inside the blob, around the circles (dashed lines count as lines)", () => {
    const b = geomBox(blob)!;
    let tried = 0;
    for (let i = 1; i < 30; i++)
      for (let j = 1; j < 20; j++) {
        const p = { x: b.minX + ((b.maxX - b.minX) * i) / 30, y: b.minY + ((b.maxY - b.minY) * j) / 20 };
        if (!insideOutline(blob, p) || fixture.objects.slice(2).some((c) => insideOutline(c, p))) continue;
        tried++;
        const r = regionAt(fixture.objects, p);
        expect(r, `at ${p.x}, ${p.y}`).not.toBeNull();
        expect(r!.holes?.length).toBe(2);
      }
    expect(tried).toBeGreaterThan(100);
  });

  it("the ring between the blob and the outline has the blob as its hole", () => {
    const b = geomBox(outer)!;
    let tried = 0;
    for (let i = 1; i < 30; i++)
      for (let j = 1; j < 20; j++) {
        const p = { x: b.minX + ((b.maxX - b.minX) * i) / 30, y: b.minY + ((b.maxY - b.minY) * j) / 20 };
        if (!insideOutline(outer, p) || insideOutline(blob, p)) continue;
        tried++;
        const r = regionAt(fixture.objects, p);
        expect(r, `at ${p.x}, ${p.y}`).not.toBeNull();
        expect(r!.holes?.length).toBe(1);
      }
    expect(tried).toBeGreaterThan(50);
  });

  it("a small circle just to the right of the click", () => {
    const r = regionAt([C("big", 0, 0, 3), C("small", 1, 0, 0.5)], { x: 0, y: 0 });
    expect(r?.holes?.length).toBe(1);
    // Inside the small one: just it.
    expect(regionAt([C("big", 0, 0, 3), C("small", 1, 0, 0.5)], { x: 1, y: 0 })?.whole).toBe("small");
  });
});

describe("a filled shape with holes", () => {
  it("is not hit inside its holes", () => {
    const fill = { ...(K("f", [-3, 0], [0, 3], [3, 0], [0, -3]) as Obj), style: { ...st, fill: "gray" } } as Obj & { holes?: Obj[] };
    const holed = { ...fill, holes: [K("h", [-0.5, 0], [0, 0.5], [0.5, 0], [0, -0.5])] } as Obj;
    expect(insideFill(fill, { x: 0, y: 0 })).toBe(true);
    expect(insideFill(holed, { x: 0, y: 0 })).toBe(false);
    expect(insideFill(holed, { x: 1.5, y: 0 })).toBe(true);
  });
});

describe("smart label of a blob", () => {
  // Like the user's: its widest point is low on the right, far from the
  // middle of its right side.
  const shape = K("blob", [-3.5, 0.5], [-2, 3], [0.5, 3.5], [2, 2], [2, -1], [3.5, -2.5], [0, -3], [-3, -2.5]);
  const gapTo = (b: Box) => {
    let d = Infinity;
    for (const p of sampleCurve(shape as never, 32)) d = Math.min(d, Math.hypot(Math.max(b.minX - p.x, 0, p.x - b.maxX), Math.max(b.minY - p.y, 0, p.y - b.maxY)));
    return d;
  };
  it("sits beside the line, not out at its bounding box", () => {
    const size = { w: 0.3, h: 0.3 };
    const { p, anchor } = placeLabel([shape], [shape], size, () => null);
    const fx = anchor.includes("west") ? 0 : anchor.includes("east") ? 1 : 0.5;
    const fy = anchor.includes("south") ? 0 : anchor.includes("north") ? 1 : 0.5;
    const b = { minX: p.x - fx * size.w, minY: p.y - fy * size.h, maxX: p.x - fx * size.w + size.w, maxY: p.y - fy * size.h + size.h };
    expect(gapTo(b)).toBeLessThan(0.3);
  });
});
