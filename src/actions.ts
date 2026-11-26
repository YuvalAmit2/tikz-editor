// Commands used by the keyboard, toolbar and panels.
import { call, isElectron } from "./api/client";
import { clearLabelCache } from "./labels/render";
import { scalingAbout, rotationAbout, transformObj, translation, unionBox, geomBox, sceneGeomBox, type Box } from "./model/geometry";
import type { Settings } from "./model/settings";
import { emptyScene, newId, type Anchor, type Dash, type LabelObj, type Obj, type Style } from "./model/types";
import { placeLabel, spotAt } from "./model/labelPlace";
import { componentAt, components, componentStyles, withPartStyle } from "./model/parts";
import { sceneToPicture, sceneToTikz, tikzToScene } from "./tikz/export";
import { cancelDraft, lastPick, selectionBox } from "./tools/controller";
import { askChoice, askText, store, TRUE_ZOOM, type ToolName } from "./store";
import { labelBox, labelInkSize, nodePointForInk } from "./labels/render";
import { followRef } from "./smartLabels";
import { freshCopies, nextNumbered } from "./model/copies";
import { withAttached } from "./model/attach";
import { cross, crossable, showsHeight } from "./model/height";

export function setTool(tool: ToolName) {
  cancelDraft();
  store.set({ tool, pointEdit: null, editingLabel: tool === "select" ? store.get().editingLabel : null });
}

/** Change style: applies to the selection and to new objects. */
export function applyStyle(patch: Partial<Style>, extra: Partial<Obj> = {}) {
  const s = store.get();
  const sel = store.selected();
  // Pieces picked in the panel: only their stroke changes.
  const ps = activePieces();
  if (ps) {
    const o = sel[0];
    const { parts, cuts } = withPartStyle(o, s.scene.objects, ps, patch);
    store.commit(store.withReplaced([{ ...o, parts, cuts } as Obj]));
    return;
  }
  // Labels have no fill; their colour shouldn't turn the next shape's fill off.
  const forNew = sel.length > 0 && sel.every((o) => o.type === "label") ? { stroke: patch.stroke ?? s.style.stroke } : patch;
  // Line patterns are one choice: a dash takes the wave off (not a brace's).
  if (patch.dash && !("wave" in patch)) patch = { ...patch, wave: undefined };
  const forStyle = { ...(sel.length ? forNew : patch) };
  if (forStyle.wave === "brace") delete forStyle.wave;
  store.set({ style: { ...s.style, ...forStyle } });
  if (sel.length === 0) return;
  const changed = sel.map((o) => {
    const p = o.style.wave === "brace" && "wave" in patch ? (({ wave: _, ...r }) => r)(patch) : patch;
    return { ...o, ...extra, style: { ...o.style, ...p } } as Obj;
  });
  store.commit(store.withReplaced(changed));
}

/** The pieces picked in the panel, when they belong to the one selected object. */
export function activePieces(): number[] | null {
  const s = store.get();
  const p = s.pieceSel;
  return p && p.ats.length && s.selection.length === 1 && s.selection[0] === p.id ? p.ats : null;
}

/** Change non-style properties (label anchor, font, text mode, point size). */
export function applyProps(patch: Partial<Obj>, filter: (o: Obj) => boolean) {
  const sel = store.selected().filter(filter);
  if (sel.length === 0) return;
  store.commit(store.withReplaced(sel.map((o) => ({ ...o, ...patch }) as Obj)));
}

/** The objects plus the labels that label them (⇧T labels go with their
 *  object: deleted, copied and duplicated with it). */
export function withTheirLabels(ids: string[], objects: Obj[] = store.get().scene.objects): string[] {
  const set = new Set(ids);
  const extra = objects.filter((o) => {
    if (o.type !== "label" || set.has(o.id)) return false;
    const of = o.follow && !o.follow.off ? o.follow.ids : o.attach;
    return !!of?.length && of.every((i) => set.has(i));
  });
  return extra.length ? [...ids, ...extra.map((o) => o.id)] : ids;
}

export function deleteSelection() {
  const s = store.get();
  if (s.selection.length === 0) return;
  const sel = new Set(withTheirLabels(s.selection));
  store.commit({ ...s.scene, objects: s.scene.objects.filter((o) => !sel.has(o.id)) }, { selection: [], editingLabel: null, pointEdit: null });
}

export function selectAll() {
  store.set({ selection: store.get().scene.objects.map((o) => o.id), tool: "select" });
}

let clipboard: Obj[] = [];
export function copy() {
  clipboard = selectedWithLabels();
}

/** The selection with its objects' labels, in scene order. */
function selectedWithLabels(): Obj[] {
  const ids = new Set(withTheirLabels(store.get().selection));
  return store.get().scene.objects.filter((o) => ids.has(o.id));
}

/** About 20 screen px, in whole grid steps (or halves of one when zoomed in). */
function pasteOffset(): number {
  const { settings, view } = store.get();
  const g = settings.gridSize;
  return Math.min(2 * g, g * Math.pow(2, Math.round(Math.log2(20 / (g * view.zoom)))));
}

function pasteObjs(objs: Obj[], offset: number, count = false): Obj[] {
  if (objs.length === 0) return [];
  const s = store.get();
  let m = translation(offset, -offset);
  // Off screen (e.g. zoomed in elsewhere): put it in the middle of the view.
  let b: Box | null = null;
  for (const o of objs) b = unionBox(b, objBox(transformObj(o, m)));
  if (b) {
    const { w, h } = canvasSize();
    const v = s.view;
    const view = { minX: v.cx - w / 2 / v.zoom, maxX: v.cx + w / 2 / v.zoom, minY: v.cy - h / 2 / v.zoom, maxY: v.cy + h / 2 / v.zoom };
    const seen = b.maxX > view.minX && b.minX < view.maxX && b.maxY > view.minY && b.minY < view.maxY;
    if (!seen) m = translation(v.cx - (b.minX + b.maxX) / 2 + offset, v.cy - (b.minY + b.maxY) / 2 - offset);
  }
  return addCopies(objs, m, count);
}

function addCopies(objs: Obj[], m: ReturnType<typeof translation>, count = false): Obj[] {
  const s = store.get();
  // ⌘D counts labels up: a_1 → a_2.
  const copies = freshCopies(objs, m).map((o) => (count && o.type === "label" ? { ...o, text: nextNumbered(o.text) } : o));
  store.commit({ ...s.scene, objects: [...s.scene.objects, ...copies] }, { selection: copies.map((o) => o.id), tool: "select" });
  return copies;
}

/** ⌘V: centred on the mouse (moved by whole grid steps, so what was on the
 *  grid stays on it); with the mouse off the drawing, just beside the original. */
export function paste() {
  const { cursor, settings } = store.get();
  const shapes = clipboard.filter((o) => o.type !== "label");
  const b = boxOfAll(shapes.length ? shapes : clipboard);
  if (cursor && b) {
    const g = settings.gridSize > 0 ? settings.gridSize : 0.25;
    const step = (v: number) => Math.round(v / g) * g;
    addCopies(clipboard, translation(step(cursor.x - (b.minX + b.maxX) / 2), step(cursor.y - (b.minY + b.maxY) / 2)));
    return;
  }
  pasteObjs(clipboard, pasteOffset());
}

/** The last duplicate: what was copied and the copies. */
let lastDup: { src: string[]; copies: string[] } | null = null;

/** ⌘D. Duplicating the copy you just made (after moving it) repeats that
 *  move: ⌘D, drag the copy into place, then ⌘D ⌘D … gives evenly spaced copies. */
export function duplicate() {
  const sel = selectedWithLabels();
  if (!sel.length) return;
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  if (lastDup && same(sel.map((o) => o.id), lastDup.copies)) {
    const src = lastDup.src.map((id) => store.objById(id)).filter((o): o is Obj => !!o);
    const bs = boxOfAll(src);
    const bc = boxOfAll(sel);
    if (src.length === lastDup.src.length && bs && bc) {
      const dx = (bc.minX + bc.maxX - bs.minX - bs.maxX) / 2;
      const dy = (bc.minY + bc.maxY - bs.minY - bs.maxY) / 2;
      if (Math.hypot(dx, dy) > 1e-9) {
        const copies = addCopies(sel, translation(dx, dy), true);
        lastDup = { src: sel.map((o) => o.id), copies: copies.map((o) => o.id) };
        return;
      }
    }
  }
  const copies = pasteObjs(sel, pasteOffset(), true);
  lastDup = { src: sel.map((o) => o.id), copies: copies.map((o) => o.id) };
}

function boxOfAll(objs: Obj[]): Box | null {
  let b: Box | null = null;
  for (const o of objs) b = unionBox(b, objBox(o));
  return b;
}

function transformSelection(make: (b: Box) => ReturnType<typeof scalingAbout>) {
  const sel = store.selected();
  const b = selectionBox();
  if (!b || sel.length === 0) return;
  const m = make(b);
  store.commit(store.withReplaced(withAttached(sel, sel.map((o) => transformObj(o, m)), store.get().scene.objects)));
}

const centre = (b: Box) => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
export const flipH = () => transformSelection((b) => scalingAbout(centre(b), -1, 1));
export const flipV = () => transformSelection((b) => scalingAbout(centre(b), 1, -1));
export const rotate90 = (dir: 1 | -1) => transformSelection((b) => rotationAbout(centre(b), 90 * dir));

export function nudge(dx: number, dy: number) {
  const sel = store.selected();
  if (sel.length === 0) return;
  const m = translation(dx, dy);
  store.commit(store.withReplaced(withAttached(sel, sel.map((o) => transformObj(o, m)), store.get().scene.objects)));
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

/** A figure sent from outside (VS Code / the command line): in its own tab. */
export async function openFromOutside(path: string) {
  await openInTab(path);
}

// ---------------------------------------------------------------- tabs

const emptyDoc = () => ({ scene: emptyScene(), filePath: null, dirty: false, view: { cx: 0, cy: 0, zoom: TRUE_ZOOM * 1.5 }, selection: [], guideCx: 0 });

/** The current tab holds nothing yet (a new figure can go in it). */
const blankTab = () => {
  const s = store.get();
  return !s.filePath && !s.dirty && s.scene.objects.length === 0;
};

/** ⌘T: a new tab with an empty figure. */
export function newTab() {
  cancelDraft();
  store.addTab(emptyDoc());
}

export function switchTab(id: string) {
  cancelDraft();
  store.switchTab(id);
}

/** The next tab to the right (or left), round the end. */
export function nextTab(dir: 1 | -1) {
  const { tabs, activeTab } = store.get();
  switchTab(tabs[(tabs.indexOf(activeTab) + dir + tabs.length) % tabs.length]);
}

/** Open a file in a tab: its own tab if it's open already, else this one
 *  when it's blank, else a new one. */
export async function openInTab(path: string) {
  const s = store.get();
  const open = s.tabs.find((t) => store.doc(t)?.filePath === path);
  if (open) return switchTab(open);
  if (!blankTab()) newTab();
  await openPath(path);
}

const tabName = (d: { filePath: string | null }) => (d.filePath ? d.filePath.split(/[\\/]/).pop()! : "Untitled");

/** ⌘W: close a tab, asking to save it first if it has changes. False:
 *  cancelled. */
export async function closeTab(id = store.get().activeTab): Promise<boolean> {
  const d = store.doc(id);
  if (!d) return true;
  if (d.dirty) {
    switchTab(id);
    const a = await askChoice(`Save changes to ${tabName(d)}?`, "Your changes will be lost if you don't save them.", [
      { label: "Don't save", value: "discard" },
      { label: "Cancel", value: "cancel" },
      { label: "Save", value: "save", primary: true },
    ]);
    if (a === "save") {
      await save();
      if (store.get().dirty) return false; // not saved (cancelled or failed)
    } else if (a !== "discard") return false;
  }
  cancelDraft();
  store.removeTab(id, emptyDoc);
  return true;
}

/** Closing the window: each tab with changes asks first. */
export async function closeWindow() {
  for (const id of [...store.get().tabs]) if (store.doc(id)?.dirty && !(await closeTab(id))) return;
  (window.tikzApi as any)?.closeWindow?.();
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

/** ⌘O: open a figure (in a new tab unless this one is blank). */
export async function open() {
  const path = await askPath("open", store.get().filePath ?? "graphics/");
  if (path) await openInTab(path);
}

/** ⌘N: a new figure, in a new tab. */
export function newFigure() {
  if (blankTab()) return;
  newTab();
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

/** A tikzpicture you can paste into a document as it is. */
export function copyTikz() {
  void toClipboard(sceneToPicture(store.get().scene), "a tikzpicture (paste it into your document)");
}

/** What a .tikz file holds (for \\tikzfig; reopens in the editor). */
export function copyTikzFile() {
  void toClipboard(sceneToTikz(store.get().scene), "the .tikz file contents");
}

/** Bring the selection to the front (drawn last) or send it to the back,
 *  or one step forward / backward. */
export function reorder(where: "front" | "back" | "forward" | "backward") {
  const s = store.get();
  const sel = new Set(s.selection);
  if (sel.size === 0) return;
  const a = s.scene.objects.filter((o) => sel.has(o.id));
  const b = s.scene.objects.filter((o) => !sel.has(o.id));
  if (where === "front" || where === "back") return store.commit({ ...s.scene, objects: where === "front" ? [...b, ...a] : [...a, ...b] });
  // One step: past the next object (that isn't selected) above / below.
  const objs = [...s.scene.objects];
  const idx = objs.map((o, i) => (sel.has(o.id) ? i : -1)).filter((i) => i >= 0);
  const order = where === "forward" ? [...idx].reverse() : idx;
  for (const i of order) {
    const j = where === "forward" ? i + 1 : i - 1;
    if (j < 0 || j >= objs.length || sel.has(objs[j].id)) continue;
    [objs[i], objs[j]] = [objs[j], objs[i]];
  }
  store.commit({ ...s.scene, objects: objs });
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
  let cur = (sel[0] ?? null)?.style.dash ?? store.get().style.dash;
  const ps = activePieces();
  if (ps) {
    // The first picked piece's dash
    const { chain, comps } = components(sel[0], store.get().scene.objects);
    if (chain) cur = componentStyles(sel[0], comps, chain.pieces.length)[componentAt(comps, ps[0], chain.pieces.length)]?.dash ?? cur;
  }
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
  const est = { w: 0.3, h: 0.3 }; // the text's box; placed again once compiled
  // Near where the object was clicked (e.g. the edge of a square).
  const near = targets.length === 1 && lastPick?.id === targets[0].id ? lastPick.p : undefined;
  const { p, anchor } = placeLabel(targets, others, est, labelBox, [], near);
  const ref = followRef(targets)!;
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
    follow: { ids: targets.map((t) => t.id), ref, avoid: true, home: { x: (near ?? p).x - ref.x, y: (near ?? p).y - ref.y } },
  };
  setTool("select");
  store.commit({ ...s.scene, objects: [...s.scene.objects, o] }, { selection: [o.id], editingLabel: o.id });
}

/** The selected label's place: a side or corner of what it labels (the 3×3
 *  grid; "center" on top of it), or null to let it find the best spot again. */
export function setLabelPosition(at: Anchor | null) {
  const s = store.get();
  const out: LabelObj[] = [];
  for (const o of store.selected()) {
    if (o.type !== "label" || !o.follow) continue;
    const targets = s.scene.objects.filter((x) => o.follow!.ids.includes(x.id));
    const ref = followRef(targets);
    const size = labelInkSize(o);
    if (!ref || !targets.length) continue;
    const { p, anchor } = at ? spotAt(targets, at) : placeLabel(targets, s.scene.objects, size ?? { w: 0.3, h: 0.3 }, labelBox, [o.id]);
    const q = size ? nodePointForInk(o, p, anchor) : p;
    const follow = { ...o.follow, ref, off: undefined, custom: undefined, at: at ?? undefined, home: { x: p.x - ref.x, y: p.y - ref.y } };
    out.push({ ...o, p: q, anchor, follow });
  }
  if (!out.length) return store.flash("Select a label made with Label (⇧T)");
  store.commit(store.withReplaced(out));
}

/** Hide the selection (left out of the TikZ, faint here), or show it again. */
export function toggleHidden() {
  const sel = store.selected();
  if (!sel.length) return store.flash("Select something to hide");
  const hide = !sel.every((o) => o.hidden);
  store.commit(store.withReplaced(sel.map((o) => ({ ...o, hidden: hide || undefined }) as Obj)));
  store.flash(hide ? (sel.length === 1 && sel[0].type === "curve" && sel[0].text ? "Line hidden (the text stays)" : "Hidden: not in the TikZ") : "Shown again");
}

/** ⌘G: the selection becomes one group (selected and moved together). */
export function groupSelection() {
  const sel = store.selected();
  if (sel.length < 2) return store.flash("Select two or more objects to group");
  const g = newId();
  store.commit(store.withReplaced(sel.map((o) => ({ ...o, group: g }) as Obj)));
  store.flash("Grouped");
}

/** ⇧⌘G: take the selected groups apart. */
export function ungroupSelection() {
  const sel = store.selected().filter((o) => o.group);
  if (!sel.length) return store.flash("Nothing grouped is selected");
  store.commit(store.withReplaced(sel.map((o) => ({ ...o, group: undefined }) as Obj)));
  store.flash("Ungrouped");
}

export async function setSnapKind(k: keyof Settings["snapKinds"] | "grid", on: boolean) {
  const st = store.get().settings;
  if (k === "grid") return saveSettings({ ...st, snapToGrid: on });
  await saveSettings({ ...st, snapToObjects: on ? true : st.snapToObjects, snapKinds: { ...st.snapKinds, [k]: on } });
}

/** The pairs of selected lines that cross (for "Show height"). */
export function heightPairs(): [Obj, Obj][] {
  const sel = store.selected().filter(crossable);
  const out: [Obj, Obj][] = [];
  for (let i = 0; i < sel.length; i++) for (let j = i + 1; j < sel.length; j++) if (cross(sel[i], sel[j])) out.push([sel[i], sel[j]]);
  return out;
}

/** Right-click → Show height: where the selected lines cross, the one in
 *  front goes over the other (a gap in the one behind). Again: off. */
export function toggleHeight() {
  const pairs = heightPairs();
  if (!pairs.length) return store.flash("Select two lines that cross");
  const on = !pairs.every(([a, b]) => showsHeight(a, b));
  const cr = new Map<string, Set<string>>();
  const of = (o: Obj) => cr.get(o.id) ?? cr.set(o.id, new Set(o.cross ?? [])).get(o.id)!;
  for (const [a, b] of pairs) {
    if (on) {
      of(a).add(b.id);
      of(b).add(a.id);
    } else {
      of(a).delete(b.id);
      of(b).delete(a.id);
    }
  }
  const changed = store.get().scene.objects.filter((o) => cr.has(o.id)).map((o) => {
    const ids = [...cr.get(o.id)!];
    return { ...o, cross: ids.length ? ids : undefined } as Obj;
  });
  store.commit(store.withReplaced(changed));
  store.flash(on ? "The line in front goes over (⌘] / ⌘[ swap them)" : "Height not shown");
}
