// ⌘K: every command (and every library figure) by fuzzy search.
import { useEffect, useMemo, useRef, useState } from "react";
import * as A from "../actions";
import { insertLibraryItem, libraryStore, reloadLibrary, saveSelectionToLibrary } from "../library";
import { store, useStore } from "../store";
import { TOOLS } from "./Toolbar";

interface Cmd {
  title: string;
  hint?: string;
  run: () => void;
}

function commands(): Cmd[] {
  const s = store.get();
  const toggle = (k: "showGrid" | "snapToGrid" | "snapToObjects" | "showTextWidthGuide" | "returnToSelect") => () => A.saveSettings({ ...store.get().settings, [k]: !store.get().settings[k] });
  const list: Cmd[] = [
    ...TOOLS.map((t) => ({ title: `Tool: ${t.label}`, hint: t.key, run: () => A.setTool(t.tool) })),
    { title: "Save", hint: "⌘S", run: () => A.save() },
    { title: "Save as…", hint: "⇧⌘S", run: () => A.save(true) },
    { title: "Open…", hint: "⌘O", run: () => A.open() },
    { title: "New figure", hint: "⌘N", run: A.newFigure },
    { title: "Copy \\tikzfig{…} for this figure", run: A.copyTikzfigCommand },
    { title: "Copy as tikzpicture (paste into a document)", run: A.copyTikz },
    { title: "Copy .tikz file contents (for \\tikzfig)", run: A.copyTikzFile },
    { title: "Undo", hint: "⌘Z", run: () => store.undo() },
    { title: "Redo", hint: "⇧⌘Z", run: () => store.redo() },
    { title: "Select all", hint: "⌘A", run: A.selectAll },
    { title: "Duplicate", hint: "⌘D", run: A.duplicate },
    { title: "Delete", hint: "⌫", run: A.deleteSelection },
    { title: "Flip horizontally", hint: "⇧H", run: A.flipH },
    { title: "Flip vertically", hint: "⇧V", run: A.flipV },
    { title: "Rotate 90°", hint: "⇧R", run: () => A.rotate90(1) },
    { title: "Bring to front", hint: "⌘]", run: () => A.reorder("front") },
    { title: "Send to back", hint: "⌘[", run: () => A.reorder("back") },
    { title: "Align left", run: () => A.align("left") },
    { title: "Align centres horizontally", run: () => A.align("hcenter") },
    { title: "Align right", run: () => A.align("right") },
    { title: "Align top", run: () => A.align("top") },
    { title: "Align centres vertically", run: () => A.align("vcenter") },
    { title: "Align bottom", run: () => A.align("bottom") },
    { title: "Zoom to fit", hint: "⇧1", run: () => A.zoomToFit(A.canvasSize()) },
    { title: "Zoom to true size", hint: "⌘0", run: A.zoomTrueSize },
    { title: `${s.settings.showGrid ? "Hide" : "Show"} grid`, run: toggle("showGrid") },
    { title: `${s.settings.snapToGrid ? "Don't snap" : "Snap"} to grid`, run: toggle("snapToGrid") },
    { title: `${s.settings.snapToObjects ? "Don't snap" : "Snap"} to objects`, run: toggle("snapToObjects") },
    { title: `${s.settings.showTextWidthGuide ? "Hide" : "Show"} text-width guide`, run: toggle("showTextWidthGuide") },
    { title: `After placing an object: ${s.settings.returnToSelect ? "keep the tool" : "return to Select"}`, run: toggle("returnToSelect") },
    { title: "Save selection to library…", run: saveSelectionToLibrary },
    { title: "Show library", run: () => store.set({ side: "library" }) },
    { title: "Settings", hint: "⌘,", run: () => store.set({ showSettings: true }) },
  ];
  for (const it of libraryStore.items()) list.push({ title: `Insert ${it.name}`, hint: "library", run: () => insertLibraryItem(it) });
  return list;
}

/** Subsequence match; higher is better, -1 = no match. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().replace(/\s+/g, "");
  const t = text.toLowerCase();
  if (!q) return 0;
  let ti = 0;
  let score = 0;
  let last = -2;
  for (const ch of q) {
    const i = t.indexOf(ch, ti);
    if (i < 0) return -1;
    score += i === last + 1 ? 3 : 1; // consecutive letters
    if (i === 0 || t[i - 1] === " " || t[i - 1] === ":") score += 2; // word starts
    last = i;
    ti = i + 1;
  }
  return score - t.length * 0.01;
}

export function CommandPalette() {
  const open = useStore((s) => s.palette);
  if (!open) return null;
  return <Palette />;
}

function Palette() {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const [all, setAll] = useState(commands);
  useEffect(() => {
    input.current?.focus();
    void reloadLibrary().then(() => setAll(commands()));
  }, []);
  const shown = useMemo(() => {
    if (!q.trim()) return all;
    return all
      .map((c) => ({ c, s: fuzzyScore(q, c.title) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  }, [q, all]);
  const close = () => store.set({ palette: false });
  const run = (c: Cmd | undefined) => {
    close();
    if (c) setTimeout(c.run, 0);
  };
  return (
    <div className="modal-back palette-back" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} data-testid="palette">
        <input
          ref={input}
          value={q}
          placeholder="Type a command or a library figure"
          spellCheck={false}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") return close();
            if (e.key === "ArrowDown") return e.preventDefault(), setSel((i) => Math.min(i + 1, shown.length - 1));
            if (e.key === "ArrowUp") return e.preventDefault(), setSel((i) => Math.max(i - 1, 0));
            if (e.key === "Enter") return e.preventDefault(), run(shown[sel]);
          }}
        />
        <div className="palette-list">
          {shown.slice(0, 50).map((c, i) => (
            <div key={c.title} className={"palette-item" + (i === sel ? " active" : "")} onMouseEnter={() => setSel(i)} onClick={() => run(c)}>
              <span>{c.title}</span>
              {c.hint && <span className="muted small">{c.hint}</span>}
            </div>
          ))}
          {shown.length === 0 && <div className="palette-item muted">No match</div>}
        </div>
      </div>
    </div>
  );
}
