import { useEffect, useRef } from "react";
import { copyTikz, flipH, flipV, newFigure, open, rotate90, save, setSnapKind, setTool } from "../actions";
import { store, useStore, type ToolName } from "../store";

const I = ({ children }: { children: React.ReactNode }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const TOOLS: { tool: ToolName; key: string; label: string; icon: React.ReactNode }[] = [
  { tool: "select", key: "V", label: "Select", icon: <I><path d="M5 3l10 7-4.5 1L8 16z" fill="currentColor" stroke="none" /></I> },
  { tool: "line", key: "L", label: "Line", icon: <I><path d="M4 16L16 4" /></I> },
  { tool: "polyline", key: "P", label: "Polyline / polygon", icon: <I><path d="M3 15l4-9 5 6 5-8" /></I> },
  { tool: "curve", key: "B", label: "Curve through points", icon: <I><path d="M3 15C5 4 9 4 10 10s5 6 7-5" /><circle cx="3" cy="15" r="1.2" fill="currentColor" /><circle cx="10" cy="10" r="1.2" fill="currentColor" /><circle cx="17" cy="5" r="1.2" fill="currentColor" /></I> },
  { tool: "sketch", key: "S", label: "Sketch (smooths your stroke)", icon: <I><path d="M3 14c2-1 2-6 5-6s1 7 4 6 2-8 5-8" /></I> },
  { tool: "rect", key: "R", label: "Rectangle", icon: <I><rect x="3.5" y="5" width="13" height="10" /></I> },
  { tool: "ellipse", key: "E", label: "Ellipse (⇧ for a circle)", icon: <I><ellipse cx="10" cy="10" rx="7.5" ry="4.5" /></I> },
  { tool: "point", key: "D", label: "Point (dot)", icon: <I><circle cx="10" cy="10" r="2.5" fill="currentColor" /></I> },
  { tool: "text", key: "T", label: "Text / math label", icon: <I><path d="M5 5h10M10 5v11" /></I> },
  { tool: "fill", key: "F", label: "Paint bucket: click inside a closed region to fill it", icon: <I><path d="M4 9l6-6 6 6-6 6z" /><path d="M16 12c1 1.5 1.5 2.5 1.5 3.2a1.5 1.5 0 01-3 0c0-.7.5-1.7 1.5-3.2z" fill="currentColor" stroke="none" /></I> },
  { tool: "trim", key: "X", label: "Trim: click a piece, or drag across pieces, to cut it away at the crossings", icon: <I><circle cx="6" cy="14" r="2.3" /><circle cx="14" cy="14" r="2.3" /><path d="M7.5 12.3L15 3M12.5 12.3L5 3" /></I> },
];

/** A toolbar button with its shortcut written under it. */
function Btn({ k: key, title, active, disabled, onClick, children, testid }: { k?: string; title: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode; testid?: string }) {
  const show = useStore((s) => s.settings.showKeys && s.settings.showToolbarKeys);
  const k = show ? key : undefined;
  return (
    <button className={"tool" + (active ? " active" : "")} title={title} disabled={disabled} onClick={onClick} data-testid={testid}>
      {children}
      {k && <span className={"key" + (k === "␣" ? " space" : "")}>{k}</span>}
    </button>
  );
}

/** The key for a tool: settings.toolKeys can change the defaults. */
export function toolKey(t: { tool: ToolName; key: string }): string {
  return store.get().settings.toolKeys?.[t.tool] ?? t.key;
}

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const filePath = useStore((s) => s.filePath);
  const dirty = useStore((s) => s.dirty);
  const hasSel = useStore((s) => s.selection.length > 0);
  const name = filePath ? filePath.split(/[\\/]/).pop() : "Untitled";
  return (
    <div className="toolbar">
      <div className="group">
        {TOOLS.map((t, i) => (
          <span key={t.tool} className="tool-slot">
          {(i === 1 || t.tool === "rect" || t.tool === "text") && <span className="mini-sep" />}
          <Btn k={t.tool === "select" ? "␣" : toolKey(t)} active={tool === t.tool} title={`${t.label} (${t.tool === "select" ? "Space or " : ""}${toolKey(t)})`} testid={`tool-${t.tool}`} onClick={() => setTool(t.tool)}>
            {t.icon}
          </Btn>
          </span>
        ))}
      </div>
      <div className="sep" />
      <div className="group">
        <Btn k="⌘Z" title="Undo (⌘Z)" onClick={() => store.undo()}>
          <I><path d="M7 5L3.5 8.5 7 12" /><path d="M4 8.5h7a4.5 4.5 0 010 9H8" /></I>
        </Btn>
        <Btn k="⇧⌘Z" title="Redo (⇧⌘Z)" onClick={() => store.redo()}>
          <I><path d="M13 5l3.5 3.5L13 12" /><path d="M16 8.5H9a4.5 4.5 0 000 9h3" /></I>
        </Btn>
      </div>
      <div className="sep" />
      <div className="group">
        <Btn k="⇧H" disabled={!hasSel} title="Flip horizontally (⇧H)" onClick={flipH}>
          <I><path d="M10 3v14" strokeDasharray="2 2" /><path d="M8 6L3 14h5zM12 6l5 8h-5z" /></I>
        </Btn>
        <Btn k="⇧V" disabled={!hasSel} title="Flip vertically (⇧V)" onClick={flipV}>
          <I><path d="M3 10h14" strokeDasharray="2 2" /><path d="M6 8L14 3v5zM6 12l8 5v-5z" /></I>
        </Btn>
        <Btn k="⇧R" disabled={!hasSel} title="Rotate 90° counter-clockwise (⇧R)" onClick={() => rotate90(1)}>
          <I><path d="M15 9a5 5 0 10-1.5 4.5" /><path d="M15 4v5h-5" /></I>
        </Btn>
      </div>
      <div className="sep" />
      <div className="group">
        <SnapMenu />
      </div>
      <div className="spacer" />
      <div className="filename" title={filePath ?? "Not saved yet"}>
        {name}
        {dirty ? " •" : ""}
      </div>
      <div className="group">
        <button className="text-btn" title="New figure (⌘N)" onClick={newFigure}>New</button>
        <button className="text-btn" title="Open (⌘O)" onClick={open}>Open</button>
        <button className="text-btn primary" title="Save (⌘S)" onClick={() => save()}>Save</button>
        <button className="text-btn" title="Copy a tikzpicture to paste into your document" data-testid="copy-tikz" onClick={copyTikz}>Copy</button>
        <Btn k="⌘K" title="Commands (⌘K)" onClick={() => store.set({ palette: true })}>
          <span className="glyph">⌘</span>
        </Btn>
        <Btn k="⌘," title="Settings (⌘,)" testid="open-settings" onClick={() => store.set({ showSettings: true })}>
          <I>
            <path d="M8.6 2.5h2.8l.4 2.1 1.5.9 2-.8 1.4 2.4-1.6 1.4v1.8l1.6 1.4-1.4 2.4-2-.8-1.5.9-.4 2.1H8.6l-.4-2.1-1.5-.9-2 .8-1.4-2.4 1.6-1.4V9.1L3.3 7.7l1.4-2.4 2 .8 1.5-.9z" />
            <circle cx="10" cy="10" r="2.4" />
          </I>
        </Btn>
      </div>
    </div>
  );
}

const SNAP_ITEMS: { k: "grid" | "points" | "midpoints" | "centres" | "intersections" | "onObjects" | "guides"; label: string; hint?: string }[] = [
  { k: "grid", label: "Grid", hint: "G" },
  { k: "points", label: "Points and ends" },
  { k: "midpoints", label: "Midpoints" },
  { k: "centres", label: "Centres of circles" },
  { k: "intersections", label: "Crossings" },
  { k: "onObjects", label: "On lines and curves" },
  { k: "guides", label: "Smart guides", hint: "align, spacing, symmetry" },
];

/** The snapping button: a menu of what to snap to. */
function SnapMenu() {
  const open = useStore((s) => s.snapMenu);
  const st = useStore((s) => s.settings);
  const root = useRef<HTMLSpanElement>(null);
  const on = (k: (typeof SNAP_ITEMS)[number]["k"]) => (k === "grid" ? st.snapToGrid : st.snapToObjects && st.snapKinds[k]);
  const any = SNAP_ITEMS.some((i) => on(i.k));
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) store.set({ snapMenu: false });
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && store.set({ snapMenu: false });
    window.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);
  return (
    <span className="snap-slot" ref={root}>
      <Btn title="Snapping" active={any} testid="snap-menu" onClick={() => store.set({ snapMenu: !open })}>
        <I><path d="M5 4v6a5 5 0 0010 0V4" /><path d="M5 4h3v6a2 2 0 004 0V4h3" /><path d="M5 7h3M12 7h3" strokeWidth="1.2" /></I>
      </Btn>
      {open && (
        <div className="context-menu snap-menu" data-testid="snap-menu-list">
          <div className="menu-title">Snap to</div>
          {SNAP_ITEMS.map((i) => (
            <label key={i.k} className="check-item">
              <input type="checkbox" checked={on(i.k)} onChange={(e) => {
                  void setSnapKind(i.k, e.target.checked);
                  e.target.blur(); // keys go back to the canvas
                }} data-testid={"snap-" + i.k} />
              <span>{i.label}</span>
              {i.hint && <span className="pkey">{i.hint}</span>}
            </label>
          ))}
          <div className="menu-note">⌥ while dragging: no snapping</div>
        </div>
      )}
    </span>
  );
}
