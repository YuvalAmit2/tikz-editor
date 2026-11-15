// Smart labels are placed with a guessed size when created; once the label
// has been typed and compiled, it's placed again with its real size (once).
import { getLabel, labelBox, labelStore } from "./labels/render";
import { labelCrossesLines, placeLabel } from "./model/labelPlace";
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

/** Labels whose objects moved go with them. While dragging (a preview) they
 *  just move along, so they don't jump about; when the change is made, a
 *  label that keeps clear of lines and now crosses one (because its object
 *  moved, or something was drawn through it) finds a clear spot again. A
 *  label just moved by hand stays where it was put. */
export function followLabels(scene: Scene, prev: Scene | null, final: boolean): Scene {
  let changed: LabelObj[] | null = null;
  const before = new Map((prev?.objects ?? []).map((o) => [o.id, o]));
  for (const o of scene.objects) {
    if (o.type !== "label" || !o.follow || o.follow.off) continue;
    const targets = scene.objects.filter((x) => o.follow!.ids.includes(x.id));
    const ref = followRef(targets);
    if (!ref) continue;
    const d = { x: ref.x - o.follow.ref.x, y: ref.y - o.follow.ref.y };
    const moved = Math.hypot(d.x, d.y) > 1e-9;
    let next: LabelObj = moved ? { ...o, p: { x: o.p.x + d.x, y: o.p.y + d.y }, follow: { ...o.follow, ref } } : o;
    const old = before.get(o.id) as LabelObj | undefined;
    // Moved by hand: it moved by something other than what its objects did.
    const byHand = !!old?.follow && Math.hypot(o.p.x - old.p.x - (o.follow.ref.x - old.follow.ref.x), o.p.y - old.p.y - (o.follow.ref.y - old.follow.ref.y)) > 1e-9;
    const b = labelBox(o);
    if (final && o.follow.avoid && b && !o.attach && !byHand) {
      const size = { w: b.maxX - b.minX, h: b.maxY - b.minY };
      if (labelCrossesLines(next.p, next.anchor, size, scene.objects, [o.id])) {
        const { p, anchor } = placeLabel(targets, scene.objects, size, labelBox, [o.id]);
        next = { ...next, p, anchor };
      }
    }
    if (next !== o) (changed ??= []).push(next);
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
