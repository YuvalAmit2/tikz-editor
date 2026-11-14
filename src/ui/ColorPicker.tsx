// A colour picker: saturation/brightness square, hue strip, hex field.
// Colours are written as xcolor expressions that need no extra packages:
// {rgb,255:red,R;green,G;blue,B} (a mix of red, green and blue).
import { useEffect, useRef, useState } from "react";
import { xcolorRgb } from "../model/xcolor";

export const rgbExpr = (r: number, g: number, b: number) => `{rgb,255:red,${r};green,${g};blue,${b}}`;

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)].map((x) => Math.round(x * 255)) as [number, number, number];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return [(h + 360) % 360, mx ? d / mx : 0, mx];
}

const hex = (rgb: number[]) => "#" + rgb.map((x) => x.toString(16).padStart(2, "0")).join("");

export function ColorPicker({ initial, onPick, onClose }: { initial: string | null; onPick: (expr: string) => void; onClose: () => void }) {
  const start = rgbToHsv(...xcolorRgb(initial ?? "blue"));
  const [hsv, setHsv] = useState<[number, number, number]>(start);
  const rgb = hsvToRgb(...hsv);
  const [text, setText] = useState(hex(rgb));
  const box = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => setText(hex(hsvToRgb(...hsv))), [hsv]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [onClose]);

  const dragOn = (el: React.RefObject<HTMLDivElement | null>, f: (x: number, y: number) => void) => (e: React.PointerEvent) => {
    const r = el.current!.getBoundingClientRect();
    const go = (ev: { clientX: number; clientY: number }) => f(clamp((ev.clientX - r.left) / r.width), clamp((ev.clientY - r.top) / r.height));
    go(e);
    const move = (ev: PointerEvent) => go(ev);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const fromHex = (t: string) => {
    setText(t);
    const m = t.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
    if (!m) return;
    let h = m[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
    setHsv(rgbToHsv(...v));
  };

  return (
    <div className="color-picker" ref={root} data-testid="color-picker">
      <div className="sv" ref={box} style={{ background: `hsl(${hsv[0]},100%,50%)` }} onPointerDown={dragOn(box, (x, y) => setHsv([hsv[0], x, 1 - y]))}>
        <div className="sv-white" />
        <div className="sv-black" />
        <div className="knob" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: hex(rgb) }} />
      </div>
      <div className="hue" ref={strip} onPointerDown={dragOn(strip, (x) => setHsv([Math.min(359.9, x * 360), hsv[1], hsv[2]]))}>
        <div className="knob" style={{ left: `${(hsv[0] / 360) * 100}%`, background: `hsl(${hsv[0]},100%,50%)` }} />
      </div>
      <div className="picker-row">
        <span className="picker-preview" style={{ background: hex(rgb) }} />
        <input value={text} onChange={(e) => fromHex(e.target.value)} spellCheck={false} data-testid="hex-input" onKeyDown={(e) => e.key === "Enter" && onPick(rgbExpr(...hsvToRgb(...hsv)))} />
        <button className="text-btn primary" onClick={() => onPick(rgbExpr(...hsvToRgb(...hsv)))} data-testid="picker-ok">
          Use
        </button>
      </div>
    </div>
  );
}
