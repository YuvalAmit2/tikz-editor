// App state: a tiny observable store plus undo/redo history of scenes.
import { useSyncExternalStore } from "react";
import type { Box } from "./model/geometry";
import { DEFAULT_SETTINGS, type Settings } from "./model/settings";
import type { SnapResult } from "./model/snap";
import type { Guide } from "./model/guides";
import { DEFAULT_STYLE, emptyScene, newId, type Obj, type Scene, type Style } from "./model/types";

export type ToolName = "select" | "line" | "polyline" | "curve" | "sketch" | "rect" | "circle" | "ellipse" | "fill" | "point" | "text" | "trim";

export interface View {
  /** World point (cm) at the centre of the canvas. */
  cx: number;
  cy: number;
  /** Screen pixels per cm. */
  zoom: number;
}

/** CSS pixels per cm at 100% zoom (true size). */
export const TRUE_ZOOM = 96 / 2.54;

export interface AppState {
  scene: Scene;
  selection: string[];
  tool: ToolName;
  view: View;
  /** Style for new objects. */
  style: Style;
  settings: Settings;
  /** Label currently being edited in the text panel. */
  editingLabel: string | null;
  /** Object whose points are being edited (double-click). */
  pointEdit: string | null;
  /** In point editing: the anchor last clicked (Backspace deletes it). */
  activeNode: number | null;
  filePath: string | null;
  dirty: boolean;
  snap: SnapResult | null;
  /** Objects drawn by the active tool but not yet placed. */
  preview: Obj[];
  marquee: Box | null;
  cursor: { x: number; y: number } | null;
  message: string | null;
  showSettings: boolean;
  /** A text prompt (in-app: Electron has no window.prompt). */
  prompt: { title: string; label?: string; initial: string; placeholder?: string; ok: string; resolve: (v: string | null) => void } | null;
  /** Command palette (⌘K) open. */
  palette: boolean;
  /** What the right-hand panel shows. */
  side: "style" | "library";
  /** Show (and allow dragging) the anchors and handles of selected curves. */
  showControls: boolean;
  /** Centre of the text-width guide (fixed when a figure is opened). */
  guideCx: number;
  /** While editing points: where a double-click would add one. */
  insertHint: { x: number; y: number } | null;
  /** Mouse cursor while over a handle. */
  hoverCursor: string | null;
  /** Pieces of the selected object picked in the panel (style changes go to
   *  them only), by a point on each (chain parameter). */
  pieceSel: { id: string; ats: number[] } | null;
  /** The piece under the mouse in the panel (highlighted on the canvas). */
  pieceHover: { id: string; at: number } | null;
  /** Right-click menu, at a screen position. */
  menu: { x: number; y: number } | null;
  /** Smart guides shown while drawing or moving. */
  guides: Guide[];
  /** The snapping menu is open. */
  snapMenu: boolean;
  /** What the Line tool draws (its menu: a line or a curly brace). */
  lineKind: "line" | "brace";
  /** The Line tool's menu is open. */
  lineMenu: boolean;
  /** Open figures (tabs), in order; the active one is in the fields above. */
  tabs: string[];
  activeTab: string;
  /** A question with a few answers (in-app: e.g. "Save changes?"). */
  choice: { title: string; message?: string; buttons: { label: string; value: string; primary?: boolean }[]; resolve: (v: string | null) => void } | null;
}

/** A figure in a tab that isn't showing: what it keeps while another one is. */
export interface Doc {
  scene: Scene;
  filePath: string | null;
  dirty: boolean;
  view: View;
  selection: string[];
  guideCx: number;
  undo: Scene[];
  redo: Scene[];
}

type Listener = () => void;

/** What's cleared when another figure is shown. */
const TAB_RESET: Partial<AppState> = { editingLabel: null, pointEdit: null, activeNode: null, preview: [], marquee: null, snap: null, pieceSel: null, pieceHover: null, menu: null, guides: [], insertHint: null };

class Store {
  state: AppState = {
    scene: emptyScene(),
    selection: [],
    tool: "select",
    view: { cx: 0, cy: 0, zoom: TRUE_ZOOM * 1.5 },
    style: { ...DEFAULT_STYLE },
    settings: DEFAULT_SETTINGS,
    editingLabel: null,
    pointEdit: null,
    activeNode: null,
    filePath: null,
    dirty: false,
    snap: null,
    preview: [],
    marquee: null,
    cursor: null,
    message: null,
    showSettings: false,
    prompt: null,
    palette: false,
    side: "style",
    showControls: false,
    guideCx: 0,
    insertHint: null,
    hoverCursor: null,
    pieceSel: null,
    pieceHover: null,
    menu: null,
    guides: [],
    snapMenu: false,
    lineKind: "line",
    lineMenu: false,
    tabs: ["t0"],
    activeTab: "t0",
    choice: null,
  };
  private listeners = new Set<Listener>();
  private undoStack: Scene[] = [];
  private redoStack: Scene[] = [];

  get = () => this.state;

  set(patch: Partial<AppState>) {
    if (patch.selection && this.state.pieceSel && !(patch.selection.length === 1 && patch.selection[0] === this.state.pieceSel.id) && !("pieceSel" in patch)) patch = { ...patch, pieceSel: null };
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /** Applied to every new scene (labels that follow their objects). */
  sceneHook: ((s: Scene, prev: Scene | null, final: boolean) => Scene) | null = null;

  /** Replace the scene and record the previous one for undo. `before`
   *  overrides the recorded state (used when a drag previewed changes
   *  without recording them). */
  commit(scene: Scene, extra: Partial<AppState> = {}, before?: Scene) {
    const prev = before ?? this.state.scene;
    this.undoStack.push(prev);
    if (this.undoStack.length > 500) this.undoStack.shift();
    this.redoStack = [];
    if (this.sceneHook) scene = this.sceneHook(scene, prev, true);
    this.set({ scene, dirty: true, ...extra });
  }

  /** Change the scene without recording history (live previews). */
  preview(scene: Scene) {
    if (this.sceneHook) scene = this.sceneHook(scene, this.state.scene, false);
    this.set({ scene });
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.state.scene);
    this.set({ scene: prev, dirty: true, selection: this.state.selection.filter((id) => prev.objects.some((o) => o.id === id)), pointEdit: null, editingLabel: null });
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.state.scene);
    this.set({ scene: next, dirty: true, selection: this.state.selection.filter((id) => next.objects.some((o) => o.id === id)), pointEdit: null, editingLabel: null });
  }

  resetHistory() {
    this.undoStack = [];
    this.redoStack = [];
  }

  // ---- tabs ----
  /** The figures in the other tabs. */
  private docs = new Map<string, Doc>();

  /** A tab's figure (the active one from the current state). */
  doc(id: string): Doc | null {
    const s = this.state;
    if (id === s.activeTab) return { scene: s.scene, filePath: s.filePath, dirty: s.dirty, view: s.view, selection: s.selection, guideCx: s.guideCx, undo: this.undoStack, redo: this.redoStack };
    return this.docs.get(id) ?? null;
  }

  /** Show another tab's figure (the current one is put aside, undo and all). */
  switchTab(id: string) {
    const s = this.state;
    if (id === s.activeTab || !this.docs.has(id)) return;
    this.docs.set(s.activeTab, this.doc(s.activeTab)!);
    const d = this.docs.get(id)!;
    this.docs.delete(id);
    this.undoStack = d.undo;
    this.redoStack = d.redo;
    this.set({ activeTab: id, scene: d.scene, filePath: d.filePath, dirty: d.dirty, view: d.view, selection: d.selection, guideCx: d.guideCx, ...TAB_RESET });
  }

  /** A new tab after the current one, showing this figure. */
  addTab(d: Omit<Doc, "undo" | "redo">): string {
    const id = "t" + newId();
    const s = this.state;
    const i = s.tabs.indexOf(s.activeTab);
    this.docs.set(id, { ...d, undo: [], redo: [] });
    this.set({ tabs: [...s.tabs.slice(0, i + 1), id, ...s.tabs.slice(i + 1)] });
    this.switchTab(id);
    return id;
  }

  /** Close a tab (no questions asked); the last one becomes an empty figure. */
  removeTab(id: string, empty: () => Omit<Doc, "undo" | "redo">) {
    const s = this.state;
    if (s.tabs.length === 1) {
      const d = empty();
      this.resetHistory();
      this.set({ scene: d.scene, filePath: d.filePath, dirty: false, view: d.view, selection: [], guideCx: d.guideCx, ...TAB_RESET });
      return;
    }
    const i = s.tabs.indexOf(id);
    const tabs = s.tabs.filter((t) => t !== id);
    if (id === s.activeTab) this.switchTab(tabs[Math.min(i, tabs.length - 1)]);
    this.docs.delete(id);
    this.set({ tabs });
  }

  // ---- scene helpers ----
  objById(id: string): Obj | undefined {
    return this.state.scene.objects.find((o) => o.id === id);
  }

  selected(): Obj[] {
    const sel = new Set(this.state.selection);
    return this.state.scene.objects.filter((o) => sel.has(o.id));
  }

  /** Scene with the given objects replaced (by id). */
  withReplaced(objs: Obj[], scene = this.state.scene): Scene {
    const m = new Map(objs.map((o) => [o.id, o]));
    return { ...scene, objects: scene.objects.map((o) => m.get(o.id) ?? o) };
  }

  flash(message: string) {
    this.set({ message });
    const m = message;
    setTimeout(() => {
      if (this.state.message === m) this.set({ message: null });
    }, 3500);
  }
}

export const store = new Store();

export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => sel(store.get()));
}

/** Ask for a line of text in an in-app dialog. Resolves null on cancel. */
export function askText(title: string, opts: { initial?: string; placeholder?: string; ok?: string; label?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    store.set({
      prompt: {
        title,
        label: opts.label,
        initial: opts.initial ?? "",
        placeholder: opts.placeholder,
        ok: opts.ok ?? "OK",
        resolve: (v) => {
          store.set({ prompt: null });
          resolve(v);
        },
      },
    });
  });
}

/** The selection grown to whole groups (objects grouped with ⌘G go together). */
export function withGroups(ids: string[], objects: Obj[] = store.get().scene.objects): string[] {
  const groups = new Set(objects.filter((o) => o.group && ids.includes(o.id)).map((o) => o.group));
  if (!groups.size) return ids;
  return [...new Set([...ids, ...objects.filter((o) => o.group && groups.has(o.group)).map((o) => o.id)])];
}

/** Ask a question with a few answers. Resolves the value, or null (Escape). */
export function askChoice(title: string, message: string, buttons: { label: string; value: string; primary?: boolean }[]): Promise<string | null> {
  return new Promise((resolve) => {
    store.set({
      choice: {
        title,
        message,
        buttons,
        resolve: (v) => {
          store.set({ choice: null });
          resolve(v);
        },
      },
    });
  });
}
