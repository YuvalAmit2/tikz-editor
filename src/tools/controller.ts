// Pointer handling for all tools.
import {
  add,
  dist,
  hitDistance,
  insideBox,
  scalingAbout,
  sub,
  transformObj,
  unionBox,
  geomBox,
  ellipsePoint,
  type Box,
} from "../model/geometry";
import { buildSnapIndex, snap, visibleGrid, type SnapIndex, type SnapResult } from "../model/snap";
import { DEFAULT_STYLE, newId, type CurveNode, type CurveObj, type EllipseObj, type Obj, type PathObj, type Scene, type Vec } from "../model/types";
import { nodeHandles, sampleCurve } from "../model/curve";
import { processStroke } from "../model/sketch";
import { piecesToObj, trimAt, type Piece } from "../model/trim";
import { regionAt } from "../model/region";
import { closestOnSegment, distToSegment as distToSeg, pathSegments, rotationAbout } from "../model/geometry";
import { labelBox } from "../labels/render";
import { store, type ToolName } from "../store";

export interface PEvent {
  world: Vec;
  screen: Vec;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  button: number;
}

type Drag =
  | { kind: "none" }
  | { kind: "pan"; startScreen: Vec; startView: { cx: number; cy: number } }
  | { kind: "move"; ref: Vec; before: Scene; orig: Obj[]; moved: boolean; downScreen: Vec }
  | { kind: "marquee"; start: Vec; add: boolean; base: string[] }
  | { kind: "scale"; box: Box; handle: number; before: Scene; orig: Obj[] }
  | { kind: "rotate"; c: Vec; a0: number; before: Scene; orig: Obj[] }
  | { kind: "handle"; id: string; handle: number; before: Scene; orig: Obj; handles?: { hin: Vec | null; hout: Vec | null }[]; mirror: boolean }
  | { kind: "draw"; downScreen: Vec; start: Vec }
  | { kind: "curveNode"; index: number; downScreen: Vec }
  | { kind: "sketch"; pts: Vec[] }
  | { kind: "erase"; pts: Vec[] };

let drag: Drag = { kind: "none" };
/** Points placed so far by a drawing tool (click-click mode / polyline). */
let draft: Vec[] = [];
/** Anchors placed so far by the curve tool. */
let cdraft: CurveNode[] = [];
let spaceDown = false;
/** Space pressed and released without panning: switch to Select. */
let spaceUsed = false;

const currentDrag = (): Drag => drag;
export function setSpaceDown(d: boolean) {
  if (d && !spaceDown) spaceUsed = false;
  spaceDown = d;
}
/** True if Space was used to pan since it was pressed. */
export const spaceWasUsed = () => spaceUsed;
export const isPanning = () => drag.kind === "pan";

const lbox = (o: Obj) => (o.type === "label" ? labelBox(o) : null);

// ---------------------------------------------------------------- snapping

// Rebuilt only when the objects it's built from change: while dragging, the
// dragged objects are excluded and the others stay the same objects.
let snapCache: { objs: Obj[]; index: SnapIndex } | null = null;
function snapIndex(exclude: string[] = []): SnapIndex {
  const ex = new Set(exclude);
  const objs = store.get().scene.objects.filter((o) => !ex.has(o.id));
  if (snapCache && snapCache.objs.length === objs.length && snapCache.objs.every((o, i) => o === objs[i])) return snapCache.index;
  const index = buildSnapIndex(objs);
  snapCache = { objs, index };
  return index;
}

function doSnap(p: Vec, e: PEvent, opts: { exclude?: string[]; from?: Vec | null } = {}): SnapResult {
  const { settings, view } = store.get();
  return snap(p, snapIndex(opts.exclude), {
    radius: settings.snapRadiusPx / view.zoom,
    gridSize: settings.gridSize,
    gridPx: view.zoom,
    snapToGrid: settings.snapToGrid,
    snapToObjects: settings.snapToObjects,
    angleFrom: e.shift && opts.from ? opts.from : null,
    disabled: e.alt,
  });
}

// ---------------------------------------------------------------- handles

export interface Handle {
  /** Object id, or "" for the selection box. */
  id: string;
  /** box: selection-box corner; anchor: a vertex/anchor; control: a curve handle. */
  kind: "box" | "edge" | "rotate" | "anchor" | "control" | "grab";
  /** For a control: the anchor it belongs to (drawn as a line to it). */
  from?: Vec;
  /** For the selection box: corner index 0..3 (SW, SE, NE, NW). For a path:
   *  vertex index. For an ellipse: 0 = x radius, 1 = y radius. For a curve:
   *  3j = anchor j, 3j+1 = its incoming handle, 3j+2 = its outgoing handle. */
  handle: number;
  p: Vec;
}

export function selectionBox(): Box | null {
  let b: Box | null = null;
  for (const o of store.selected()) b = unionBox(b, o.type === "label" ? labelBox(o) : geomBox(o));
  return b;
}

function curveHandles(o: CurveObj): Handle[] {
  const hs = nodeHandles(o);
  const anchors: Handle[] = o.nodes.map((n, j) => ({ id: o.id, kind: "anchor", handle: 3 * j, p: n.p }));
  const controls: Handle[] = [];
  o.nodes.forEach((n, j) => {
    const { hin, hout } = hs[j];
    if (hin && Math.hypot(hin.x, hin.y) > 1e-9) controls.push({ id: o.id, kind: "control", handle: 3 * j + 1, p: { x: n.p.x + hin.x, y: n.p.y + hin.y }, from: n.p });
    if (hout && Math.hypot(hout.x, hout.y) > 1e-9) controls.push({ id: o.id, kind: "control", handle: 3 * j + 2, p: { x: n.p.x + hout.x, y: n.p.y + hout.y }, from: n.p });
  });
  return [...anchors, ...controls];
}

export function getHandles(): Handle[] {
  const s = store.get();
  // Drawing a curve: its anchors so far, and the handles of the one being
  // placed (dragging pulls them out, like a pen tool).
  if (s.tool === "curve" && cdraft.length) {
    const hs: Handle[] = cdraft.map((n, j) => ({ id: "__draft", kind: "anchor", handle: 3 * j, p: n.p }));
    const j = cdraft.length - 1;
    const n = cdraft[j];
    if (n.mode === "manual") {
      if (n.hin) hs.push({ id: "__draft", kind: "control", handle: 3 * j + 1, p: add(n.p, n.hin), from: n.p });
      if (n.hout) hs.push({ id: "__draft", kind: "control", handle: 3 * j + 2, p: add(n.p, n.hout), from: n.p });
    }
    return hs;
  }
  if (s.tool !== "select") return [];
  if (s.pointEdit) {
    const o = store.objById(s.pointEdit);
    if (!o) return [];
    if (o.type === "path") return o.pts.map((p, i) => ({ id: o.id, kind: "anchor", handle: i, p }));
    if (o.type === "ellipse")
      return [
        { id: o.id, kind: "anchor", handle: 0, p: ellipsePoint(o, 0) },
        { id: o.id, kind: "anchor", handle: 1, p: ellipsePoint(o, Math.PI / 2) },
      ];
    if (o.type === "curve") return curveHandles(o);
    return [];
  }
  const sel = store.selected();
  // "Control points" on: every selected curve shows (and lets you drag) its
  // anchors and handles, and the box is hidden (its corners would sit on them).
  const curves: Handle[] = s.showControls ? sel.flatMap((o) => (o.type === "curve" ? curveHandles(o) : [])) : [];
  if (curves.length) return curves;
  if (sel.length === 0 || (sel.length === 1 && (sel[0].type === "label" || sel[0].type === "point"))) return [];
  const b = selectionBox();
  if (!b || (b.maxX - b.minX < 1e-9 && b.maxY - b.minY < 1e-9)) return [];
  // A box handle sitting on a curve's anchor (e.g. its end at a corner)
  // grabs the curve by that point instead of scaling it.
  const z = s.view.zoom;
  const own = sel.flatMap((o) => (o.type === "curve" ? o.nodes.map((n) => n.p) : []));
  return boxHandles(b, z).map((h) => {
    if (h.kind !== "box" && h.kind !== "edge") return h;
    const q = own.find((p) => dist(p, h.p) * z < 5);
    return q ? { ...h, kind: "grab" as const, p: q } : h;
  });
}

/** Selection-box handles: corners 0..3 (SW, SE, NE, NW), edge middles 4..7
 *  (S, E, N, W: scale one way only) and 8, the rotate knob above the top. */
export function boxHandles(b: Box, zoom: number): Handle[] {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const wide = (b.maxX - b.minX) * zoom > 1;
  const tall = (b.maxY - b.minY) * zoom > 1;
  const hs: Handle[] = [
    { id: "", kind: "box", handle: 0, p: { x: b.minX, y: b.minY } },
    { id: "", kind: "box", handle: 1, p: { x: b.maxX, y: b.minY } },
    { id: "", kind: "box", handle: 2, p: { x: b.maxX, y: b.maxY } },
    { id: "", kind: "box", handle: 3, p: { x: b.minX, y: b.maxY } },
  ];
  // Edge handles only where the box has room for them.
  if (tall && (b.maxX - b.minX) * zoom > 24) {
    hs.push({ id: "", kind: "edge", handle: 4, p: { x: cx, y: b.minY } });
    hs.push({ id: "", kind: "edge", handle: 6, p: { x: cx, y: b.maxY } });
  }
  if (wide && (b.maxY - b.minY) * zoom > 24) {
    hs.push({ id: "", kind: "edge", handle: 5, p: { x: b.maxX, y: cy } });
    hs.push({ id: "", kind: "edge", handle: 7, p: { x: b.minX, y: cy } });
  }
  hs.push({ id: "", kind: "rotate", handle: 8, p: { x: cx, y: b.maxY + ROTATE_PX / zoom }, from: { x: cx, y: b.maxY } });
  return hs;
}
const ROTATE_PX = 22;

/** Mouse cursor over a handle. */
function handleCursor(h: Handle | null): string | null {
  if (!h) return null;
  if (h.kind === "rotate") return "grab";
  if (h.kind === "edge") return h.handle % 2 === 0 ? "ns-resize" : "ew-resize";
  if (h.kind === "box") return h.handle % 2 === 0 ? "nesw-resize" : "nwse-resize";
  if (h.kind === "grab") return "move";
  return "move";
}

function handleAt(e: PEvent): Handle | null {
  const z = store.get().view.zoom;
  // Anchors win over controls lying on top of them; then the closest.
  let best: Handle | null = null;
  let bd = 7;
  for (const h of getHandles()) {
    const d = dist(h.p, e.world) * z - (h.kind === "anchor" ? 2 : 0);
    if (d <= bd) {
      bd = d;
      best = h;
    }
  }
  return best;
}

const HIT_PX = 10;

function objectAt(p: Vec): Obj | null {
  const { scene, view } = store.get();
  // Generous: lines are thin, and you shouldn't have to aim.
  const tol = HIT_PX / view.zoom;
  let best: Obj | null = null;
  let bd = tol;
  // Topmost first; a closer hit wins only when clearly closer.
  for (let i = scene.objects.length - 1; i >= 0; i--) {
    const o = scene.objects[i];
    const d = hitDistance(o, p, lbox);
    if (d < bd - 1e-9 || (d === 0 && bd > 0)) {
      bd = d;
      best = o;
      if (d === 0) break;
    }
  }
  return best;
}

// ---------------------------------------------------------------- creating

function finishCreate(o: Obj) {
  const s = store.get();
  const toSelect = s.settings.returnToSelect;
  store.commit(
    { ...s.scene, objects: [...s.scene.objects, o] },
    {
      preview: [],
      selection: [o.id],
      tool: toSelect ? "select" : s.tool,
      editingLabel: o.type === "label" ? o.id : null,
    },
  );
  draft = [];
}

function buildShape(tool: ToolName, a: Vec, b: Vec, shift: boolean): Obj | null {
  const style = { ...store.get().style };
  const id = newId();
  switch (tool) {
    case "line":
      return { id, type: "path", style: { ...style, fill: null }, pts: [a, b], closed: false };
    case "rect": {
      let w = b.x - a.x;
      let h = b.y - a.y;
      if (shift) {
        const m = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * m;
        h = Math.sign(h || 1) * m;
      }
      return {
        id,
        type: "path",
        style,
        closed: true,
        pts: [a, { x: a.x + w, y: a.y }, { x: a.x + w, y: a.y + h }, { x: a.x, y: a.y + h }],
      };
    }
    case "circle":
      return { id, type: "ellipse", style, c: a, rx: dist(a, b), ry: dist(a, b), rot: 0 };
    case "ellipse": {
      let rx = Math.abs(b.x - a.x);
      let ry = Math.abs(b.y - a.y);
      if (shift) rx = ry = Math.max(rx, ry);
      return { id, type: "ellipse", style, c: a, rx, ry, rot: 0 };
    }
  }
  return null;
}

function polylinePreview(cursor: Vec | null): Obj[] {
  if (draft.length === 0) return [];
  const pts = cursor ? [...draft, cursor] : draft;
  return [{ id: "__draft", type: "path", style: { ...store.get().style }, pts, closed: false }];
}

export function finishPolyline(close: boolean) {
  if (draft.length >= 2) {
    const closed = close && draft.length >= 3;
    // Open lines take no fill (it wouldn't show in the panel to change).
    const o: PathObj = { id: newId(), type: "path", style: { ...store.get().style, ...(closed ? {} : { fill: null }) }, pts: draft, closed };
    finishCreate(o);
  }
  cancelDraft();
}

export function cancelDraft() {
  draft = [];
  cdraft = [];
  drag = { kind: "none" };
  store.set({ preview: [], snap: null });
}

export function hasDraft() {
  return draft.length > 0 || cdraft.length > 0;
}

export function removeLastDraftPoint() {
  if (cdraft.length) {
    cdraft.pop();
    store.set({ preview: curvePreview(store.get().cursor) });
    return;
  }
  draft.pop();
  store.set({ preview: polylinePreview(store.get().cursor) });
}

function curvePreview(cursor: Vec | null): Obj[] {
  if (cdraft.length === 0) return [];
  const nodes = cursor ? [...cdraft, { p: cursor, mode: "smooth" as const }] : cdraft;
  return [{ id: "__draft", type: "curve", style: { ...store.get().style }, nodes, closed: false }];
}

export function finishCurve(close: boolean) {
  if (cdraft.length >= 2) {
    const closed = close && cdraft.length >= 3;
    const o: CurveObj = { id: newId(), type: "curve", style: { ...store.get().style, ...(closed ? {} : { fill: null }) }, nodes: cdraft, closed };
    cdraft = [];
    finishCreate(o);
  }
  cancelDraft();
}

// ---------------------------------------------------------------- sketch

function finishSketch(raw: Vec[]) {
  const s = store.get();
  const z = s.view.zoom;
  const r = processStroke(raw, { tol: s.settings.sketchSmoothing / z, spacing: 2 / z, closeDist: 14 / z, recognize: s.settings.recognizeShapes });
  store.set({ preview: [] });
  if (!r || r.nodes.length < 2) return;
  // Open strokes: let the ends snap onto objects (e.g. end exactly on a point).
  if (!r.closed) {
    for (const j of [0, r.nodes.length - 1]) {
      const n = r.nodes[j];
      const sr = snap(n.p, snapIndex(), { radius: s.settings.snapRadiusPx / z, gridSize: s.settings.gridSize, snapToGrid: false, snapToObjects: s.settings.snapToObjects });
      if (sr.kind !== "none") r.nodes[j] = { ...n, p: sr.p };
    }
  }
  const style = { ...s.style, ...(r.closed ? {} : { fill: null }) };
  const curve: CurveObj = { id: newId(), type: "curve", style, nodes: r.nodes, closed: r.closed };
  finishCreate(curve);
  if (!r.shape) return;
  // Recognised shape: a second step, so one undo gets the freehand curve back.
  let shape: Obj;
  const id = curve.id;
  if (r.shape.kind === "line") shape = { id, type: "path", style, pts: [r.shape.a, r.shape.b], closed: false };
  else if (r.shape.kind === "polygon") shape = { id, type: "path", style, pts: r.shape.pts, closed: r.shape.closed };
  else shape = { id, type: "ellipse", style, c: r.shape.c, rx: r.shape.rx, ry: r.shape.ry, rot: r.shape.rot };
  store.commit(store.withReplaced([shape]));
}

// ---------------------------------------------------------------- trim / erase

const TRIMMABLE = new Set(["path", "curve", "ellipse"]);

function trimTarget(p: Vec): Obj | null {
  const { scene, view } = store.get();
  // Generous: lines are thin, and you shouldn't have to aim.
  const tol = HIT_PX / view.zoom;
  let best: Obj | null = null;
  let bd = tol;
  for (const o of scene.objects) {
    if (!TRIMMABLE.has(o.type)) continue;
    // Distance to the stroke only (not the inside of filled shapes).
    const d = hitDistance({ ...o, style: { ...o.style, fill: null } } as Obj, p, lbox);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

function piecesD(pieces: Piece[]): Obj {
  const nodes: CurveNode[] = [];
  const zero = { x: 0, y: 0 };
  pieces.forEach((p, i) => nodes.push({ p: p.a, mode: "manual", hin: i ? sub(pieces[i - 1].c2, p.a) : zero, hout: sub(p.c1, p.a) }));
  const last = pieces[pieces.length - 1];
  nodes.push({ p: last.b, mode: "manual", hin: sub(last.c2, last.b), hout: zero });
  const style = { stroke: "red!80", width: 1.6, dash: "solid" as const, fill: null, arrowStart: false, arrowEnd: false };
  return { id: "__trim", type: "curve", style, nodes, closed: false };
}

function trimPreview(p: Vec): Obj[] {
  const o = trimTarget(p);
  if (!o) return [];
  const r = trimAt(o, p, store.get().scene.objects.filter((x) => x.id !== o.id));
  return r && r.removed.length ? [piecesD(r.removed)] : [];
}

/** Trim the object under p in `scene`; null if nothing was there. */
function trimScene(scene: Scene, p: Vec): Scene | null {
  const o = trimTarget(p);
  if (!o) return null;
  const r = trimAt(o, p, scene.objects.filter((x) => x.id !== o.id));
  if (!r) return null;
  const i = scene.objects.findIndex((x) => x.id === o.id);
  const objects = [...scene.objects.slice(0, i), ...r.kept, ...scene.objects.slice(i + 1)];
  return { ...scene, objects };
}

/** A click trims the piece under it; a stroke trims every piece it crosses. */
function finishErase(pts: Vec[]) {
  const s = store.get();
  store.set({ preview: [] });
  const before = s.scene;
  let hits: Vec[] = [];
  const z = s.view.zoom;
  const len = pts.reduce((a, p, i) => (i ? a + dist(p, pts[i - 1]) : 0), 0);
  if (len * z < 4) hits = [pts[0]];
  else {
    // Where the stroke crosses objects (sampled along the stroke).
    for (let i = 0; i + 1 < pts.length; i++) {
      const n = Math.max(1, Math.ceil((dist(pts[i], pts[i + 1]) * z) / 2));
      for (let k = 0; k < n; k++) {
        const q = { x: pts[i].x + ((pts[i + 1].x - pts[i].x) * k) / n, y: pts[i].y + ((pts[i + 1].y - pts[i].y) * k) / n };
        const o = trimTarget(q);
        if (o && hitDistance({ ...o, style: { ...o.style, fill: null } } as Obj, q, lbox) * z < 2.5 && !hits.some((h) => dist(h, q) * z < 8)) hits.push(q);
      }
    }
  }
  let scene = before;
  for (const q of hits) {
    store.preview(scene);
    scene = trimScene(scene, q) ?? scene;
  }
  store.preview(before);
  if (scene !== before) store.commit(scene, { selection: [] }, before);
}

// ---------------------------------------------------------------- paint bucket

/** Fill the region around p: a closed shape gets its fill set; a region
 *  made by several lines becomes a new filled shape behind them. */
function paintBucket(p: Vec) {
  const s = store.get();
  const fill = s.style.fill ?? (s.style.stroke && s.style.stroke !== "black" ? `${s.style.stroke}!30` : "gray!30");
  const r = regionAt(s.scene.objects, p);
  if (!r) return store.flash("No closed region here");
  if (r.whole) {
    const o = store.objById(r.whole)!;
    store.commit(store.withReplaced([{ ...o, style: { ...o.style, fill } } as Obj]), { selection: [o.id] });
    return;
  }
  const shape = piecesToObj(r.pieces, { id: "", type: "path", style: { ...DEFAULT_STYLE, stroke: null, fill }, pts: [], closed: false } as Obj)!;
  let closed: Obj;
  if (shape.type === "path") closed = { ...shape, pts: shape.pts.slice(0, -1), closed: true };
  else {
    const c = shape as CurveObj;
    const last = c.nodes[c.nodes.length - 1];
    closed = { ...c, nodes: c.nodes.slice(0, -1).map((n, i) => (i === 0 ? { ...n, hin: last.hin } : n)), closed: true };
  }
  // Behind everything, so the lines around it stay on top.
  store.commit({ ...s.scene, objects: [closed, ...s.scene.objects] }, { selection: [closed.id] });
}

// ---------------------------------------------------------------- events

export function onPointerDown(e: PEvent) {
  const s = store.get();
  if (e.button === 1 || spaceDown) {
    if (spaceDown) spaceUsed = true;
    drag = { kind: "pan", startScreen: e.screen, startView: { cx: s.view.cx, cy: s.view.cy } };
    return;
  }
  if (e.button !== 0) return;

  if (s.tool === "select") return selectDown(e);

  if (s.tool === "sketch") {
    drag = { kind: "sketch", pts: [e.world] };
    return;
  }
  if (s.tool === "trim") {
    drag = { kind: "erase", pts: [e.world] };
    return;
  }
  if (s.tool === "fill") return paintBucket(e.world);

  const from = draft.length ? draft[draft.length - 1] : cdraft.length ? cdraft[cdraft.length - 1].p : null;
  const sp = doSnap(e.world, e, { from }).p;

  switch (s.tool) {
    case "curve": {
      if (cdraft.length >= 3 && dist(sp, cdraft[0].p) * s.view.zoom < 8) return finishCurve(true);
      if (cdraft.length && dist(sp, cdraft[cdraft.length - 1].p) < 1e-9) return;
      cdraft.push({ p: sp, mode: "smooth" });
      drag = { kind: "curveNode", index: cdraft.length - 1, downScreen: e.screen };
      store.set({ preview: curvePreview(null) });
      return;
    }
    case "point": {
      finishCreate({ id: newId(), type: "point", style: { ...s.style }, p: sp, size: 1.5 });
      return;
    }
    case "text": {
      // Clicking an existing label edits it.
      const hit = objectAt(e.world);
      if (hit && hit.type === "label") {
        store.set({ selection: [hit.id], editingLabel: hit.id, tool: s.settings.returnToSelect ? "select" : s.tool });
        return;
      }
      const o: Obj = { id: newId(), type: "label", style: { ...s.style, fill: null }, p: sp, text: "", textMode: false, anchor: "center", font: "" };
      finishCreate(o);
      return;
    }
    case "polyline": {
      if (draft.length >= 3 && dist(sp, draft[0]) * s.view.zoom < 8) return finishPolyline(true);
      if (draft.length && dist(sp, draft[draft.length - 1]) < 1e-9) return;
      draft.push(sp);
      store.set({ preview: polylinePreview(sp) });
      return;
    }
    default: {
      // Two-point shapes: drag, or click then click.
      if (draft.length === 1) {
        const o = buildShape(s.tool, draft[0], sp, e.shift);
        if (o) finishCreate(o);
        draft = [];
        return;
      }
      draft = [sp];
      drag = { kind: "draw", downScreen: e.screen, start: sp };
    }
  }
}

function selectDown(e: PEvent) {
  const s = store.get();
  const h = handleAt(e);
  if (h && h.kind === "grab") {
    drag = { kind: "move", ref: h.p, before: s.scene, orig: store.selected(), moved: false, downScreen: e.screen };
    return;
  }
  if (h) {
    if (h.id === "") {
      const b = selectionBox()!;
      if (h.kind === "rotate") {
        const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
        drag = { kind: "rotate", c, a0: Math.atan2(e.world.y - c.y, e.world.x - c.x), before: s.scene, orig: store.selected() };
      } else drag = { kind: "scale", box: b, handle: h.handle, before: s.scene, orig: store.selected() };
    } else {
      const orig = store.objById(h.id)!;
      drag = { kind: "handle", id: h.id, handle: h.handle, before: s.scene, orig, handles: orig.type === "curve" ? nodeHandles(orig) : undefined, mirror: e.shift };
      if (h.kind === "anchor" && orig.type !== "ellipse") store.set({ activeNode: orig.type === "curve" ? Math.floor(h.handle / 3) : h.handle });
    }
    return;
  }
  let hit = objectAt(e.world);
  // Inside the box around what's selected: drag the selection (as in other editors).
  if (!hit && !e.shift && !s.pointEdit && s.selection.length) {
    const b = selectionBox();
    const pad = 4 / s.view.zoom;
    if (b && e.world.x >= b.minX - pad && e.world.x <= b.maxX + pad && e.world.y >= b.minY - pad && e.world.y <= b.maxY + pad) hit = store.objById(s.selection[0]) ?? null;
  }
  if (s.pointEdit && (!hit || hit.id !== s.pointEdit)) store.set({ pointEdit: null, activeNode: null });
  if (!hit) {
    drag = { kind: "marquee", start: e.world, add: e.shift, base: e.shift ? s.selection : [] };
    store.set({ selection: drag.base, editingLabel: null });
    return;
  }
  let selection = s.selection;
  if (e.shift) {
    selection = selection.includes(hit.id) ? selection.filter((x) => x !== hit.id) : [...selection, hit.id];
  } else if (!selection.includes(hit.id)) {
    selection = [hit.id];
  }
  // A click selects (and lets you drag); a double-click edits a label's text.
  store.set({ selection, editingLabel: null });
  if (!selection.includes(hit.id)) return;
  // Grab point: the nearest special point of the grabbed object, so that
  // snapping moves that point onto targets (e.g. a vertex onto a vertex).
  const own = buildSnapIndex([hit]).points;
  let ref = e.world;
  let bd = s.settings.snapRadiusPx / s.view.zoom;
  for (const c of own) {
    const d = dist(c.p, e.world);
    if (d < bd) {
      bd = d;
      ref = c.p;
    }
  }
  drag = { kind: "move", ref, before: s.scene, orig: store.selected(), moved: false, downScreen: e.screen };
}

/** Right click: select what's under the mouse (keeping a selection that
 *  includes it) and open the menu. */
export function onContextMenu(e: PEvent, client: Vec) {
  const s = store.get();
  if (s.tool !== "select") return;
  const hit = objectAt(e.world);
  if (hit && !s.selection.includes(hit.id)) store.set({ selection: [hit.id], editingLabel: null });
  if (!hit && !s.selection.length) return;
  store.set({ menu: client });
}

/** Last mouse position over the canvas (kept after the mouse leaves it). */
let lastPoint: Vec | null = null;
export const lastCanvasPoint = () => lastPoint;

export function onPointerMove(e: PEvent) {
  const s = store.get();
  lastPoint = e.world;
  store.set({ cursor: e.world });
  const drag = currentDrag();
  switch (drag.kind) {
    case "pan": {
      const d = sub(e.screen, drag.startScreen);
      store.set({ view: { ...s.view, cx: drag.startView.cx - d.x / s.view.zoom, cy: drag.startView.cy + d.y / s.view.zoom } });
      return;
    }
    case "move": {
      if (!drag.moved && dist(e.screen, drag.downScreen) < 3) return;
      drag.moved = true;
      const exclude = drag.orig.map((o) => o.id);
      const target = add(drag.ref, sub(e.world, drag.ref));
      const sr = doSnap(target, e, { exclude, from: drag.ref });
      const d = sub(sr.p, drag.ref);
      const m = { a: 1, b: 0, c: 0, d: 1, e: d.x, f: d.y };
      store.set({ snap: sr });
      store.preview(store.withReplaced(drag.orig.map((o) => transformObj(o, m)), drag.before));
      return;
    }
    case "marquee": {
      const b: Box = {
        minX: Math.min(drag.start.x, e.world.x),
        maxX: Math.max(drag.start.x, e.world.x),
        minY: Math.min(drag.start.y, e.world.y),
        maxY: Math.max(drag.start.y, e.world.y),
      };
      const inside = s.scene.objects.filter((o) => insideBox(o, b, lbox)).map((o) => o.id);
      store.set({ marquee: b, selection: [...new Set([...drag.base, ...inside])] });
      return;
    }
    case "rotate": {
      let deg = ((Math.atan2(e.world.y - drag.c.y, e.world.x - drag.c.x) - drag.a0) * 180) / Math.PI;
      // ⇧: steps of 15°
      if (e.shift) deg = Math.round(deg / 15) * 15;
      const m = rotationAbout(drag.c, deg);
      store.set({ snap: null, message: `${Math.round((((deg % 360) + 540) % 360) - 180)}°` });
      store.preview(store.withReplaced(drag.orig.map((o) => transformObj(o, m)), drag.before));
      return;
    }
    case "scale": {
      const sr = doSnap(e.world, e, { exclude: drag.orig.map((o) => o.id) });
      // ⇧: symmetric (about the centre); ⌘: keep the proportions.
      const { f, c0, ax, ay } = scaleFrame(drag.box, drag.handle, e.shift);
      let sx = !ax || Math.abs(c0.x - f.x) < 1e-9 ? 1 : (sr.p.x - f.x) / (c0.x - f.x);
      let sy = !ay || Math.abs(c0.y - f.y) < 1e-9 ? 1 : (sr.p.y - f.y) / (c0.y - f.y);
      if (e.meta && ax && ay) {
        const m = Math.max(Math.abs(sx), Math.abs(sy));
        sx = Math.sign(sx || 1) * m;
        sy = Math.sign(sy || 1) * m;
      }
      const m = scalingAbout(f, sx, sy);
      store.set({ snap: sr });
      store.preview(store.withReplaced(drag.orig.map((o) => transformObj(o, m)), drag.before));
      return;
    }
    case "curveNode": {
      const n = cdraft[drag.index];
      if (!n) return;
      if (dist(e.screen, drag.downScreen) < 4 && n.mode !== "manual") return;
      // Dragging while placing an anchor pulls out its handle (like a pen tool).
      const hout = sub(e.world, n.p);
      cdraft[drag.index] = { p: n.p, mode: "manual", hout, hin: { x: -hout.x, y: -hout.y } };
      store.set({ preview: curvePreview(null) });
      return;
    }
    case "erase": {
      drag.pts.push(e.world);
      const st = { ...s.style, stroke: "red!70", width: 0.4, fill: null, arrowStart: false, arrowEnd: false, dash: "solid" as const };
      store.set({ preview: [{ id: "__draft", type: "path", style: st, pts: drag.pts.slice(), closed: false }] });
      return;
    }
    case "sketch": {
      drag.pts.push(e.world);
      store.set({ preview: [{ id: "__draft", type: "path", style: { ...s.style, fill: null, arrowStart: false, arrowEnd: false, dash: "solid" }, pts: drag.pts.slice(), closed: false }] });
      return;
    }
    case "handle": {
      // ⇧ pressed or let go mid-drag: carry on from the shape as it is now,
      // so nothing jumps (the mirrored point stays where it got to).
      if (e.shift !== drag.mirror) {
        const cur = store.objById(drag.id);
        if (cur) {
          drag.orig = cur;
          if (cur.type === "curve") drag.handles = nodeHandles(cur);
        }
        drag.mirror = e.shift;
      }
      const o = drag.orig;
      if (o.type === "curve") {
        const j = Math.floor(drag.handle / 3);
        const k = drag.handle % 3;
        const node = o.nodes[j];
        let next: CurveNode;
        if (k === 0) {
          const sr = doSnap(e.world, e, { exclude: [o.id] });
          store.set({ snap: sr });
          next = { ...node, p: sr.p };
        } else {
          // Dragging a handle makes the anchor manual. The opposite handle
          // mirrors its direction (keeping its length) unless the anchor is a
          // corner or Alt is held.
          const hs = drag.handles![j];
          const v = sub(e.world, node.p);
          const other = k === 1 ? hs.hout : hs.hin;
          const free = node.mode === "corner" || e.alt;
          let mirrored = other;
          if (!free && other) {
            const l = Math.hypot(other.x, other.y);
            const vl = Math.hypot(v.x, v.y) || 1;
            mirrored = { x: (-v.x / vl) * l, y: (-v.y / vl) * l };
          }
          const zero = { x: 0, y: 0 };
          next = {
            p: node.p,
            mode: "manual",
            hin: k === 1 ? v : (mirrored ?? zero),
            hout: k === 2 ? v : (mirrored ?? zero),
          };
          store.set({ snap: null });
        }
        const nodes = o.nodes.map((n, i) => (i === j ? next : n));
        // ⇧: the mirror-image anchor moves too.
        const m = e.shift ? mirrorOf(o.nodes.map((n) => n.p), o.closed, j) : null;
        if (m) {
          // The partner moves by the mirror image of how this one moved
          // (exactly the mirror image when the shape was symmetric).
          const hs = drag.handles!;
          const zero = { x: 0, y: 0 };
          const pn = o.nodes[m.partner];
          const p = add(pn.p, m.L(sub(next.p, node.p)));
          if (k === 0) nodes[m.partner] = { ...pn, p };
          else {
            const ph = hs[m.partner];
            const dIn = sub(next.mode === "manual" ? (next.hin ?? zero) : zero, hs[j].hin ?? zero);
            const dOut = sub(next.mode === "manual" ? (next.hout ?? zero) : zero, hs[j].hout ?? zero);
            nodes[m.partner] = { p, mode: "manual", hin: add(ph.hin ?? zero, m.L(dOut)), hout: add(ph.hout ?? zero, m.L(dIn)) };
          }
        }
        store.preview(store.withReplaced([{ ...o, nodes }], drag.before));
        return;
      }
      if (o.type === "path") {
        const sr = doSnap(e.world, e, { exclude: [o.id] });
        const pts = o.pts.map((p, i) => (i === drag.handle ? sr.p : p));
        const m = e.shift ? mirrorOf(o.pts, o.closed, drag.handle) : null;
        if (m) pts[m.partner] = add(o.pts[m.partner], m.L(sub(sr.p, o.pts[drag.handle])));
        store.set({ snap: sr });
        store.preview(store.withReplaced([{ ...o, pts }], drag.before));
      } else if (o.type === "ellipse") {
        const sr = doSnap(e.world, e, { exclude: [o.id] });
        const el = o as EllipseObj;
        const r = (el.rot * Math.PI) / 180;
        const axis = drag.handle === 0 ? { x: Math.cos(r), y: Math.sin(r) } : { x: -Math.sin(r), y: Math.cos(r) };
        const d = sub(sr.p, el.c);
        let val = Math.abs(d.x * axis.x + d.y * axis.y);
        // Circles stay circles unless ⌘ is held.
        const circle = Math.abs(el.rx - el.ry) < 1e-9 && !e.meta;
        if (circle) val = dist(sr.p, el.c);
        const next: EllipseObj = circle ? { ...el, rx: val, ry: val } : drag.handle === 0 ? { ...el, rx: val } : { ...el, ry: val };
        store.set({ snap: sr });
        store.preview(store.withReplaced([next], drag.before));
      }
      return;
    }
    case "draw": {
      const sr = doSnap(e.world, e, { from: drag.start });
      const o = buildShape(s.tool, drag.start, sr.p, e.shift);
      store.set({ snap: sr, preview: o ? [o] : [] });
      return;
    }
  }
  // Hover (no button): show snap target and drafts.
  if (s.tool !== "select") {
    const from = draft.length ? draft[draft.length - 1] : cdraft.length ? cdraft[cdraft.length - 1].p : null;
    const sr = doSnap(e.world, e, { from });
    let preview: Obj[] = [];
    if (s.tool === "polyline") preview = polylinePreview(sr.p);
    else if (s.tool === "curve") preview = curvePreview(sr.p);
    else if (s.tool === "sketch") preview = [];
    else if (s.tool === "trim") {
      store.set({ snap: null, preview: trimPreview(e.world) });
      return;
    }
    else if (draft.length === 1) {
      const o = buildShape(s.tool, draft[0], sr.p, e.shift);
      preview = o ? [o] : [];
    }
    store.set({ snap: sr, preview });
  } else {
    if (s.snap) store.set({ snap: null });
    const h = handleAt(e);
    const hint = editTargets().length && !h ? (insertPointAt(e)?.p ?? null) : null;
    if (hint || s.insertHint) store.set({ insertHint: hint });
    const cur = handleCursor(h);
    if (cur !== s.hoverCursor) store.set({ hoverCursor: cur });
  }
}

export function onPointerUp(e: PEvent) {
  const s = store.get();
  const d = drag;
  drag = { kind: "none" };
  switch (d.kind) {
    case "move": {
      if (!d.moved) return;
      // A label moved by hand stays where it was put.
      const placed = d.orig.filter((o) => o.type === "label" && o.attach).map((o) => {
        const { attach: _, ...rest } = store.objById(o.id) as Extract<Obj, { type: "label" }>;
        return rest;
      });
      store.commit(placed.length ? store.withReplaced(placed) : s.scene, { snap: null }, d.before);
      return;
    }
    case "scale":
    case "rotate":
    case "handle":
      if (d.kind === "rotate") store.set({ message: null });
      if (s.scene !== d.before) store.commit(s.scene, { snap: null }, d.before);
      else store.set({ snap: null });
      return;
    case "marquee":
      store.set({ marquee: null });
      return;
    case "curveNode":
      return;
    case "sketch":
      return finishSketch(d.pts);
    case "erase":
      return finishErase(d.pts);
    case "draw": {
      if (dist(e.screen, d.downScreen) < 4) {
        // A click: wait for the second click (draft holds the first point).
        return;
      }
      const sr = doSnap(e.world, e, { from: d.start });
      const o = buildShape(s.tool, d.start, sr.p, e.shift);
      if (o && !degenerate(o, s.view.zoom)) finishCreate(o);
      else cancelDraft();
      return;
    }
  }
}

/** For a box handle: the fixed point, the dragged point, and which axes it
 *  scales. ⌘ scales about the centre (both sides move). */
export function scaleFrame(b: Box, handle: number, centred: boolean): { f: Vec; c0: Vec; ax: boolean; ay: boolean } {
  const xs = [b.minX, b.maxX];
  const ys = [b.minY, b.maxY];
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  // [dragged x, dragged y] as -1 (min), 0 (middle), 1 (max)
  const where: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0]];
  const [wx, wy] = where[handle];
  const c0 = { x: wx === 0 ? cx : xs[(wx + 1) / 2], y: wy === 0 ? cy : ys[(wy + 1) / 2] };
  const f = centred ? { x: cx, y: cy } : { x: wx === 0 ? cx : xs[(1 - wx) / 2], y: wy === 0 ? cy : ys[(1 - wy) / 2] };
  return { f, c0, ax: wx !== 0, ay: wy !== 0 };
}

/** Symmetric editing (⌘-drag): the partner of point i in an open chain is
 *  the one as far from the other end. Points are mirrored across the chain's
 *  axis (through the middle of the ends and the middle point), or through the
 *  midpoint for a straight line, so a line grows from both ends at once. */
export function mirrorOf(pts: Vec[], closed: boolean, i: number): { partner: number; R: (p: Vec) => Vec; L: (v: Vec) => Vec } | null {
  const n = pts.length;
  if (closed || n < 2) return null;
  const partner = n - 1 - i;
  if (partner === i) return null;
  const M = { x: (pts[0].x + pts[n - 1].x) / 2, y: (pts[0].y + pts[n - 1].y) / 2 };
  const C = n % 2 ? pts[(n - 1) / 2] : { x: (pts[n / 2 - 1].x + pts[n / 2].x) / 2, y: (pts[n / 2 - 1].y + pts[n / 2].y) / 2 };
  const ax = sub(C, M);
  const l = Math.hypot(ax.x, ax.y);
  if (l < 1e-9 || n === 2) {
    return { partner, R: (p) => ({ x: 2 * M.x - p.x, y: 2 * M.y - p.y }), L: (v) => ({ x: -v.x, y: -v.y }) };
  }
  const u = { x: ax.x / l, y: ax.y / l };
  const L = (v: Vec) => {
    const k = 2 * (v.x * u.x + v.y * u.y);
    return { x: k * u.x - v.x, y: k * u.y - v.y };
  };
  return { partner, R: (p) => add(M, L(sub(p, M))), L };
}

function degenerate(o: Obj, zoom: number): boolean {
  if (o.type === "ellipse") return o.rx * zoom < 2 && o.ry * zoom < 2;
  if (o.type === "path") {
    const b = geomBox(o)!;
    return (b.maxX - b.minX) * zoom < 2 && (b.maxY - b.minY) * zoom < 2;
  }
  return false;
}

export function onDoubleClick(e: PEvent) {
  const s = store.get();
  if (s.tool === "curve") {
    // The double click's clicks added anchors at the same spot; drop them.
    while (cdraft.length >= 2 && dist(cdraft[cdraft.length - 1].p, cdraft[cdraft.length - 2].p) < 1e-9) cdraft.pop();
    return finishCurve(false);
  }
  if (s.tool === "select" && editTargets().length) {
    const h = handleAt(e);
    const ho = h && h.kind === "anchor" ? store.objById(h.id) : undefined;
    if (ho && ho.type === "curve") return toggleNodeMode(ho, Math.floor(h!.handle / 3));
    // On the edited line itself: stay in this mode (↵ adds a point there).
    if (!h && insertPointAt(e)) return;
  }
  if (s.tool === "polyline") {
    // The double click's two clicks already added points; drop the duplicate.
    if (draft.length >= 2 && dist(draft[draft.length - 1], draft[draft.length - 2]) < 1e-9) draft.pop();
    return finishPolyline(false);
  }
  if (s.tool !== "select") return;
  const hit = objectAt(e.world);
  if (!hit) return;
  if (hit.type === "label") store.set({ selection: [hit.id], editingLabel: hit.id });
  else if (hit.type === "path" || hit.type === "ellipse" || hit.type === "curve") store.set({ selection: [hit.id], pointEdit: hit.id, activeNode: null });
}

// ---------------------------------------------------------------- point editing

/** Objects whose points are being edited: the double-clicked one, or every
 *  selected curve while "Control points" is on. */
export function editTargets(): (PathObj | CurveObj)[] {
  const s = store.get();
  if (s.tool !== "select") return [];
  if (s.pointEdit) {
    const o = store.objById(s.pointEdit);
    return o && (o.type === "path" || o.type === "curve") ? [o] : [];
  }
  return s.showControls ? store.selected().filter((o): o is CurveObj => o.type === "curve") : [];
}

/** Where a double-click would add a point: the nearest point on an edited
 *  line, moved to where it crosses a grid line or another object's special
 *  point when one is near (with snapping on). */
export function insertPointAt(e: PEvent): { o: PathObj | CurveObj; p: Vec } | null {
  const { view, settings } = store.get();
  let best: { o: PathObj | CurveObj; pts: Vec[]; d: number } | null = null;
  for (const o of editTargets()) {
    const pts = o.type === "path" ? (o.closed ? [...o.pts, o.pts[0]] : o.pts) : sampleCurve(o, 64);
    let d = Infinity;
    for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, distToSeg(e.world, pts[i], pts[i + 1]));
    if (d * view.zoom < HIT_PX && (!best || d < best.d)) best = { o, pts, d };
  }
  if (!best) return null;
  const { pts } = best;
  let q = e.world;
  let qd = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const c = closestOnSegment(e.world, pts[i], pts[i + 1]);
    const d = dist(c, e.world);
    if (d < qd) {
      qd = d;
      q = c;
    }
  }
  if (e.alt) return { o: best.o, p: q };
  const r = settings.snapRadiusPx / view.zoom;
  const cands: Vec[] = [];
  if (settings.snapToGrid) {
    const g = visibleGrid(settings.gridSize, view.zoom);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (dist(a, q) > r + dist(a, b)) continue;
      for (const axis of ["x", "y"] as const) {
        const lo = Math.min(a[axis], b[axis]);
        const hi = Math.max(a[axis], b[axis]);
        for (let k = Math.ceil(lo / g); k * g <= hi; k++) {
          const v = k * g + 0;
          const t = Math.abs(b[axis] - a[axis]) < 1e-12 ? 0 : (v - a[axis]) / (b[axis] - a[axis]);
          const c = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          c[axis] = v;
          cands.push(c);
        }
      }
    }
  }
  if (settings.snapToObjects) {
    for (const c of snapIndex([best.o.id]).points) {
      let d = Infinity;
      for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, distToSeg(c.p, pts[i], pts[i + 1]));
      if (d < 0.5 / view.zoom) cands.push(c.p);
    }
  }
  let bd = r;
  let p = q;
  for (const c of cands) {
    const d = dist(c, q);
    if (d < bd) {
      bd = d;
      p = c;
    }
  }
  return { o: best.o, p };
}

/** ↵ while editing points: add one where the hint dot is. */
export function insertAtHint(): boolean {
  const s = store.get();
  const p = s.insertHint;
  if (!p || !editTargets().length) return false;
  const z = s.view.zoom;
  const o = editTargets().find((t) => {
    const pts = t.type === "path" ? (t.closed ? [...t.pts, t.pts[0]] : t.pts) : sampleCurve(t, 64);
    for (let i = 0; i + 1 < pts.length; i++) if (distToSeg(p, pts[i], pts[i + 1]) * z < 2) return true;
    return false;
  });
  if (!o) return false;
  store.set({ insertHint: null });
  insertNode(o, p, true);
  return true;
}

/** Double-click an anchor: smooth <-> corner (a manual anchor goes back to smooth). */
function toggleNodeMode(o: CurveObj, j: number) {
  const n = o.nodes[j];
  const mode = n.mode === "smooth" ? "corner" : "smooth";
  const nodes = o.nodes.map((x, i) => (i === j ? { p: x.p, mode } : x)) as CurveNode[];
  store.commit(store.withReplaced([{ ...o, nodes }]), { activeNode: j });
}

/** Double-click on a line/curve while editing points: add a point there. */
function insertNode(o: PathObj | CurveObj, p: Vec, exact = false) {
  if (o.type === "path") {
    const segs = pathSegments(o);
    let best = -1;
    let bd = Infinity;
    let q = p;
    segs.forEach(([a, b], i) => {
      const c = closestOnSegment(p, a, b);
      const d = dist(c, p);
      if (d < bd) {
        bd = d;
        best = i;
        q = c;
      }
    });
    if (best < 0) return;
    const pts = [...o.pts.slice(0, best + 1), exact ? p : q, ...o.pts.slice(best + 1)];
    const [a, b] = segs[best];
    const t = dist(a, exact ? p : q) / (dist(a, b) || 1);
    store.commit(store.withReplaced([{ ...o, pts, ...remapParts(o, (s) => splitParam(s, best, t)) }]), { activeNode: best + 1 });
    return;
  }
  const per = 24;
  const pts = sampleCurve(o, per);
  let bi = 0;
  let bd = Infinity;
  let q = p;
  for (let i = 0; i + 1 < pts.length; i++) {
    const c = closestOnSegment(p, pts[i], pts[i + 1]);
    const d = dist(c, p);
    if (d < bd) {
      bd = d;
      bi = i;
      q = c;
    }
  }
  const seg = Math.floor(bi / per);
  const nodes = [...o.nodes.slice(0, seg + 1), { p: exact ? p : q, mode: "smooth" as const }, ...o.nodes.slice(seg + 1)];
  const t = (bi % per + 0.5) / per;
  store.commit(store.withReplaced([{ ...o, nodes, ...remapParts(o, (s) => splitParam(s, seg, t)) }]), { activeNode: seg + 1 });
}

// Styled pieces are named by a chain parameter (piece index + t); keep them
// on the same spot when a point is added or removed.
function remapParts(o: Obj, f: (s: number) => number): { parts?: Obj["parts"]; cuts?: number[] } {
  return o.parts?.length ? { parts: o.parts.map((p) => ({ ...p, at: f(p.at) })), ...(o.cuts ? { cuts: o.cuts.map(f) } : {}) } : {};
}
/** Piece k split at t into pieces k and k+1. */
function splitParam(s: number, k: number, t: number): number {
  if (s < k) return s;
  if (s >= k + 1) return s + 1;
  const u = s - k;
  return u < t ? k + u / t : k + 1 + (u - t) / (1 - t);
}
/** Point j removed: pieces j-1 and j become one. */
function joinParam(s: number, j: number): number {
  if (j === 0) return Math.max(0, s - 1);
  if (s < j - 1) return s;
  if (s < j + 1) return j - 1 + (s - (j - 1)) / 2;
  return s - 1;
}

/** Backspace while editing points: delete the active anchor/vertex. */
export function deleteActiveNode(): boolean {
  const s = store.get();
  if (!s.pointEdit || s.activeNode === null) return false;
  const o = store.objById(s.pointEdit);
  if (!o) return false;
  const j = s.activeNode;
  if (o.type === "path") {
    if (o.pts.length <= (o.closed ? 3 : 2) || !o.pts[j]) return true;
    store.commit(store.withReplaced([{ ...o, pts: o.pts.filter((_, i) => i !== j), ...remapParts(o, (s) => joinParam(s, j)) }]), { activeNode: null });
    return true;
  }
  if (o.type === "curve") {
    if (o.nodes.length <= (o.closed ? 3 : 2) || !o.nodes[j]) return true;
    store.commit(store.withReplaced([{ ...o, nodes: o.nodes.filter((_, i) => i !== j), ...remapParts(o, (s) => joinParam(s, j)) }]), { activeNode: null });
    return true;
  }
  return false;
}
