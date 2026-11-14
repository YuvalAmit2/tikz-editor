import { describe, expect, it } from "vitest";
import { processStroke } from "../../src/model/sketch";
import { sampleCurve } from "../../src/model/curve";
import type { Vec } from "../../src/model/types";

// Deterministic jitter, like a trackpad stroke at ~40 px/cm (0.025 cm/px).
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
const jitter = (pts: Vec[], amt = 0.03) => pts.map((p) => ({ x: p.x + rnd() * amt, y: p.y + rnd() * amt }));
const OPTS = { tol: 0.1, spacing: 0.05, closeDist: 0.3, recognize: true };

function along(path: (t: number) => Vec, n: number) {
  const pts: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    // uneven speed, like a real hand
    const t = i / n;
    pts.push(path(t * t * (3 - 2 * t)));
  }
  return pts;
}

describe("sketch tool", () => {
  it("recognises a wobbly line", () => {
    const r = processStroke(jitter(along((t) => ({ x: 4 * t, y: 1 + 2 * t }), 80)), OPTS)!;
    expect(r.shape?.kind).toBe("line");
  });
  it("recognises a circle", () => {
    const r = processStroke(jitter(along((t) => ({ x: 2 * Math.cos(t * 2 * Math.PI * 1.03), y: 2 * Math.sin(t * 2 * Math.PI * 1.03) }), 160)), OPTS)!;
    expect(r.shape?.kind).toBe("ellipse");
    const e = r.shape as any;
    expect(e.rx).toBeCloseTo(e.ry, 9);
    expect(Math.abs(e.rx - 2)).toBeLessThan(0.15);
    expect(Math.hypot(e.c.x, e.c.y)).toBeLessThan(0.15);
  });
  it("recognises an axis-aligned ellipse", () => {
    const r = processStroke(jitter(along((t) => ({ x: 3 * Math.cos(t * 2 * Math.PI), y: 1.5 * Math.sin(t * 2 * Math.PI) }), 160)), OPTS)!;
    const e = r.shape as any;
    expect(e.kind).toBe("ellipse");
    expect(e.rot).toBe(0);
    expect(e.rx / e.ry).toBeGreaterThan(1.6);
  });
  it("recognises a rectangle and squares it up", () => {
    const corners = [{ x: 0, y: 0 }, { x: 4, y: 0.1 }, { x: 4.05, y: 2 }, { x: -0.05, y: 2.05 }, { x: 0, y: 0 }];
    const pts: Vec[] = [];
    for (let i = 0; i < 4; i++) for (let k = 0; k < 40; k++) pts.push({ x: corners[i].x + ((corners[i + 1].x - corners[i].x) * k) / 40, y: corners[i].y + ((corners[i + 1].y - corners[i].y) * k) / 40 });
    pts.push(corners[0]);
    const r = processStroke(jitter(pts, 0.02), OPTS)!;
    expect(r.shape?.kind).toBe("polygon");
    const poly = (r.shape as any).pts as Vec[];
    expect(poly).toHaveLength(4);
    const xs = new Set(poly.map((p) => p.x.toFixed(6)));
    const ys = new Set(poly.map((p) => p.y.toFixed(6)));
    expect(xs.size).toBe(2);
    expect(ys.size).toBe(2);
  });
  it("fits a smooth wave with few anchors that stay close to the stroke", () => {
    const wave = (t: number) => ({ x: 6 * t, y: Math.sin(t * 2 * Math.PI) });
    const r = processStroke(jitter(along(wave, 200)), { ...OPTS, recognize: false })!;
    expect(r.shape).toBeNull();
    expect(r.nodes.length).toBeGreaterThanOrEqual(2);
    expect(r.nodes.length).toBeLessThanOrEqual(7);
    const pts = sampleCurve({ nodes: r.nodes, closed: r.closed }, 30);
    for (const p of pts) expect(Math.abs(p.y - Math.sin((p.x / 6) * 2 * Math.PI))).toBeLessThan(0.15);
  });
  it("a V shape keeps its corner", () => {
    const pts = [...along((t) => ({ x: 2 * t, y: 2 - 2 * t }), 60), ...along((t) => ({ x: 2 + 2 * t, y: 2 * t }), 60).slice(1)];
    const r = processStroke(jitter(pts, 0.01), { ...OPTS, recognize: false })!;
    const corner = r.nodes.find((n) => Math.hypot(n.p.x - 2, n.p.y) < 0.2);
    expect(corner).toBeTruthy();
  });
});
