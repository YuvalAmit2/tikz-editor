import { useEffect } from "react";
import {
  applyStyle,
  canvasSize,
  copy,
  reorder,
  deleteSelection,
  duplicate,
  flipH,
  flipV,
  newFigure,
  nudge,
  open,
  openFromOutside,
  openPath,
  saveAndHide,
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
import { DEFAULT_SNIPPET_FILE, withDefaults, type Settings } from "../model/settings";
import { loadSnippets } from "./snippets";
import { initSmartLabels } from "../smartLabels";
import { LINE_WIDTHS } from "../model/types";
import { cancelDraft, deleteActiveNode, finishCurve, finishPolyline, hasDraft, removeLastDraftPoint, setSpaceDown, spaceWasUsed } from "../tools/controller";
import { smartLabel, toggleDash, toggleGridSnap } from "../actions";
import { store, useStore } from "../store";
import { Canvas } from "./Canvas";
import { SettingsDialog } from "./SettingsDialog";
import { StylePanel } from "./StylePanel";
import { LibraryPanel } from "./LibraryPanel";
import { CommandPalette } from "./CommandPalette";
import { Prompt } from "./Prompt";
import { TextPanel } from "./TextPanel";
import { TOOLS, Toolbar, toolKey } from "./Toolbar";


function isTyping(e: KeyboardEvent) {
  if (store.get().prompt || store.get().palette) return true;
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  // Checkboxes and sliders keep focus after a click; they don't take typing.
  if (t.tagName === "INPUT") return !["checkbox", "radio", "range", "button"].includes((t as HTMLInputElement).type);
  return t.tagName === "TEXTAREA" || t.isContentEditable || !!t.closest(".monaco-editor");
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
    if (e.key === "Enter") return handled(), saveAndHide();
    if (k === "o") return handled(), open();
    if (k === "n") return handled(), newFigure();
    if (k === "a") return handled(), selectAll();
    if (k === "c") return handled(), copy();
    if (k === "v") return handled(), paste();
    if (k === "d") return handled(), duplicate();
    if (k === ",") return handled(), store.set({ showSettings: true });
    if (k === "k") return handled(), store.set({ palette: true });
    if (k === "]") return handled(), reorder("front");
    if (k === "[") return handled(), reorder("back");
    if (k === "=" || k === "+") return handled(), zoomAt(1.25);
    if (k === "-") return handled(), zoomAt(0.8);
    if (k === "0") return handled(), zoomTrueSize();
    return;
  }

  if (e.key === " ") {
    // Hold to pan; a tap switches to Select.
    if (!e.repeat) setSpaceDown(true);
    e.preventDefault();
    return;
  }
  if (e.key === "Escape") {
    if (hasDraft()) return cancelDraft();
    if (s.pointEdit) return store.set({ pointEdit: null, activeNode: null });
    if (s.tool !== "select") return setTool("select");
    return store.set({ selection: [], editingLabel: null });
  }
  if (e.key === "Enter") {
    if (s.tool === "polyline" && hasDraft()) return finishPolyline(false);
    if (s.tool === "curve" && hasDraft()) return finishCurve(false);
    const sel = store.selected();
    if (sel.length === 1 && sel[0].type === "label") {
      e.preventDefault();
      return store.set({ editingLabel: sel[0].id });
    }
    return;
  }
  if (e.key === "Backspace" || e.key === "Delete") {
    if ((s.tool === "polyline" || s.tool === "curve") && hasDraft()) return removeLastDraftPoint();
    if (deleteActiveNode()) return;
    return deleteSelection();
  }
  if (e.key.startsWith("Arrow")) {
    e.preventDefault();
    // ⇧ ×4, ⌥ fine (a fifth of a grid step)
    const step = s.settings.gridSize * (e.shiftKey ? 4 : 1) * (e.altKey ? 0.2 : 1);
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]!;
    return nudge(d[0], d[1]);
  }
  if (e.shiftKey) {
    if (k === "h") return flipH();
    if (k === "v") return flipV();
    if (k === "r") return rotate90(1);
    if (k === "t") {
      e.preventDefault(); // or the T lands in the label editor it opens
      return smartLabel();
    }
    if (e.key === "!") return zoomToFit(canvasSize());
    return;
  }
  // ⌥1-⌥9: style presets (e.code: ⌥ changes e.key on a Mac)
  if (e.altKey && /^Digit[1-9]$/.test(e.code)) {
    const p = s.settings.presets[parseInt(e.code.slice(5)) - 1];
    if (p) {
      e.preventDefault();
      applyStyle(p.style);
    }
    return;
  }
  if (e.key === "-") return toggleDash("dashed");
  if (e.key === ".") return toggleDash("dotted");
  if (k === "g") return toggleGridSnap();
  // 1-7: line thickness
  if (/^[1-7]$/.test(e.key)) return applyStyle({ width: LINE_WIDTHS[parseInt(e.key) - 1].pt });
  const t = TOOLS.find((t) => toolKey(t).toLowerCase() === k);
  if (t) return setTool(t.tool);
}

function onKeyUp(e: KeyboardEvent) {
  if (e.key !== " ") return;
  setSpaceDown(false);
  if (!spaceWasUsed() && !isTyping(e) && !store.get().showSettings) setTool("select");
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
    initSmartLabels();
    (async () => {
      store.set({ settings: withDefaults(await call<Settings>("getSettings")) });
      // Ready before the first label (read again whenever a label edit starts).
      void loadSnippets(store.get().settings.snippetFile || DEFAULT_SNIPPET_FILE);
      const f = await call<string | null>("startupFile");
      if (f) await openPath(f);
    })();
    (window.tikzApi as any)?.onOpenFile?.((p: string) => openFromOutside(p));
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
        <SidePanel />
      </div>
      <TextPanel />
      <SettingsDialog />
      <CommandPalette />
      <Prompt />
    </div>
  );
}

function SidePanel() {
  const side = useStore((s) => s.side);
  return (
    <aside className="panel">
      <div className="side-tabs">
        <button className={side === "style" ? "active" : ""} onClick={() => store.set({ side: "style" })}>
          Style
        </button>
        <button className={side === "library" ? "active" : ""} onClick={() => store.set({ side: "library" })} data-testid="tab-library">
          Library
        </button>
      </div>
      {side === "style" ? <StylePanel /> : <LibraryPanel />}
    </aside>
  );
}
