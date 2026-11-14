import { useEffect, useState, useSyncExternalStore } from "react";
import { deleteLibraryItem, insertLibraryItem, libraryStore, reloadLibrary, saveSelectionToLibrary } from "../library";
import { useStore } from "../store";
import { lastCanvasPoint } from "../tools/controller";

export function LibraryPanel() {
  useSyncExternalStore(libraryStore.subscribe, libraryStore.version);
  const hasSel = useStore((s) => s.selection.length > 0);
  const [q, setQ] = useState("");
  useEffect(() => {
    void reloadLibrary();
  }, []);
  const items = libraryStore.items().filter((i) => i.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="library" data-testid="library">
      <div className="library-head">
        <input type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
        <button className="text-btn" disabled={!hasSel} title="Save the selection to the library" onClick={saveSelectionToLibrary} data-testid="library-add">
          + Add
        </button>
      </div>
      {libraryStore.items().length === 0 && <p className="muted small">Empty. Select something and click + Add.</p>}
      <div className="library-grid">
        {items.map((it) => (
          <div
            key={it.file ?? it.name}
            className="library-item"
            title={`Insert ${it.name} (↵ puts it at the mouse)`}
            tabIndex={0}
            onClick={() => insertLibraryItem(it)}
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
        ))}
      </div>
    </div>
  );
}
