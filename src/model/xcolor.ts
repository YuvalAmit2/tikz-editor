// Enough of xcolor's syntax to draw colours on the canvas: base colour names
// and mixes like "blue!20" (20% blue, 80% white) or "red!50!black".

const BASE: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [1, 1, 1],
  red: [1, 0, 0],
  green: [0, 1, 0],
  blue: [0, 0, 1],
  cyan: [0, 1, 1],
  magenta: [1, 0, 1],
  yellow: [1, 1, 0],
  gray: [0.5, 0.5, 0.5],
  darkgray: [0.25, 0.25, 0.25],
  lightgray: [0.75, 0.75, 0.75],
  brown: [0.75, 0.5, 0.25],
  lime: [0.75, 1, 0],
  olive: [0.5, 0.5, 0],
  orange: [1, 0.5, 0],
  pink: [1, 0.75, 0.75],
  purple: [0.75, 0, 0.25],
  teal: [0, 0.5, 0.5],
  violet: [0.5, 0, 0.5],
};

export function xcolorRgb(expr: string): [number, number, number] {
  const parts = expr.split("!").map((s) => s.trim());
  let cur = BASE[parts[0]] ?? [0, 0, 0];
  let i = 1;
  while (i < parts.length) {
    const pct = parseFloat(parts[i]) / 100;
    const other = BASE[parts[i + 1]] ?? [1, 1, 1];
    cur = [0, 1, 2].map((k) => cur[k] * pct + other[k] * (1 - pct)) as [number, number, number];
    i += 2;
  }
  return cur;
}

export function xcolorCss(expr: string | null): string {
  if (!expr) return "none";
  const [r, g, b] = xcolorRgb(expr);
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

/** Colours offered in the style panel (all valid xcolor without extra packages). */
export const PALETTE = ["black", "gray", "red", "orange", "green!60!black", "blue", "violet", "teal"];
export const TINTS = [15, 30, 60, 100];
