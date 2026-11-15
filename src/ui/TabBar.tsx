// Tabs: one per open figure, at the top of the window.
import { closeTab, newTab, switchTab } from "../actions";
import { store, useStore } from "../store";

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.activeTab);
  // The active tab's name and changes (the others only change when shown).
  useStore((s) => s.filePath);
  useStore((s) => s.dirty);
  return (
    <div className="tabbar" data-testid="tabbar">
      {tabs.map((id) => {
        const d = store.doc(id);
        const name = d?.filePath ? d.filePath.split(/[\\/]/).pop()! : "Untitled";
        return (
          <div
            key={id}
            className={"tab" + (id === active ? " active" : "")}
            title={d?.filePath ?? "Not saved yet"}
            onMouseDown={(e) => {
              if (e.button === 0) switchTab(id);
            }}
            onAuxClick={(e) => {
              // Middle click closes, as in a browser.
              if (e.button === 1) void closeTab(id);
            }}
            data-testid="tab"
          >
            <span className="tab-name">{name}</span>
            <button
              className={"tab-close" + (d?.dirty ? " dirty" : "")}
              title={d?.dirty ? "Unsaved changes; close (⌘W)" : "Close (⌘W)"}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => void closeTab(id)}
              data-testid="tab-close"
            >
              <span className="dot">●</span>
              <span className="x">×</span>
            </button>
          </div>
        );
      })}
      <button className="tab-new" title="New tab (⌘T)" onClick={newTab} data-testid="tab-new">
        +
      </button>
    </div>
  );
}
