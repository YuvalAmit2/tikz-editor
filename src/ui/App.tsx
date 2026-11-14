import { useEffect } from "react";
import {
  applyStyle,
  copy,
  deleteSelection,
  duplicate,
  flipH,
  flipV,
  newFigure,
  nudge,
  open,
  openPath,
  paste,
  rotate90,
  save,
  selectAll,
  setTool,
  zoomAt,
  zoomToFit,
  zoomTrueSize,
} from "../actions";
import { call } from "../api/client";
import { withDefaults, type Settings } from "../model/settings";
import { LINE_WIDTHS } from "../model/types";
import { cancelDraft, finishPolyline, hasDraft, removeLastDraftPoint, setSpaceDown } from "../tools/controller";
import { store } from "../store";
import { Canvas } from "./Canvas";
import { SettingsDialog } from "./SettingsDialog";
import { StylePanel } from "./StylePanel";
import { TextPanel } from "./TextPanel";
import { TOOLS, Toolbar } from "./Toolbar";

function canvasSize() {
  const el = document.querySelector(".canvas-wrap") as HTMLElement | null;
  return { w: el?.clientWidth ?? 800, h: el?.clientHeight ?? 600 };
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || !!t.closest(".monaco-editor"));
}

function onKeyDown(e: KeyboardEvent) {
  if (isTyping(e) || store.get().showSettings) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  const s = store.get();

  if (mod) {
    const handled = () => e.preventDefault();
    if (k === "z" && e.shiftKey) return handled(), store.redo();
    if (k === "z") return handled(), store.undo();
    if (k === "y") return handled(), store.redo();
    if (k === "s") return handled(), save(e.shiftKey);
    if (k === "o") return handled(), open();
    if (k === "n") return handled(), newFigure();
    if (k === "a") return handled(), selectAll();
    if (k === "c") return handled(), copy();
    if (k === "v") return handled(), paste();
    if (k === "d") return handled(), duplicate();
    if (k === ",") return handled(), store.set({ showSettings: true });
    if (k === "=" || k === "+") return handled(), zoomAt(1.25);
    if (k === "-") return handled(), zoomAt(0.8);
    if (k === "0") return handled(), zoomTrueSize();
    return;
  }

  if (e.key === " ") {
    setSpaceDown(true);
    e.preventDefault();
    return;
  }
  if (e.key === "Escape") {
    if (hasDraft()) return cancelDraft();
    if (s.pointEdit) return store.set({ pointEdit: null });
    if (s.tool !== "select") return setTool("select");
    return store.set({ selection: [], editingLabel: null });
  }
  if (e.key === "Enter") {
    if (s.tool === "polyline" && hasDraft()) return finishPolyline(false);
    const sel = store.selected();
    if (sel.length === 1 && sel[0].type === "label") {
      e.preventDefault();
      return store.set({ editingLabel: sel[0].id });
    }
    return;
  }
  if (e.key === "Backspace" || e.key === "Delete") {
    if (s.tool === "polyline" && hasDraft()) return removeLastDraftPoint();
    return deleteSelection();
  }
  if (e.key.startsWith("Arrow")) {
    e.preventDefault();
    const step = s.settings.gridSize * (e.shiftKey ? 4 : 1);
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]!;
    return nudge(d[0], d[1]);
  }
  if (e.shiftKey) {
    if (k === "h") return flipH();
    if (k === "v") return flipV();
    if (k === "r") return rotate90(1);
    if (e.key === "!") return zoomToFit(canvasSize());
    return;
  }
  // 1-7: line thickness
  if (/^[1-7]$/.test(e.key)) return applyStyle({ width: LINE_WIDTHS[parseInt(e.key) - 1].pt });
  const t = TOOLS.find((t) => t.key.toLowerCase() === k);
  if (t) return setTool(t.tool);
}

function onKeyUp(e: KeyboardEvent) {
  if (e.key === " ") setSpaceDown(false);
}

export function App() {
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    // Buttons never take keyboard focus (so Enter/Space/letters keep working
    // as shortcuts after clicking one).
    const noButtonFocus = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest?.("button")) e.preventDefault();
    };
    window.addEventListener("mousedown", noButtonFocus);
    (async () => {
      store.set({ settings: withDefaults(await call<Settings>("getSettings")) });
      const f = await call<string | null>("startupFile");
      if (f) await openPath(f);
    })();
    (window.tikzApi as any)?.onOpenFile?.((p: string) => openPath(p));
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (store.get().dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", noButtonFocus);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);

  // Window title: file name + unsaved marker
  useEffect(() => {
    const unsub = store.subscribe(() => {
      const s = store.get();
      const name = s.filePath ? s.filePath.split(/[\\/]/).pop() : "Untitled";
      const t = `${s.dirty ? "• " : ""}${name} — TikZ Editor`;
      if (document.title !== t) document.title = t;
    });
    return () => {
      unsub();
    };
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="main">
        <Canvas />
        <StylePanel />
      </div>
      <TextPanel />
      <SettingsDialog />
    </div>
  );
}
