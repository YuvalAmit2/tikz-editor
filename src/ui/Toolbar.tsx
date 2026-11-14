import { flipH, flipV, newFigure, open, rotate90, save, setTool } from "../actions";
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
  { tool: "circle", key: "C", label: "Circle", icon: <I><circle cx="10" cy="10" r="6.5" /></I> },
  { tool: "ellipse", key: "E", label: "Ellipse", icon: <I><ellipse cx="10" cy="10" rx="7.5" ry="4.5" /></I> },
  { tool: "point", key: "D", label: "Point (dot)", icon: <I><circle cx="10" cy="10" r="2.5" fill="currentColor" /></I> },
  { tool: "text", key: "T", label: "Text / math label", icon: <I><path d="M5 5h10M10 5v11" /></I> },
];

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
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            className={"tool" + (tool === t.tool ? " active" : "")}
            title={`${t.label} (${toolKey(t)})`}
            data-testid={`tool-${t.tool}`}
            onClick={() => setTool(t.tool)}
          >
            {t.icon}
          </button>
        ))}
      </div>
      <div className="sep" />
      <div className="group">
        <button className="tool" title="Undo (⌘Z)" onClick={() => store.undo()}>
          <I><path d="M7 5L3.5 8.5 7 12" /><path d="M4 8.5h7a4.5 4.5 0 010 9H8" /></I>
        </button>
        <button className="tool" title="Redo (⇧⌘Z)" onClick={() => store.redo()}>
          <I><path d="M13 5l3.5 3.5L13 12" /><path d="M16 8.5H9a4.5 4.5 0 000 9h3" /></I>
        </button>
      </div>
      <div className="sep" />
      <div className="group">
        <button className="tool" disabled={!hasSel} title="Flip horizontally (⇧H)" onClick={flipH}>
          <I><path d="M10 3v14" strokeDasharray="2 2" /><path d="M8 6L3 14h5zM12 6l5 8h-5z" /></I>
        </button>
        <button className="tool" disabled={!hasSel} title="Flip vertically (⇧V)" onClick={flipV}>
          <I><path d="M3 10h14" strokeDasharray="2 2" /><path d="M6 8L14 3v5zM6 12l8 5v-5z" /></I>
        </button>
        <button className="tool" disabled={!hasSel} title="Rotate 90° counter-clockwise (⇧R)" onClick={() => rotate90(1)}>
          <I><path d="M15 9a5 5 0 10-1.5 4.5" /><path d="M15 4v5h-5" /></I>
        </button>
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
        <button className="tool" title="Settings (⌘,)" data-testid="open-settings" onClick={() => store.set({ showSettings: true })}>
          <I><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></I>
        </button>
      </div>
    </div>
  );
}
