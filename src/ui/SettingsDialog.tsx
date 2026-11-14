import { useState } from "react";
import { saveSettings } from "../actions";
import type { Settings } from "../model/settings";
import { store, useStore } from "../store";

export function SettingsDialog() {
  const show = useStore((s) => s.showSettings);
  const settings = useStore((s) => s.settings);
  if (!show) return null;
  return <Dialog initial={settings} />;
}

function Dialog({ initial }: { initial: Settings }) {
  const [s, setS] = useState(initial);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const close = () => store.set({ showSettings: false });
  const bool = (k: keyof Settings, label: string, hint?: string) => (
    <label className="row check">
      <input type="checkbox" checked={s[k] as boolean} onChange={(e) => set(k, e.target.checked as never)} />
      <span>
        {label}
        {hint && <span className="muted small"> — {hint}</span>}
      </span>
    </label>
  );
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} data-testid="settings">
        <h3>Settings</h3>

        <h4>Tools</h4>
        {bool("returnToSelect", "Return to the Select tool after placing an object")}

        <h4>Grid and snapping</h4>
        <label className="row">
          <span>Grid spacing (cm)</span>
          <input type="number" step="0.05" min="0.05" value={s.gridSize} onChange={(e) => set("gridSize", Math.max(0.01, parseFloat(e.target.value) || 0.25))} />
        </label>
        {bool("showGrid", "Show grid")}
        {bool("snapToGrid", "Snap to grid")}
        {bool("snapToObjects", "Snap to objects", "vertices, midpoints, centres, intersections")}

        <h4>Labels</h4>
        {bool("enterCommitsLabel", "Enter finishes a label", "Shift+Enter for a new line")}
        <label className="row col">
          <span>Document class line</span>
          <input type="text" value={s.documentClass} onChange={(e) => set("documentClass", e.target.value)} spellCheck={false} />
        </label>
        <label className="row col">
          <span>Preamble</span>
          <textarea rows={4} value={s.preamble} onChange={(e) => set("preamble", e.target.value)} spellCheck={false} />
        </label>
        <label className="row col">
          <span>
            …or use the preamble of this .tex file <span className="muted small">(overrides the two fields above)</span>
          </span>
          <input type="text" placeholder="~/notes/main.tex" value={s.preambleFile} onChange={(e) => set("preambleFile", e.target.value)} spellCheck={false} />
        </label>

        <h4>Page</h4>
        <label className="row">
          <span>Text width of your documents (cm)</span>
          <input type="number" step="0.1" value={s.textWidthCm} onChange={(e) => set("textWidthCm", parseFloat(e.target.value) || 15)} />
        </label>
        {bool("showTextWidthGuide", "Show the text-width guide on the canvas")}

        <div className="modal-buttons">
          <button className="text-btn" onClick={close}>
            Cancel
          </button>
          <button
            className="text-btn primary"
            data-testid="settings-save"
            onClick={async () => {
              await saveSettings(s);
              close();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
