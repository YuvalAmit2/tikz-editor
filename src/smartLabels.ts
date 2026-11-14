// Smart labels are placed with a guessed size when created; once the label
// has been typed and compiled, it's placed again with its real size (once).
import { getLabel, labelBox, labelStore } from "./labels/render";
import { placeLabel } from "./model/labelPlace";
import type { LabelObj } from "./model/types";
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

export function initSmartLabels() {
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
