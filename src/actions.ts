// Commands used by the keyboard, toolbar and panels.
import { call, isElectron } from "./api/client";
import { clearLabelCache } from "./labels/render";
import { scalingAbout, rotationAbout, transformObj, translation, unionBox, geomBox, sceneGeomBox, type Box } from "./model/geometry";
import type { Settings } from "./model/settings";
import { emptyScene, newId, type Dash, type LabelObj, type Obj, type Style } from "./model/types";
import { placeLabel } from "./model/labelPlace";
import { sceneToTikz, tikzToScene } from "./tikz/export";
import { cancelDraft, selectionBox } from "./tools/controller";
import { askText, store, TRUE_ZOOM, type ToolName } from "./store";
import { labelBox } from "./labels/render";

export function setTool(tool: ToolName) {
  cancelDraft();
  store.set({ tool, pointEdit: null, editingLabel: tool === "select" ? store.get().editingLabel : null });
}

/** Change style: applies to the selection and to new objects. */
export function applyStyle(patch: Partial<Style>, extra: Partial<Obj> = {}) {
  const s = store.get();
  const sel = store.selected();
  // Labels have no fill; their colour shouldn't turn the next shape's fill off.
  const forNew = sel.length > 0 && sel.every((o) => o.type === "label") ? { stroke: patch.stroke ?? s.style.stroke } : patch;
  store.set({ style: { ...s.style, ...(sel.length ? forNew : patch) } });
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
  return askText(kind === "save" ? "Save figure as" : "Open figure", { initial: def, label: "Path to a .tikz file", ok: kind === "save" ? "Save" : "Open" });
}

/** ⌘Enter: save, then (in the app) hide the window and go back to the editor you came from. */
export async function saveAndHide() {
  await save();
  if (store.get().dirty) return; // not saved (cancelled or failed)
  (window.tikzApi as any)?.hide?.();
}

/** A figure sent from outside (VS Code / the command line). */
export async function openFromOutside(path: string) {
  const s = store.get();
  if (s.filePath === path) return;
  if (s.dirty) {
    if (s.filePath) await save();
    else if (!window.confirm("Discard the unsaved figure?")) return;
  }
  await openPath(path);
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
    store.set({ scene: emptyScene(), filePath: path, dirty: false, selection: [], editingLabel: null, pointEdit: null, guideCx: 0 });
    return;
  }
  const text = await call<string>("readFile", { path });
  const scene = tikzToScene(text);
  if (!scene) {
    store.flash("That file wasn't made by TikZ Editor, so it can't be opened.");
    return;
  }
  store.resetHistory();
  const b = sceneGeomBox(scene.objects);
  store.set({ scene, filePath: path, dirty: false, selection: [], editingLabel: null, pointEdit: null, guideCx: b ? (b.minX + b.maxX) / 2 : 0 });
}

export async function open() {
  if (store.get().dirty && !window.confirm("Discard unsaved changes?")) return;
  const path = await askPath("open", store.get().filePath ?? "graphics/");
  if (path) await openPath(path);
}

export function newFigure() {
  if (store.get().dirty && !window.confirm("Discard unsaved changes?")) return;
  store.resetHistory();
  store.set({ scene: emptyScene(), filePath: null, dirty: false, selection: [], editingLabel: null, pointEdit: null, guideCx: 0 });
}

export async function saveSettings(settings: Settings) {
  const old = store.get().settings;
  store.set({ settings });
  await call("saveSettings", { settings });
  if (old.preamble !== settings.preamble || old.preambleFile !== settings.preambleFile || old.documentClass !== settings.documentClass) clearLabelCache();
}

// ---------------------------------------------------------------- more commands

export function canvasSize() {
  const el = document.querySelector(".canvas-wrap") as HTMLElement | null;
  return { w: el?.clientWidth ?? 800, h: el?.clientHeight ?? 600 };
}

async function toClipboard(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    store.flash(`Copied ${what}`);
  } catch {
    store.flash("Couldn't use the clipboard");
  }
}

/** \tikzfig{name} for the current file (graphics/name.tikz -> name). */
export function copyTikzfigCommand() {
  const p = store.get().filePath;
  if (!p) return store.flash("Save the figure first");
  const name = p.split(/[\\/]/).pop()!.replace(/\.tikz$/, "");
  void toClipboard(`\\tikzfig{${name}}`, `\\tikzfig{${name}}`);
}

export function copyTikz() {
  void toClipboard(sceneToTikz(store.get().scene), "the TikZ code");
}

/** Bring the selection to the front (drawn last) or send it to the back. */
export function reorder(where: "front" | "back") {
  const s = store.get();
  const sel = new Set(s.selection);
  if (sel.size === 0) return;
  const a = s.scene.objects.filter((o) => sel.has(o.id));
  const b = s.scene.objects.filter((o) => !sel.has(o.id));
  store.commit({ ...s.scene, objects: where === "front" ? [...b, ...a] : [...a, ...b] });
}

const objBox = (o: Obj): Box | null => (o.type === "label" ? labelBox(o) : geomBox(o));

/** Align the selected objects' boxes to the selection's box. */
export function align(how: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") {
  const sel = store.selected();
  const all = selectionBox();
  if (sel.length < 2 || !all) return store.flash("Select two or more objects to align");
  const moved = sel.map((o) => {
    const b = objBox(o);
    if (!b) return o;
    let dx = 0;
    let dy = 0;
    if (how === "left") dx = all.minX - b.minX;
    if (how === "right") dx = all.maxX - b.maxX;
    if (how === "hcenter") dx = (all.minX + all.maxX) / 2 - (b.minX + b.maxX) / 2;
    if (how === "bottom") dy = all.minY - b.minY;
    if (how === "top") dy = all.maxY - b.maxY;
    if (how === "vcenter") dy = (all.minY + all.maxY) / 2 - (b.minY + b.maxY) / 2;
    return transformObj(o, translation(dx, dy));
  });
  store.commit(store.withReplaced(moved));
}

/** "-" / ".": dashed or dotted, pressed again: solid. */
export function toggleDash(d: Dash) {
  const sel = store.selected();
  const cur = (sel[0] ?? null)?.style.dash ?? store.get().style.dash;
  applyStyle({ dash: cur === d ? "solid" : d });
}

export async function toggleGridSnap() {
  const st = store.get().settings;
  await saveSettings({ ...st, snapToGrid: !st.snapToGrid });
  store.flash(st.snapToGrid ? "Grid snapping off" : "Grid snapping on");
}

/** Label the selection: a new label placed next to it, clear of other lines,
 *  opened for typing. Several objects get one label, a size larger. */
export function smartLabel() {
  const s = store.get();
  const targets = store.selected().filter((o) => o.type !== "label");
  if (targets.length === 0) return store.flash("Select something to label");
  const font = targets.length > 1 ? "\\large" : "";
  const others = s.scene.objects;
  const est = { w: 0.45, h: 0.4 };
  const { p, anchor } = placeLabel(targets, others, est, labelBox);
  const o: LabelObj = {
    id: newId(),
    type: "label",
    style: { ...s.style, fill: null, stroke: s.style.stroke ?? "black" },
    p,
    text: "",
    textMode: false,
    anchor,
    font: font as LabelObj["font"],
    attach: targets.map((t) => t.id),
  };
  setTool("select");
  store.commit({ ...s.scene, objects: [...s.scene.objects, o] }, { selection: [o.id], editingLabel: o.id });
}
