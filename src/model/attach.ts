// Lines stay attached to their dots: when dots move (and the lines ending at
// them don't), the line ends and corners that were on a dot move with it. This
// keeps graphs, triangulations and labelled diagrams joined up.
import type { Obj, Vec } from "./types";

const same = (a: Vec, b: Vec) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/** `moved` (the moved versions of `orig`, same order) plus the other
 *  objects of `scene` whose points sat on a moved dot, with those points moved. */
export function withAttached(orig: Obj[], moved: Obj[], scene: Obj[]): Obj[] {
  const shifts: [Vec, Vec][] = [];
  orig.forEach((o, i) => {
    const n = moved[i];
    if (o.type === "point" && n?.type === "point" && !same(o.p, n.p)) shifts.push([o.p, n.p]);
  });
  if (!shifts.length) return moved;
  const ids = new Set(orig.map((o) => o.id));
  const to = (p: Vec): Vec | null => shifts.find(([a]) => same(a, p))?.[1] ?? null;
  const extra: Obj[] = [];
  for (const o of scene) {
    if (ids.has(o.id) || o.hidden) continue;
    if (o.type === "path") {
      let changed = false;
      const pts = o.pts.map((p) => {
        const q = to(p);
        if (q) changed = true;
        return q ?? p;
      });
      if (changed) extra.push({ ...o, pts });
    } else if (o.type === "curve") {
      let changed = false;
      const nodes = o.nodes.map((n) => {
        const q = to(n.p);
        if (q) changed = true;
        return q ? { ...n, p: q } : n;
      });
      if (changed) extra.push({ ...o, nodes });
    }
  }
  return [...moved, ...extra];
}

/** Ids of the objects that would follow these dots (see withAttached). */
export function attachedIds(orig: Obj[], scene: Obj[]): string[] {
  const moved = orig.map((o) => (o.type === "point" ? { ...o, p: { x: o.p.x + 1, y: o.p.y } } : o));
  return withAttached(orig, moved, scene)
    .slice(orig.length)
    .map((o) => o.id);
}
