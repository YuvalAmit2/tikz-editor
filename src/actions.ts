// Commands used by the keyboard, toolbar and panels.
import { call, isElectron } from "./api/client";
import { clearLabelCache } from "./labels/render";
import { scalingAbout, rotationAbout, transformObj, translation, unionBox, geomBox, type Box } from "./model/geometry";
import type { Settings } from "./model/settings";
import { emptyScene, newId, type Obj, type Style } from "./model/types";
import { sceneToTikz, tikzToScene } from "./tikz/export";
import { cancelDraft, selectionBox } from "./tools/controller";
import { store, TRUE_ZOOM, type ToolName } from "./store";
import { labelBox } from "./labels/render";

export function setTool(tool: ToolName) {
  cancelDraft();
  store.set({ tool, pointEdit: null, editingLabel: tool === "select" ? store.get().editingLabel : null });
}

/** Change style: applies to the selection (if any) and to new objects. */
export function applyStyle(patch: Partial<Style>, extra: Partial<Obj> = {}) {
  const s = store.get();
  store.set({ style: { ...s.style, ...patch } });
  const sel = store.selected();
  if (sel.length === 0) return;
  const changed = sel.map((o) => ({ ...o, ...extra, style: { ...o.style, ...patch } }) as Obj);
  store.commit(store.withReplaced(changed));
}

/** Change non-style properties (label anchor, font, text mode, point size). */
export function applyProps(patch: Partial<Obj>, filter: (o: Obj) => boolean) {
  const sel = store.selected().filter(filter);
  if (sel.length === 0) return;
  store.commit(store.withReplaced(sel.map((o) => ({ ...o, ...patch }) as Obj)));
}

export function deleteSelection() {
  const s = store.get();
  if (s.selection.length === 0) return;
  const sel = new Set(s.selection);
  store.commit({ ...s.scene, objects: s.scene.objects.filter((o) => !sel.has(o.id)) }, { selection: [], editingLabel: null, pointEdit: null });
}

export function selectAll() {
  store.set({ selection: store.get().scene.objects.map((o) => o.id), tool: "select" });
}

let clipboard: Obj[] = [];
export function copy() {
  clipboard = store.selected();
}

function pasteObjs(objs: Obj[], offset: number) {
  if (objs.length === 0) return;
  const s = store.get();
  const m = translation(offset, -offset);
  const copies = objs.map((o) => ({ ...transformObj(o, m), id: newId() }));
  store.commit({ ...s.scene, objects: [...s.scene.objects, ...copies] }, { selection: copies.map((o) => o.id), tool: "select" });
}

export function paste() {
  pasteObjs(clipboard, store.get().settings.gridSize * 2);
}

export function duplicate() {
  pasteObjs(store.selected(), store.get().settings.gridSize * 2);
}

function transformSelection(make: (b: Box) => ReturnType<typeof scalingAbout>) {
  const sel = store.selected();
  const b = selectionBox();
  if (!b || sel.length === 0) return;
  const m = make(b);
  store.commit(store.withReplaced(sel.map((o) => transformObj(o, m))));
}

const centre = (b: Box) => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
export const flipH = () => transformSelection((b) => scalingAbout(centre(b), -1, 1));
export const flipV = () => transformSelection((b) => scalingAbout(centre(b), 1, -1));
export const rotate90 = (dir: 1 | -1) => transformSelection((b) => rotationAbout(centre(b), 90 * dir));

export function nudge(dx: number, dy: number) {
  const sel = store.selected();
  if (sel.length === 0) return;
  const m = translation(dx, dy);
  store.commit(store.withReplaced(sel.map((o) => transformObj(o, m))));
}

// ---------------------------------------------------------------- view

export function zoomAt(factor: number, screen?: { x: number; y: number }, size?: { w: number; h: number }) {
  const v = store.get().view;
  const zoom = Math.min(4000, Math.max(2, v.zoom * factor));
  if (!screen || !size) return store.set({ view: { ...v, zoom } });
  // Keep the world point under the cursor fixed.
  const wx = v.cx + (screen.x - size.w / 2) / v.zoom;
  const wy = v.cy - (screen.y - size.h / 2) / v.zoom;
  store.set({ view: { zoom, cx: wx - (screen.x - size.w / 2) / zoom, cy: wy + (screen.y - size.h / 2) / zoom } });
}

export function zoomToFit(size: { w: number; h: number }) {
  let b: Box | null = null;
  for (const o of store.get().scene.objects) b = unionBox(b, o.type === "label" ? labelBox(o) : geomBox(o));
  if (!b) return store.set({ view: { cx: 0, cy: 0, zoom: TRUE_ZOOM * 1.5 } });
  const w = Math.max(b.maxX - b.minX, 0.5);
  const h = Math.max(b.maxY - b.minY, 0.5);
  const zoom = Math.min((size.w * 0.8) / w, (size.h * 0.8) / h, TRUE_ZOOM * 8);
  store.set({ view: { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, zoom } });
}

export const zoomTrueSize = () => store.set({ view: { ...store.get().view, zoom: TRUE_ZOOM } });

// ---------------------------------------------------------------- files

async function askPath(kind: "save" | "open", def: string): Promise<string | null> {
  if (isElectron) {
    return (await call<string | null>(kind === "save" ? "showSaveDialog" : "showOpenDialog", { defaultPath: def })) ?? null;
  }
  return window.prompt(kind === "save" ? "Save figure as (path to a .tikz file):" : "Open figure (path to a .tikz file):", def);
}

export async function save(saveAs = false) {
  const s = store.get();
  let path = s.filePath;
  if (!path || saveAs) {
    path = await askPath("save", s.filePath ?? "graphics/figure.tikz");
    if (!path) return;
    if (!path.endsWith(".tikz")) path += ".tikz";
  }
  try {
    await call("writeFile", { path, content: sceneToTikz(store.get().scene) });
    store.set({ filePath: path, dirty: false });
    store.flash(`Saved ${path}`);
  } catch (e) {
    store.flash(`Could not save: ${(e as Error).message}`);
  }
}

export async function openPath(path: string) {
  const exists = await call<boolean>("fileExists", { path });
  if (!exists) {
    // A new figure that will be saved to this path.
    store.resetHistory();
    store.set({ scene: emptyScene(), filePath: path, dirty: false, selection: [], editingLabel: null, pointEdit: null });
    return;
  }
  const text = await call<string>("readFile", { path });
  const scene = tikzToScene(text);
  if (!scene) {
    store.flash("That file wasn't made by TikZ Editor, so it can't be opened.");
    return;
  }
  store.resetHistory();
  store.set({ scene, filePath: path, dirty: false, selection: [], editingLabel: null, pointEdit: null });
}

export async function open() {
  if (store.get().dirty && !window.confirm("Discard unsaved changes?")) return;
  const path = await askPath("open", store.get().filePath ?? "graphics/");
  if (path) await openPath(path);
}

export function newFigure() {
  if (store.get().dirty && !window.confirm("Discard unsaved changes?")) return;
  store.resetHistory();
  store.set({ scene: emptyScene(), filePath: null, dirty: false, selection: [], editingLabel: null, pointEdit: null });
}

export async function saveSettings(settings: Settings) {
  const old = store.get().settings;
  store.set({ settings });
  await call("saveSettings", { settings });
  if (old.preamble !== settings.preamble || old.preambleFile !== settings.preambleFile || old.documentClass !== settings.documentClass) clearLabelCache();
}
