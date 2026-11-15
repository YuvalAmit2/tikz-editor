// Right-click menu for the selection.
import { useEffect } from "react";
import { copy, deleteSelection, duplicate, flipH, flipV, groupSelection, reorder, smartLabel, toggleHidden, ungroupSelection } from "../actions";
import { saveSelectionToLibrary } from "../library";
import { store, useStore } from "../store";

export function ContextMenu() {
  const menu = useStore((s) => s.menu);
  const sel = useStore((s) => s.selection);
  useEffect(() => {
    if (!menu) return;
    const close = () => store.set({ menu: null });
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", close);
    };
  }, [menu]);
  if (!menu || sel.length === 0) return null;
  const item = (label: string, k: string, run: () => void, testid?: string) => (
    <button
      data-testid={testid}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => {
        store.set({ menu: null });
        run();
      }}
    >
      <span>{label}</span>
      <span className="pkey">{k}</span>
    </button>
  );
  const objs = store.selected();
  const labels = objs.every((o) => o.type === "label");
  const hidden = objs.every((o) => o.hidden);
  const textCurve = objs.length === 1 && objs[0].type === "curve" && !!objs[0].text;
  const grouped = objs.some((o) => o.group);
  return (
    <div className="context-menu" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 300) }} data-testid="context-menu" onContextMenu={(e) => e.preventDefault()}>
      {item("Bring to front", "⌘]", () => reorder("front"), "menu-front")}
      {item("Bring forward", "", () => reorder("forward"), "menu-forward")}
      {item("Send backward", "", () => reorder("backward"), "menu-backward")}
      {item("Send to back", "⌘[", () => reorder("back"), "menu-back")}
      <div className="sep" />
      {!labels && item("Add label", "⇧T", smartLabel)}
      {item(hidden ? (textCurve ? "Show the line" : "Show") : textCurve ? "Hide the line" : "Hide", "⇧⌘H", toggleHidden, "menu-hide")}
      {objs.length > 1 && item("Group", "⌘G", groupSelection, "menu-group")}
      {grouped && item("Ungroup", "⇧⌘G", ungroupSelection, "menu-ungroup")}
      {item("Copy", "⌘C", copy)}
      {item("Duplicate", "⌘D", duplicate)}
      {item("Flip horizontally", "⇧H", flipH)}
      {item("Flip vertically", "⇧V", flipV)}
      {item("Add to library", "", () => void saveSelectionToLibrary())}
      <div className="sep" />
      {item("Delete", "⌫", deleteSelection)}
    </div>
  );
}
