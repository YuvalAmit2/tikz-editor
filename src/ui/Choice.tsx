// A question with a few answers (e.g. "Save changes?").
import { useEffect } from "react";
import { useStore } from "../store";

export function Choice() {
  const c = useStore((s) => s.choice);
  useEffect(() => {
    if (!c) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        c.resolve(null);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        c.resolve(c.buttons.find((b) => b.primary)?.value ?? null);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [c]);
  if (!c) return null;
  return (
    <div className="modal-back" onMouseDown={() => c.resolve(null)}>
      <div className="modal small" data-testid="choice" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{c.title}</h3>
        {c.message && <p className="muted small">{c.message}</p>}
        <div className="modal-buttons">
          {c.buttons.map((b) => (
            <button key={b.value} className={"text-btn" + (b.primary ? " primary" : "")} onClick={() => c.resolve(b.value)} data-testid={"choice-" + b.value}>
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
