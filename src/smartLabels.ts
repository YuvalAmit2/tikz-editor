// Smart labels are placed with a guessed size when created; once the label
// has been typed and compiled, it's placed again with its real size (once).
import { getLabel, labelBox, labelStore } from "./labels/render";
import { placeLabel } from "./model/labelPlace";
import type { LabelObj, Obj, Scene, Vec } from "./model/types";
import { store } from "./store";

function update() {
  const s = store.get();
  const done: LabelObj[] = [];
  for (const o of s.scene.objects) {
    if (o.type !== "label" || !o.attach || s.editingLabel === o.id) continue;
    const e = getLabel(o);
    if (!e || e.status === "pending") continue;
    const { attach, ...rest } = o;
    if (e.status !== "ok") {
      done.push(rest);
      continue;
    }
    const targets = s.scene.objects.filter((x) => attach.includes(x.id));
    if (!targets.length) {
      done.push(rest);
      continue;
    }
    const { p, anchor } = placeLabel(targets, s.scene.objects, { w: e.w!, h: e.h! }, labelBox, [o.id]);
    done.push({ ...rest, p, anchor });
  }
  // Not an undo step of its own: part of creating the label.
  if (done.length) store.preview(store.withReplaced(done));
}

/** Where a label's objects are (the mean of their points: moves exactly
 *  with them under any move, rotation or scaling). */
export function followRef(objs: Obj[]): Vec | null {
  const pts: Vec[] = [];
  for (const o of objs) {
    if (o.type === "path") pts.push(...o.pts);
    else if (o.type === "curve") pts.push(...o.nodes.map((n) => n.p));
    else if (o.type === "ellipse") pts.push(o.c);
    else pts.push(o.p);
  }
  if (!pts.length) return null;
  return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
}

/** Labels whose objects moved go with them (or find a clear spot again). */
export function followLabels(scene: Scene): Scene {
  let changed: LabelObj[] | null = null;
  for (const o of scene.objects) {
    if (o.type !== "label" || !o.follow || o.follow.off) continue;
    const targets = scene.objects.filter((x) => o.follow!.ids.includes(x.id));
    const ref = followRef(targets);
    if (!ref) continue;
    const d = { x: ref.x - o.follow.ref.x, y: ref.y - o.follow.ref.y };
    if (Math.hypot(d.x, d.y) < 1e-9) continue;
    let next: LabelObj;
    const b = labelBox(o);
    if (o.follow.avoid && b && !o.attach) {
      const { p, anchor } = placeLabel(targets, scene.objects, { w: b.maxX - b.minX, h: b.maxY - b.minY }, labelBox, [o.id]);
      next = { ...o, p, anchor, follow: { ...o.follow, ref } };
    } else next = { ...o, p: { x: o.p.x + d.x, y: o.p.y + d.y }, follow: { ...o.follow, ref } };
    (changed ??= []).push(next);
  }
  if (!changed) return scene;
  const m = new Map(changed.map((o) => [o.id, o as Obj]));
  return { ...scene, objects: scene.objects.map((o) => m.get(o.id) ?? o) };
}

export function initSmartLabels() {
  store.sceneHook = followLabels;
  labelStore.subscribe(update);
  store.subscribe(() => {
    // Editing finished: the label may already be compiled.
    const id = store.get().editingLabel;
    if (id !== lastEditing) {
      lastEditing = id;
      queueMicrotask(update);
    }
  });
}
let lastEditing: string | null = null;
