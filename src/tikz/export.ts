// Scene -> TikZ (.tikz file for \tikzfig).
//
// The file contains:
//   - a comment line with the scene as JSON (so the editor can reopen it),
//   - a tikzfigure environment whose arguments are the natural width and
//     height of the drawing in cm (labels excluded), used by \tikzfig's
//     width=/height= options to compute the scale.
import { labelBody, labelNodeOpts } from "../labels/mode";
import { sceneGeomBox } from "../model/geometry";
import type { Obj, Scene, Style } from "../model/types";

export const SCENE_MARKER = "%tikz-editor-scene ";

/** Number with at most 3 decimals, no trailing zeros, no "-0". */
export function fmt(n: number): string {
  let s = (Math.round(n * 1000) / 1000).toFixed(3);
  s = s.replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

const coord = (p: { x: number; y: number }) => `(${fmt(p.x)},${fmt(p.y)})`;

function styleOpts(s: Style, opts: { arrows: boolean }): string[] {
  const o: string[] = [];
  if (s.stroke) o.push(s.stroke === "black" ? "draw" : `draw=${s.stroke}`);
  if (s.fill) o.push(`fill=${s.fill}`);
  if (s.stroke) {
    if (Math.abs(s.width - 0.4) > 1e-9) o.push(`line width=${fmt(s.width)}pt`);
    if (s.dash !== "solid") o.push(s.dash);
    if (opts.arrows && (s.arrowStart || s.arrowEnd)) o.push(`${s.arrowStart ? "<" : ""}-${s.arrowEnd ? ">" : ""}`);
  }
  return o;
}

function objToTikz(o: Obj): string | null {
  switch (o.type) {
    case "path": {
      if (o.pts.length < 2) return null;
      const opts = styleOpts(o.style, { arrows: !o.closed });
      if (opts.length === 0) return null;
      const body = o.pts.map(coord).join(" -- ") + (o.closed ? " -- cycle" : "");
      return `\\path[${opts.join(",")}] ${body};`;
    }
    case "ellipse": {
      const opts = styleOpts(o.style, { arrows: false });
      if (opts.length === 0) return null;
      if (Math.abs(o.rot) > 1e-9) opts.push(`rotate around={${fmt(o.rot)}:${coord(o.c)}}`);
      return `\\path[${opts.join(",")}] ${coord(o.c)} ellipse [x radius=${fmt(o.rx)}, y radius=${fmt(o.ry)}];`;
    }
    case "point": {
      const color = o.style.stroke ?? o.style.fill ?? "black";
      return `\\fill[${color}] ${coord(o.p)} circle [radius=${fmt(o.size)}pt];`;
    }
    case "label": {
      const body = labelBody(o.text, o.textMode);
      if (!body) return null;
      const extra = labelNodeOpts(o);
      const opts = [`anchor=${o.anchor}`, "outer sep=0pt", "align=center", ...(extra ? [extra] : [])];
      return `\\node[${opts.join(",")}] at ${coord(o.p)} {${body}};`;
    }
  }
}

export function sceneToTikz(scene: Scene): string {
  const box = sceneGeomBox(scene.objects);
  const w = box ? box.maxX - box.minX : 0;
  const h = box ? box.maxY - box.minY : 0;
  const lines = [
    "% Made with TikZ Editor. Insert with \\tikzfig{name} (tikzfig.sty).",
    "% Reopen this file in TikZ Editor to change it; edits made here by hand are not read back.",
    SCENE_MARKER + JSON.stringify(scene),
    `\\begin{tikzfigure}{${fmt(w)}}{${fmt(h)}}`,
  ];
  for (const o of scene.objects) {
    const t = objToTikz(o);
    if (t) lines.push(t);
  }
  lines.push("\\end{tikzfigure}", "");
  return lines.join("\n");
}

/** Read the scene back from a .tikz file written by sceneToTikz. */
export function tikzToScene(text: string): Scene | null {
  for (const line of text.split("\n")) {
    if (line.startsWith(SCENE_MARKER)) {
      try {
        const s = JSON.parse(line.slice(SCENE_MARKER.length));
        if (s && s.version === 1 && Array.isArray(s.objects)) return s as Scene;
      } catch {
        return null;
      }
    }
  }
  return null;
}
