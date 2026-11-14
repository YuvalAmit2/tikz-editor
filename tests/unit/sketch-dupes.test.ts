import { expect, it } from "vitest";
import { processStroke } from "../../src/model/sketch";

it("sketched strokes never have two anchors on the same spot", () => {
  const pts = [];
  // A wavy stroke with a sharp corner in it and a long tail (several Bézier pieces).
  for (let i = 0; i <= 200; i++) pts.push({ x: i * 0.03, y: Math.sin(i * 0.08) * 0.8 });
  for (let i = 1; i <= 200; i++) pts.push({ x: 6 - i * 0.02, y: -2 - Math.sin(i * 0.11) * 0.5 - i * 0.004 });
  for (const closeIt of [false, true]) {
    const raw = closeIt ? [...pts, pts[0]] : pts;
    const r = processStroke(raw, { tol: 0.02, spacing: 0.03, closeDist: 0.3, recognize: false })!;
    const n = r.nodes.length;
    for (let i = 0; i < n; i++) {
      const j = r.closed ? (i + 1) % n : i + 1;
      if (j >= n || j === i) continue;
      expect(Math.hypot(r.nodes[i].p.x - r.nodes[j].p.x, r.nodes[i].p.y - r.nodes[j].p.y)).toBeGreaterThan(1e-6);
    }
  }
});
