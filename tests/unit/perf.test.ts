import { describe, expect, it } from "vitest";
import { buildSnapIndex } from "../../src/model/snap";
import { DEFAULT_STYLE, type Obj } from "../../src/model/types";

describe("performance", () => {
  it("builds the snap index for a busy figure quickly", () => {
    const objs: Obj[] = [];
    for (let i = 0; i < 60; i++) {
      objs.push({ id: "c" + i, type: "curve", style: DEFAULT_STYLE, closed: false, nodes: Array.from({ length: 5 }, (_, k) => ({ p: { x: k * 2 + (i % 7), y: Math.sin(k + i) * 3 + i * 0.3 }, mode: "smooth" as const })) });
      objs.push({ id: "l" + i, type: "path", style: DEFAULT_STYLE, closed: false, pts: [{ x: i * 0.3, y: -5 }, { x: 10 - i * 0.2, y: 15 }] });
    }
    const t0 = performance.now();
    buildSnapIndex(objs);
    const ms = performance.now() - t0;
    console.log(`snap index for ${objs.length} objects: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(60);
  });
});
