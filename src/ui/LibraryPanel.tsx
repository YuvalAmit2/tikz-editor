import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { deleteLibraryItem, insertLibraryItem, libraryStore, moveLibraryItem, reloadLibrary, renameLibraryItem, saveSelectionToLibrary, type LibraryItem } from "../library";
import { useStore } from "../store";
import { lastCanvasPoint } from "../tools/controller";

/** The key that inserts the k-th item (1–9, then 0), while the library is open. */
export const libraryKey = (k: number) => (k < 9 ? String(k + 1) : k === 9 ? "0" : null);

export function LibraryPanel() {
  useSyncExternalStore(libraryStore.subscribe, libraryStore.version);
  const hasSel = useStore((s) => s.selection.length > 0);
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState<{ item: LibraryItem; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ from: LibraryItem; to: number | null } | null>(null);
  useEffect(() => {
    void reloadLibrary();
  }, []);
  const all = libraryStore.items();
  const filter = q.trim().toLowerCase();
  const items = all.filter((i) => i.name.toLowerCase().includes(filter));
  return (
    <div className="library" data-testid="library">
      <div className="library-head">
        <input type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
        <button className="text-btn" disabled={!hasSel} title="Save the selection to the library" onClick={saveSelectionToLibrary} data-testid="library-add">
          + Add
        </button>
      </div>
      {all.length === 0 && <p className="muted small">Empty. Select something and click + Add.</p>}
      {all.length > 1 && !filter && <p className="muted small library-hint">Keys 1–9 and 0 insert the first ten at the mouse. Drag to reorder; right-click for more.</p>}
      <div className="library-grid">
        {items.map((it) => {
          const k = all.indexOf(it);
          const key = libraryKey(k);
          const dropClass = drag && drag.to !== null && drag.from !== it ? (drag.to === k ? " drop-before" : drag.to === k + 1 && k === all.length - 1 ? " drop-after" : "") : "";
          return (
            <div
              key={it.file ?? it.name}
              className={"library-item" + dropClass + (drag?.from === it ? " dragging" : "")}
              title={`Insert ${it.name}${key ? ` (key ${key})` : ""}; right-click to rename or insert smaller or larger`}
              tabIndex={0}
              draggable={!filter}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", it.name);
                setDrag({ from: it, to: null });
              }}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                const to = e.clientX < r.left + r.width / 2 ? k : k + 1;
                if (to !== drag.to) setDrag({ ...drag, to });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!drag || drag.to === null) return;
                const from = all.indexOf(drag.from);
                // Its place once it has been taken out of the list.
                const to = drag.to > from ? drag.to - 1 : drag.to;
                setDrag(null);
                if (to !== from) void moveLibraryItem(drag.from, to);
              }}
              onDragEnd={() => setDrag(null)}
              onClick={() => insertLibraryItem(it)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ item: it, x: e.clientX, y: e.clientY });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  insertLibraryItem(it, lastCanvasPoint());
                }
              }}
              data-testid="library-item"
            >
              <div className="thumb" dangerouslySetInnerHTML={{ __html: it.thumb }} />
              <div className="name">{it.name}</div>
              {key && <span className="lib-key">{key}</span>}
              <button
                className="remove"
                title="Delete from library"
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteLibraryItem(it);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      {menu && <ItemMenu {...menu} close={() => setMenu(null)} />}
    </div>
  );
}

/** Right-click on a library item. */
function ItemMenu({ item, x, y, close }: { item: LibraryItem; x: number; y: number; close: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", close);
    };
  }, []);
  const run = (f: () => void) => () => {
    close();
    f();
  };
  return (
    <div ref={root} className="context-menu" style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 220) }} data-testid="library-menu" onContextMenu={(e) => e.preventDefault()}>
      <div className="menu-title">{item.name}</div>
      <button onClick={run(() => insertLibraryItem(item, null, 0.5))} data-testid="lib-insert-small">
        <span>Insert small</span>
        <span className="pkey">½×</span>
      </button>
      <button onClick={run(() => insertLibraryItem(item))} data-testid="lib-insert">
        <span>Insert</span>
        <span className="pkey">1×</span>
      </button>
      <button onClick={run(() => insertLibraryItem(item, null, 2))} data-testid="lib-insert-large">
        <span>Insert large</span>
        <span className="pkey">2×</span>
      </button>
      <div className="sep" />
      <button onClick={run(() => void renameLibraryItem(item))} data-testid="lib-rename">
        <span>Rename…</span>
      </button>
      <button onClick={run(() => void deleteLibraryItem(item))} data-testid="lib-delete">
        <span>Delete</span>
      </button>
    </div>
  );
}
