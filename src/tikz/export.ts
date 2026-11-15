// Scene -> TikZ (.tikz file for \tikzfig).
//
// The file contains:
//   - a comment line with the scene as JSON (so the editor can reopen it),
//   - a tikzfigure environment whose arguments are the natural width and
//     height of the drawing in cm (labels excluded), used by \tikzfig's
//     width=/height= options to compute the scale.
import { labelBody, labelNodeOpts } from "../labels/mode";
import { sceneGeomBox, transformObj, translation } from "../model/geometry";
import { curveSegments } from "../model/curve";
import { styledRuns } from "../model/parts";
import type { Obj, Pattern, Scene, Style } from "../model/types";
import { patternLook } from "../model/xcolor";
import { halo, marksTikz } from "../model/marks";
import { waved } from "../model/wave";

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
  if (s.fill && s.pattern) o.push(...patternOpts(s.pattern, s.fill));
  else if (s.fill) o.push(`fill=${s.fill}`);
  if (s.fill && s.opacity !== undefined && s.opacity < 1) o.push(`fill opacity=${fmt(s.opacity)}`);
  if (s.stroke) {
    if (Math.abs(s.width - 0.4) > 1e-9) o.push(`line width=${fmt(s.width)}pt`);
    if (s.dash !== "solid") o.push(s.dash);
    if (opts.arrows && (s.arrowStart || s.arrowEnd)) o.push(`${s.arrowStart ? "<" : ""}-${s.arrowEnd ? ">" : ""}`);
  }
  return o.filter(Boolean);
}

/** A hatched fill. At full strength, TikZ's named pattern; lighter tints
 *  space the hatching out (patterns.meta). */
export function patternOpts(p: Pattern, fill: string): string[] {
  const { color, gap } = patternLook(fill);
  const col = color === "black" ? [] : [`pattern color=${color}`];
  if (Math.abs(gap - 3) < 1e-9) return [`pattern=${p}`, ...col];
  const diag = fmt(gap / Math.SQRT2);
  const meta: Record<Pattern, string> = {
    "north east lines": `Lines[angle=45,distance=${diag}pt]`,
    "north west lines": `Lines[angle=-45,distance=${diag}pt]`,
    "horizontal lines": `Lines[angle=0,distance=${fmt(gap)}pt]`,
    "vertical lines": `Lines[angle=90,distance=${fmt(gap)}pt]`,
    crosshatch: `Hatch[distance=${fmt(gap)}pt]`,
    dots: `Dots[distance=${fmt(gap)}pt]`,
  };
  return [`pattern={${meta[p]}}`, ...col];
}

/** An object with styled pieces: its fill, then one \path per stretch. */
function partedToTikz(o: Obj, others: Obj[]): string | null {
  const runs = styledRuns(o, others);
  if (!runs) return null;
  const lines: string[] = [];
  if (o.style.fill) {
    const fillOnly = objToTikz({ ...o, parts: undefined, style: { ...o.style, stroke: null } } as Obj, others);
    if (fillOnly) lines.push(fillOnly);
  }
  for (const r of runs) {
    const st = { ...r.style, fill: null, arrowStart: r.first && o.style.arrowStart, arrowEnd: r.last && o.style.arrowEnd };
    const opts = styleOpts(st, { arrows: true });
    if (!opts.length || !r.pieces.length) continue;
    let body = coord(r.pieces[0].a);
    for (const p of r.pieces) body += p.line ? ` -- ${coord(p.b)}` : ` .. controls ${coord(p.c1)} and ${coord(p.c2)} .. ${coord(p.b)}`;
    lines.push(`\\path[${opts.join(",")}] ${body};`);
  }
  const marks = marksTikz(o, fmt);
  if (marks) lines.push(marks);
  return lines.join("\n") || null;
}


function objToTikz(o: Obj, others: Obj[] = []): string | null {
  if (o.type === "curve" && o.text) {
    // The line (unless hidden), then the text along it.
    const line = o.hidden ? null : objToTikz({ ...o, text: undefined }, others);
    const text = curveTextTikz(o);
    return [line, text].filter(Boolean).join("\n") || null;
  }
  if (o.hidden) return null;
  const h = halo(o);
  if (h) return [plainToTikz(h), objToTikz({ ...o, style: { ...o.style, gap: undefined } } as Obj, others)].filter(Boolean).join("\n") || null;
  if (o.parts?.length && (o.type === "path" || o.type === "curve" || o.type === "ellipse")) {
    const t = partedToTikz(o, others);
    if (t !== null) return t;
  }
  const w = waved(o);
  if (w) {
    // The wave as coordinates; arrows in the middle on the line it follows.
    const line = plainToTikz({ ...w, style: { ...w.style, mid: undefined } });
    return [line, marksTikz(o, fmt)].filter(Boolean).join("\n") || null;
  }
  return [plainToTikz(o), marksTikz(o, fmt)].filter(Boolean).join("\n") || null;
}

function curveTextTikz(o: Extract<Obj, { type: "curve" }>): string | null {
  {
    const segs = curveSegments(o);
    if (!segs.length) return null;
    let body = coord(segs[0].a);
    for (const s of segs) body += ` .. controls ${coord(s.c1)} and ${coord(s.c2)} .. ${coord(s.b)}`;
    const fmtTxt = [o.textFont, o.style.stroke && o.style.stroke !== "black" ? `\\color{${o.style.stroke}}` : ""].filter(Boolean).join("");
    const text = (fmtTxt ? `|${fmtTxt}|` : "") + o.text;
    return `\\path[decorate,decoration={text along path,text={${text}},text align=center}] ${body};`;
  }
}

function plainToTikz(o: Obj): string | null {
  switch (o.type) {
    case "path": {
      if (o.pts.length < 2) return null;
      const opts = styleOpts(o.style, { arrows: !o.closed });
      if (opts.length === 0) return null;
      const body = o.pts.map(coord).join(" -- ") + (o.closed ? " -- cycle" : "");
      return `\\path[${opts.join(",")}] ${body};`;
    }
    case "curve": {
      const segs = curveSegments(o);
      if (segs.length === 0) return null;
      const closed = o.closed && o.nodes.length >= 3;
      const opts = styleOpts(o.style, { arrows: !closed });
      if (opts.length === 0) return null;
      let body = coord(segs[0].a);
      segs.forEach((s, i) => {
        const last = closed && i === segs.length - 1;
        body += ` .. controls ${coord(s.c1)} and ${coord(s.c2)} .. ${last ? "cycle" : coord(s.b)}`;
      });
      return `\\path[${opts.join(",")}] ${body};`;
    }
    case "ellipse": {
      const opts = styleOpts(o.style, { arrows: false });
      if (opts.length === 0) return null;
      if (Math.abs(o.rot) > 1e-9 && Math.abs(o.rx - o.ry) > 1e-9) opts.push(`rotate around={${fmt(o.rot)}:${coord(o.c)}}`);
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
      const opts = [`anchor=${o.anchor}`, "outer sep=0pt", "align=center", ...(extra ? [extra] : []), ...(o.bg ? ["fill=white"] : [])];
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
    const t = objToTikz(o, scene.objects);
    if (t) lines.push(t);
  }
  lines.push("\\end{tikzfigure}", "");
  return lines.join("\n");
}

/** A plain tikzpicture to paste straight into a document: moved so the
 *  drawing is centred on the origin, without the editor's scene line. */
export function sceneToPicture(scene: Scene): string {
  const box = sceneGeomBox(scene.objects);
  const m = box ? translation(-Math.round(((box.minX + box.maxX) / 2) * 4) / 4, -Math.round(((box.minY + box.maxY) / 2) * 4) / 4) : null;
  const objs = m ? scene.objects.map((o) => transformObj(o, m)) : scene.objects;
  const lines: string[] = [];
  const libs = [objs.some((o) => o.type === "curve" && o.text) && "decorations.text", objs.some((o) => o.style.pattern && o.style.fill && !o.hidden) && "patterns", objs.some((o) => o.style.pattern && o.style.fill && !o.hidden && patternLook(o.style.fill).gap !== 3) && "patterns.meta"].filter(Boolean);
  if (libs.length) lines.push(`% needs \\usetikzlibrary{${libs.join(",")}}`);
  lines.push("\\begin{tikzpicture}");
  for (const o of objs) {
    const t = objToTikz(o, objs);
    if (t) lines.push(t);
  }
  lines.push("\\end{tikzpicture}");
  return lines.join("\n") + "\n";
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
