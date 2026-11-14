// Figure library: save a selection under a name, insert it into any figure.
// Each item is a JSON file in the library folder (Settings), with the objects
// (centred on the origin) and an SVG thumbnail.
import { call } from "./api/client";
import { getLabel, labelBox, labelImage } from "./labels/render";
import { curvePathD } from "./model/curve";
import { geomBox, ptToCm, transformObj, translation, unionBox, type Box } from "./model/geometry";
import { snapGrid } from "./model/snap";
import { newId, type Obj } from "./model/types";
import { xcolorCss } from "./model/xcolor";
import { askText, store } from "./store";

export interface LibraryItem {
  name: string;
  created: number;
  objects: Obj[];
  /** SVG markup */
  thumb: string;
  /** File name in the library folder (set when listed). */
  file?: string;
}

let items: LibraryItem[] = [];
let version = 0;
const listeners = new Set<() => void>();
const changed = () => {
  version++;
  listeners.forEach((l) => l());
};
export const libraryStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  version: () => version,
  items: () => items,
};

export async function reloadLibrary() {
  try {
    items = await call<LibraryItem[]>("listLibrary");
  } catch (e) {
    store.flash(`Couldn't read the library: ${(e as Error).message}`);
  }
  changed();
}

const boxOfObjs = (objs: Obj[]): Box | null => {
  let b: Box | null = null;
  for (const o of objs) b = unionBox(b, o.type === "label" ? labelBox(o) : geomBox(o));
  return b;
};

export async function saveSelectionToLibrary() {
  const sel = store.selected();
  if (sel.length === 0) return store.flash("Select what to save first");
  const name = await askText("Save to library", { ok: "Save" });
  if (!name) return;
  if (items.some((i) => i.name.toLowerCase() === name.toLowerCase()) && !window.confirm(`Replace “${name}” in the library?`)) return;
  const b = boxOfObjs(sel)!;
  const m = translation(-(b.minX + b.maxX) / 2, -(b.minY + b.maxY) / 2);
  const objects = sel.map((o) => transformObj(o, m));
  const item: LibraryItem = { name, created: Date.now(), objects, thumb: thumbnailSvg(sel) };
  try {
    await call("saveLibraryItem", { item });
    store.flash(`Saved “${name}” to the library`);
  } catch (e) {
    store.flash(`Couldn't save: ${(e as Error).message}`);
  }
  await reloadLibrary();
}

export async function deleteLibraryItem(item: LibraryItem) {
  if (!item.file || !window.confirm(`Delete “${item.name}” from the library?`)) return;
  await call("deleteLibraryItem", { file: item.file });
  await reloadLibrary();
}

/** Place a copy at the middle of the view (snapped to the grid), selected. */
export function insertLibraryItem(item: LibraryItem, where?: { x: number; y: number } | null) {
  const s = store.get();
  const c = where ?? { x: s.view.cx, y: s.view.cy };
  const at = s.settings.snapToGrid ? snapGrid(c, s.settings.gridSize) : c;
  const m = translation(at.x, at.y);
  const copies = item.objects.map((o) => ({ ...transformObj(o, m), id: newId() }));
  store.commit({ ...s.scene, objects: [...s.scene.objects, ...copies] }, { selection: copies.map((o) => o.id), tool: "select", pointEdit: null, editingLabel: null });
}

// ---------------------------------------------------------------- thumbnails

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** A small standalone SVG of the objects (y up, fitted to a 4:3 box). */
export function thumbnailSvg(objs: Obj[]): string {
  const b = boxOfObjs(objs) ?? { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY, 0.5) * 0.08;
  const x0 = b.minX - pad;
  const y0 = b.minY - pad;
  const w = b.maxX - b.minX + 2 * pad;
  const h = b.maxY - b.minY + 2 * pad;
  const parts: string[] = [];
  const stroke = (o: Obj) => {
    const st = o.style;
    const sw = Math.max(1, st.width * 2.2);
    return `stroke="${st.stroke ? xcolorCss(st.stroke) : "none"}" stroke-width="${sw}" vector-effect="non-scaling-stroke" fill="${st.fill ? xcolorCss(st.fill) : "none"}"${st.dash === "dashed" ? ' stroke-dasharray="4 3"' : st.dash === "dotted" ? ' stroke-dasharray="1 2.5"' : ""}`;
  };
  for (const o of objs) {
    switch (o.type) {
      case "path":
        parts.push(`<path d="${o.pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ")}${o.closed ? " Z" : ""}" ${stroke(o)}/>`);
        break;
      case "curve":
        parts.push(`<path d="${curvePathD(o)}" ${stroke(o)}/>`);
        break;
      case "ellipse":
        parts.push(`<ellipse cx="0" cy="0" rx="${o.rx}" ry="${o.ry}" transform="translate(${o.c.x},${o.c.y}) rotate(${o.rot})" ${stroke(o)}/>`);
        break;
      case "point":
        parts.push(`<circle cx="${o.p.x}" cy="${o.p.y}" r="${Math.max(ptToCm(o.size), w / 60)}" fill="${xcolorCss(o.style.stroke ?? "black")}"/>`);
        break;
      case "label": {
        const e = getLabel(o);
        const lb = labelBox(o);
        const url = e && e.status === "ok" ? labelImage(e, 120) : null;
        if (url && lb) parts.push(`<g transform="translate(${lb.minX},${lb.maxY}) scale(1,-1)"><image href="${esc(url)}" width="${lb.maxX - lb.minX}" height="${lb.maxY - lb.minY}" preserveAspectRatio="none"/></g>`);
        break;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${-(y0 + h)} ${w} ${h}" preserveAspectRatio="xMidYMid meet"><g transform="scale(1,-1)">${parts.join("")}</g></svg>`;
}
