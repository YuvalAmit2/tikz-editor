// App state: a tiny observable store plus undo/redo history of scenes.
import { useSyncExternalStore } from "react";
import type { Box } from "./model/geometry";
import { DEFAULT_SETTINGS, type Settings } from "./model/settings";
import type { SnapResult } from "./model/snap";
import { DEFAULT_STYLE, emptyScene, type Obj, type Scene, type Style } from "./model/types";

export type ToolName = "select" | "line" | "polyline" | "rect" | "circle" | "ellipse" | "point" | "text";

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
  filePath: string | null;
  dirty: boolean;
  snap: SnapResult | null;
  /** Objects drawn by the active tool but not yet placed. */
  preview: Obj[];
  marquee: Box | null;
  cursor: { x: number; y: number } | null;
  message: string | null;
  showSettings: boolean;
}

type Listener = () => void;

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
    filePath: null,
    dirty: false,
    snap: null,
    preview: [],
    marquee: null,
    cursor: null,
    message: null,
    showSettings: false,
  };
  private listeners = new Set<Listener>();
  private undoStack: Scene[] = [];
  private redoStack: Scene[] = [];

  get = () => this.state;

  set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /** Replace the scene and record the previous one for undo. `before`
   *  overrides the recorded state (used when a drag previewed changes
   *  without recording them). */
  commit(scene: Scene, extra: Partial<AppState> = {}, before?: Scene) {
    this.undoStack.push(before ?? this.state.scene);
    if (this.undoStack.length > 500) this.undoStack.shift();
    this.redoStack = [];
    this.set({ scene, dirty: true, ...extra });
  }

  /** Change the scene without recording history (live previews). */
  preview(scene: Scene) {
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
