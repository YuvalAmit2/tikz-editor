import { useEffect, useRef, useState } from "react";
import { useStore, type AppState } from "../store";

export function Prompt() {
  const p = useStore((s) => s.prompt);
  if (!p) return null;
  return <PromptDialog key={p.title + p.initial} p={p} />;
}

function PromptDialog({ p }: { p: NonNullable<AppState["prompt"]> }) {
  const [v, setV] = useState<string>(p.initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <div className="modal-back" onMouseDown={() => p.resolve(null)}>
      <form
        className="modal small"
        data-testid="prompt"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          p.resolve(v.trim() ? v.trim() : null);
        }}
      >
        <h3>{p.title}</h3>
        {p.label && <div className="muted small field-label">{p.label}</div>}
        <input
          ref={input}
          type="text"
          value={v}
          placeholder={p.placeholder}
          spellCheck={false}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              p.resolve(null);
            }
          }}
        />
        <div className="modal-buttons">
          <button type="button" className="text-btn" onClick={() => p.resolve(null)}>
            Cancel
          </button>
          <button type="submit" className="text-btn primary" disabled={!v.trim()}>
            {p.ok}
          </button>
        </div>
      </form>
    </div>
  );
}
