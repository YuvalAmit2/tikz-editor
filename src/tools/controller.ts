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
import { buildSnapIndex, snap, type SnapIndex, type SnapResult } from "../model/snap";
import { newId, type CurveNode, type CurveObj, type EllipseObj, type Obj, type PathObj, type Scene, type Vec } from "../model/types";
import { nodeHandles, sampleCurve } from "../model/curve";
import { processStroke } from "../model/sketch";
import { closestOnSegment, pathSegments } from "../model/geometry";
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
  | { kind: "scale"; fixed: Vec; corner: Vec; before: Scene; orig: Obj[] }
  | { kind: "handle"; id: string; handle: number; before: Scene; orig: Obj; handles?: { hin: Vec | null; hout: Vec | null }[] }
  | { kind: "draw"; downScreen: Vec; start: Vec }
  | { kind: "curveNode"; index: number; downScreen: Vec }
  | { kind: "sketch"; pts: Vec[] };

let drag: Drag = { kind: "none" };
/** Points placed so far by a drawing tool (click-click mode / polyline). */
let draft: Vec[] = [];
/** Anchors placed so far by the curve tool. */
let cdraft: CurveNode[] = [];
let spaceDown = false;

const currentDrag = (): Drag => drag;
export const setSpaceDown = (d: boolean) => (spaceDown = d);
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
  kind: "box" | "anchor" | "control";
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

export function getHandles(): Handle[] {
  const s = store.get();
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
    if (o.type === "curve") {
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
    return [];
  }
  const sel = store.selected();
  if (sel.length === 0 || (sel.length === 1 && (sel[0].type === "label" || sel[0].type === "point"))) return [];
  const b = selectionBox();
  if (!b || (b.maxX - b.minX < 1e-9 && b.maxY - b.minY < 1e-9)) return [];
  return [
    { id: "", kind: "box", handle: 0, p: { x: b.minX, y: b.minY } },
    { id: "", kind: "box", handle: 1, p: { x: b.maxX, y: b.minY } },
    { id: "", kind: "box", handle: 2, p: { x: b.maxX, y: b.maxY } },
    { id: "", kind: "box", handle: 3, p: { x: b.minX, y: b.maxY } },
  ];
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

function objectAt(p: Vec): Obj | null {
  const { scene, view } = store.get();
  const tol = 6 / view.zoom;
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
      return { id, type: "path", style, pts: [a, b], closed: false };
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
    const o: PathObj = { id: newId(), type: "path", style: { ...store.get().style }, pts: draft, closed: close && draft.length >= 3 };
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
    const o: CurveObj = { id: newId(), type: "curve", style: { ...store.get().style }, nodes: cdraft, closed: close && cdraft.length >= 3 };
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
  const style = { ...s.style };
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

// ---------------------------------------------------------------- events

export function onPointerDown(e: PEvent) {
  const s = store.get();
  if (e.button === 1 || spaceDown || (e.button === 0 && s.tool === "select" && e.meta && false)) {
    drag = { kind: "pan", startScreen: e.screen, startView: { cx: s.view.cx, cy: s.view.cy } };
    return;
  }
  if (e.button !== 0) return;

  if (s.tool === "select") return selectDown(e);

  if (s.tool === "sketch") {
    drag = { kind: "sketch", pts: [e.world] };
    return;
  }

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
  if (h) {
    if (h.id === "") {
      const b = selectionBox()!;
      const corners = [
        { x: b.minX, y: b.minY },
        { x: b.maxX, y: b.minY },
        { x: b.maxX, y: b.maxY },
        { x: b.minX, y: b.maxY },
      ];
      drag = { kind: "scale", corner: corners[h.handle], fixed: corners[(h.handle + 2) % 4], before: s.scene, orig: store.selected() };
    } else {
      const orig = store.objById(h.id)!;
      drag = { kind: "handle", id: h.id, handle: h.handle, before: s.scene, orig, handles: orig.type === "curve" ? nodeHandles(orig) : undefined };
      if (h.kind === "anchor" && orig.type !== "ellipse") store.set({ activeNode: orig.type === "curve" ? Math.floor(h.handle / 3) : h.handle });
    }
    return;
  }
  const hit = objectAt(e.world);
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
  store.set({ selection, editingLabel: hit.type === "label" && selection.length === 1 ? hit.id : null });
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

export function onPointerMove(e: PEvent) {
  const s = store.get();
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
    case "scale": {
      const sr = doSnap(e.world, e, { exclude: drag.orig.map((o) => o.id) });
      const f = drag.fixed;
      const c0 = drag.corner;
      let sx = Math.abs(c0.x - f.x) < 1e-9 ? 1 : (sr.p.x - f.x) / (c0.x - f.x);
      let sy = Math.abs(c0.y - f.y) < 1e-9 ? 1 : (sr.p.y - f.y) / (c0.y - f.y);
      if (e.shift) {
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
    case "sketch": {
      drag.pts.push(e.world);
      store.set({ preview: [{ id: "__draft", type: "path", style: { ...s.style, fill: null, arrowStart: false, arrowEnd: false, dash: "solid" }, pts: drag.pts.slice(), closed: false }] });
      return;
    }
    case "handle": {
      const o = drag.orig;
      if (o.type === "curve") {
        const j = Math.floor(drag.handle / 3);
        const k = drag.handle % 3;
        const node = o.nodes[j];
        let next: CurveNode;
        if (k === 0) {
          const prev = o.nodes[j - 1]?.p ?? (o.closed ? o.nodes[o.nodes.length - 1].p : null);
          const sr = doSnap(e.world, e, { exclude: [o.id], from: prev });
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
        store.preview(store.withReplaced([{ ...o, nodes }], drag.before));
        return;
      }
      if (o.type === "path") {
        const prev = o.pts[(drag.handle - 1 + o.pts.length) % o.pts.length];
        const sr = doSnap(e.world, e, { exclude: [o.id], from: drag.handle > 0 || o.closed ? prev : null });
        const pts = o.pts.map((p, i) => (i === drag.handle ? sr.p : p));
        store.set({ snap: sr });
        store.preview(store.withReplaced([{ ...o, pts }], drag.before));
      } else if (o.type === "ellipse") {
        const sr = doSnap(e.world, e, { exclude: [o.id] });
        const el = o as EllipseObj;
        const r = (el.rot * Math.PI) / 180;
        const axis = drag.handle === 0 ? { x: Math.cos(r), y: Math.sin(r) } : { x: -Math.sin(r), y: Math.cos(r) };
        const d = sub(sr.p, el.c);
        let val = Math.abs(d.x * axis.x + d.y * axis.y);
        // Circles stay circles unless Shift is held.
        const circle = Math.abs(el.rx - el.ry) < 1e-9 && !e.shift;
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
    else if (draft.length === 1) {
      const o = buildShape(s.tool, draft[0], sr.p, e.shift);
      preview = o ? [o] : [];
    }
    store.set({ snap: sr, preview });
  } else if (s.snap) store.set({ snap: null });
}

export function onPointerUp(e: PEvent) {
  const s = store.get();
  const d = drag;
  drag = { kind: "none" };
  switch (d.kind) {
    case "move":
      if (d.moved) store.commit(s.scene, { snap: null }, d.before);
      return;
    case "scale":
    case "handle":
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
  if (s.tool === "select" && s.pointEdit) {
    const o = store.objById(s.pointEdit);
    if (o && (o.type === "curve" || o.type === "path")) {
      const h = handleAt(e);
      if (h && h.kind === "anchor" && o.type === "curve") return toggleNodeMode(o, Math.floor(h.handle / 3));
      if (!h && hitDistance(o, e.world, lbox) * s.view.zoom < 6) return insertNode(o, e.world);
    }
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

/** Double-click an anchor: smooth <-> corner (a manual anchor goes back to smooth). */
function toggleNodeMode(o: CurveObj, j: number) {
  const n = o.nodes[j];
  const mode = n.mode === "smooth" ? "corner" : "smooth";
  const nodes = o.nodes.map((x, i) => (i === j ? { p: x.p, mode } : x)) as CurveNode[];
  store.commit(store.withReplaced([{ ...o, nodes }]), { activeNode: j });
}

/** Double-click on a line/curve while editing points: add a point there. */
function insertNode(o: PathObj | CurveObj, p: Vec) {
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
    const pts = [...o.pts.slice(0, best + 1), q, ...o.pts.slice(best + 1)];
    store.commit(store.withReplaced([{ ...o, pts }]), { activeNode: best + 1 });
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
  const nodes = [...o.nodes.slice(0, seg + 1), { p: q, mode: "smooth" as const }, ...o.nodes.slice(seg + 1)];
  store.commit(store.withReplaced([{ ...o, nodes }]), { activeNode: seg + 1 });
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
    store.commit(store.withReplaced([{ ...o, pts: o.pts.filter((_, i) => i !== j) }]), { activeNode: null });
    return true;
  }
  if (o.type === "curve") {
    if (o.nodes.length <= (o.closed ? 3 : 2) || !o.nodes[j]) return true;
    store.commit(store.withReplaced([{ ...o, nodes: o.nodes.filter((_, i) => i !== j) }]), { activeNode: null });
    return true;
  }
  return false;
}
