// Smart labels are placed with a guessed size when created; once the label
// has been typed and compiled, it's placed again with its real size (once).
import { getLabel, labelBox, labelInkSize, labelStore, nodePointForInk } from "./labels/render";
import { labelCrossesLines, placeLabel, spotAt } from "./model/labelPlace";
import type { LabelObj, Obj, Scene, Vec } from "./model/types";
import { store } from "./store";

function update() {
  const s = store.get();
  const done: LabelObj[] = [];
  for (const o of s.scene.objects) {
    // Text tool labels: the text centred on where it was clicked.
    if (o.type === "label" && o.inkAt && !o.attach) {
      const e = getLabel(o);
      if (e?.status !== "ok") continue;
      const p = nodePointForInk(o, o.inkAt, o.anchor);
      if (Math.hypot(p.x - o.p.x, p.y - o.p.y) > 1e-9) done.push({ ...o, p });
      continue;
    }
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
    // Near where it was first put (by the side of the object that was clicked).
    const ref = followRef(targets);
    const home = rest.follow?.home;
    const near = home && ref ? { x: ref.x + home.x, y: ref.y + home.y } : centreOf(o);
    const { p, anchor } = rest.follow?.at ? spotAt(targets, rest.follow.at) : placeLabel(targets, s.scene.objects, labelInkSize(o)!, labelBox, [o.id], near);
    done.push({ ...rest, p: nodePointForInk(o, p, anchor), anchor });
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
    // Text tool labels stay centred on their point (e.g. after the anchor changed).
    if (o.type === "label" && o.inkAt && !o.attach && getLabel(o)?.status === "ok") {
      const p = nodePointForInk(o, o.inkAt, o.anchor);
      if (Math.hypot(p.x - o.p.x, p.y - o.p.y) > 1e-9) (changed ??= []).push({ ...o, p });
      continue;
    }
    if (o.type !== "label" || !o.follow || o.follow.off) continue;
    const targets = scene.objects.filter((x) => o.follow!.ids.includes(x.id));
    const ref = followRef(targets);
    if (!ref) continue;
    const old = before.get(o.id) as LabelObj | undefined;
    // Moved by hand: the label itself moved (it carries where its objects
    // were, `ref`, along when it's moved) while its objects stayed put, or
    // its place changed some other way. From then on it stays where it was
    // put (relative to its objects). Not when its place was just chosen (the
    // grid, Auto). Drags are previewed from the scene before the drag, so
    // this compares the label's own data, not how far things moved.
    const sameHome = (a?: Vec, b?: Vec) => (!a && !b) || (!!a && !!b && Math.hypot(a.x - b.x, a.y - b.y) < 1e-9);
    const chosen = !!old?.follow && (old.follow.at !== o.follow.at || !sameHome(old.follow.home, o.follow.home) || old.follow.custom !== o.follow.custom);
    let byHand = false;
    if (old?.follow && !chosen) {
      const refBefore = followRef(prev!.objects.filter((x) => o.follow!.ids.includes(x.id)));
      const objectsStill = !!refBefore && Math.hypot(ref.x - refBefore.x, ref.y - refBefore.y) < 1e-9;
      const carried = { x: o.follow.ref.x - old.follow.ref.x, y: o.follow.ref.y - old.follow.ref.y };
      const moved = { x: o.p.x - old.p.x, y: o.p.y - old.p.y };
      byHand = (objectsStill && Math.hypot(carried.x, carried.y) > 1e-9) || Math.hypot(moved.x - carried.x, moved.y - carried.y) > 1e-9;
    }
    // Otherwise it goes along with its objects.
    const d = byHand ? { x: 0, y: 0 } : { x: ref.x - o.follow.ref.x, y: ref.y - o.follow.ref.y };
    let next: LabelObj = o;
    if (Math.hypot(d.x, d.y) > 1e-9) next = { ...next, p: { x: o.p.x + d.x, y: o.p.y + d.y } };
    if (Math.hypot(ref.x - o.follow.ref.x, ref.y - o.follow.ref.y) > 1e-9) next = { ...next, follow: { ...o.follow, ref } };
    if (byHand && final && !o.follow.custom) next = { ...next, follow: { ...next.follow!, custom: true, at: undefined } };
    const size = labelInkSize(o);
    const f = next.follow!;
    if (f.at && size && !byHand) {
      // A side or corner chosen from the grid.
      const { p, anchor } = spotAt(targets, f.at);
      next = withSpot(next, o, p, anchor);
    } else if (final && f.avoid && size && !o.attach && !byHand && !f.custom) {
      // Placed again after every change, as near its home as it can be
      // clear of lines (so a label pushed aside comes back). An older label
      // with no home yet only moves when something crosses it.
      const crossing = () => {
        const b = labelBox(next);
        return !!b && labelCrossesLines(b, scene.objects, [o.id]);
      };
      if (f.home || crossing()) {
        const home = f.home ?? sub(centreOf(o), o.follow.ref);
        const { p, anchor } = placeLabel(targets, scene.objects, size, labelBox, [o.id], { x: ref.x + home.x, y: ref.y + home.y });
        next = withSpot(next, o, p, anchor);
        if (!f.home) next = { ...next, follow: { ...next.follow!, home } };
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

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });

/** The label with its text at p (anchored there), if that's a change. */
function withSpot(next: LabelObj, o: LabelObj, p: Vec, anchor: LabelObj["anchor"]): LabelObj {
  const q = nodePointForInk(o, p, anchor);
  if (Math.hypot(q.x - next.p.x, q.y - next.p.y) < 1e-9 && anchor === next.anchor) return next;
  return { ...next, p: q, anchor };
}

/** The middle of a label's text (its anchor point before it's compiled). */
function centreOf(o: LabelObj): Vec {
  const b = labelBox(o);
  return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : o.p;
}
