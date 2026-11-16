import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { zoomAt, zoomToFit } from "../actions";
import { getLabel, labelBox, labelImage, labelNodeBox, labelStore } from "../labels/render";
import { geomBox, ptToCm, sub, len, unionBox, type Box } from "../model/geometry";
import type { Obj, Style, Vec } from "../model/types";
import { patternLook, xcolorCss } from "../model/xcolor";
import { marksOf } from "../model/marks";
import { strokeRuns } from "../model/height";
import { waved } from "../model/wave";
import { curvePathD, curveSegments } from "../model/curve";
import { componentPieces, piecesSvgD } from "../model/parts";
import {
  editTargets,
  getHandles,
  isPanning,
  onContextMenu,
  onDoubleClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  selectionBox,
  type PEvent,
} from "../tools/controller";
import { store, useStore } from "../store";
import { visibleGrid } from "../model/snap";

const SEL = "#2f6fed";

export function Canvas() {
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const s = useStore((x) => x);
  useSyncExternalStore(labelStore.subscribe, labelStore.version);

  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Wheel: two-finger scroll pans, pinch (ctrl+wheel) zooms at the cursor.
  useEffect(() => {
    const el = svg.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const sp = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * 0.01), sp, { w: r.width, h: r.height });
      } else {
        const v = store.get().view;
        store.set({ view: { ...v, cx: v.cx + e.deltaX / v.zoom, cy: v.cy - e.deltaY / v.zoom } });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const { view } = s;
  const z = view.zoom;
  const tx = size.w / 2 - view.cx * z;
  const ty = size.h / 2 + view.cy * z;
  const toScreen = (p: Vec) => ({ x: p.x * z + tx, y: -p.y * z + ty });

  const ev = (e: React.PointerEvent | React.MouseEvent): PEvent => {
    const r = svg.current!.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    return {
      screen: { x: sx, y: sy },
      world: { x: (sx - tx) / z, y: -(sy - ty) / z },
      shift: e.shiftKey,
      alt: e.altKey,
      meta: e.metaKey || e.ctrlKey,
      button: e.button,
    };
  };

  const selected = new Set(s.selection);
  const showSnap = s.snap && s.snap.kind !== "none" && (s.tool !== "select" || s.preview.length > 0 || s.scene !== null);

  return (
    <div className="canvas-wrap" ref={wrap}>
      <svg
        ref={svg}
        width={size.w}
        height={size.h}
        data-testid="canvas"
        className={`canvas tool-${s.tool}${isPanning() ? " panning" : ""}`}
        style={s.hoverCursor && s.tool === "select" && !isPanning() ? { cursor: s.hoverCursor } : undefined}
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          e.preventDefault(); // keep keyboard focus where we put it (e.g. the label editor)
          (e.target as Element).setPointerCapture?.(e.pointerId);
          (document.activeElement as HTMLElement | null)?.blur?.();
          onPointerDown(ev(e));
        }}
        onPointerMove={(e) => onPointerMove(ev(e))}
        onPointerUp={(e) => onPointerUp(ev(e))}
        onDoubleClick={(e) => onDoubleClick(ev(e))}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(ev(e), { x: e.clientX, y: e.clientY });
        }}
        onPointerLeave={() => store.set({ cursor: null, insertHint: null })}
      >
        {s.settings.showGrid && <Grid size={size} z={z} tx={tx} ty={ty} grid={s.settings.gridSize} />}
        {s.settings.showTextWidthGuide && <TextWidthGuide size={size} z={z} tx={tx} widthCm={s.settings.textWidthCm} />}
        <g transform={`matrix(${z},0,0,${-z},${tx},${ty})`}>
          <PatternDefs objects={[...s.scene.objects, ...s.preview]} />
          {s.scene.objects.map((o) => (
            <ObjView key={o.id} o={o} z={z} />
          ))}
          {s.preview.map((o) => (
            <ObjView key={o.id} o={o} z={z} />
          ))}
          {s.scene.objects
            .filter((o) => selected.has(o.id))
            .map((o) => (
              <Highlight key={"hl" + o.id} o={o} z={z} />
            ))}
          <PieceHighlights z={z} />
        </g>
        <SelectionOverlay toScreen={toScreen} multi={s.selection.length > 1} />
        {s.marquee && <MarqueeRect b={s.marquee} toScreen={toScreen} />}
        <Guides toScreen={toScreen} />
        {showSnap && s.snap && <SnapMark p={toScreen(s.snap.p)} kind={s.snap.kind} />}
        {s.insertHint && editTargets().length > 0 && <InsertHint p={toScreen(s.insertHint)} />}
      </svg>
      <BackToDrawing size={size} />
      <StatusBar />
    </div>
  );
}

/** When the drawing is out of sight (scrolled or zoomed away), a button
 *  that brings it back into view (the same as ⇧1). */
function BackToDrawing({ size }: { size: { w: number; h: number } }) {
  const objects = useStore((s) => s.scene.objects);
  const view = useStore((s) => s.view);
  let b: Box | null = null;
  for (const o of objects) b = unionBox(b, o.type === "label" ? labelBox(o) : geomBox(o));
  if (!b) return null;
  const z = view.zoom;
  const vw = size.w / z;
  const vh = size.h / z;
  const v = { minX: view.cx - vw / 2, maxX: view.cx + vw / 2, minY: view.cy - vh / 2, maxY: view.cy + vh / 2 };
  // Out of sight: less than half of it on screen, or too small to see.
  const ix = Math.max(0, Math.min(b.maxX, v.maxX) - Math.max(b.minX, v.minX));
  const iy = Math.max(0, Math.min(b.maxY, v.maxY) - Math.max(b.minY, v.minY));
  const w = Math.max(b.maxX - b.minX, 1e-6);
  const h = Math.max(b.maxY - b.minY, 1e-6);
  const shown = (b.maxX - b.minX < 1e-6 ? (ix > 0 || (b.minX >= v.minX && b.minX <= v.maxX) ? 1 : 0) : ix / w) * (b.maxY - b.minY < 1e-6 ? (iy > 0 || (b.minY >= v.minY && b.minY <= v.maxY) ? 1 : 0) : iy / h);
  const tiny = Math.max(w, h) * z < 24;
  if (shown >= 0.5 && !tiny) return null;
  return (
    <button className="back-to-drawing" title="Show the whole drawing (⇧1)" data-testid="back-to-drawing" onClick={() => zoomToFit(size)}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><circle cx="8" cy="8" r="4.5" /><path d="M8 1v3M8 12v3M1 8h3M12 8h3" /><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" /></svg>
      Back to the drawing
    </button>
  );
}

// ---------------------------------------------------------------- objects

function strokeProps(st: Style, z: number) {
  const w = Math.max(ptToCm(st.width), 0.75 / z);
  let dash: string | undefined;
  if (st.dash === "dashed") dash = `${ptToCm(3)} ${ptToCm(3)}`;
  if (st.dash === "dotted") dash = `${ptToCm(st.width)} ${ptToCm(2)}`;
  return {
    stroke: xcolorCss(st.stroke),
    strokeWidth: w,
    strokeDasharray: dash,
    fill: st.fill && st.pattern ? `url(#${patternId(st.pattern, st.fill)})` : xcolorCss(st.fill),
    fillOpacity: st.fill && st.opacity !== undefined && st.opacity < 1 ? st.opacity : undefined,
    strokeMiterlimit: 10,
  };
}

const patternId = (p: string, color: string) => "pat-" + (p + "-" + color).replace(/[^a-zA-Z0-9]/g, "_");

/** SVG patterns for the hatched fills in use (TikZ's patterns: 3pt apart at full strength, wider for lighter tints). */
function PatternDefs({ objects }: { objects: Obj[] }) {
  const used = new Map<string, { p: string; c: string }>();
  for (const o of objects) if (o.style.pattern && o.style.fill) used.set(patternId(o.style.pattern, o.style.fill), { p: o.style.pattern, c: o.style.fill });
  if (!used.size) return null;
  const w = ptToCm(0.4);
  return (
    <defs>
      {[...used].map(([id, { p, c }]) => {
        const look = patternLook(c);
        const col = xcolorCss(look.color);
        const t = ptToCm(look.gap);
        const line = (x1: number, y1: number, x2: number, y2: number) => <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={col} strokeWidth={w} />;
        return (
          <pattern key={id} id={id} patternUnits="userSpaceOnUse" width={t} height={t}>
            {p === "north east lines" && <>{line(-t / 2, -t / 2, t * 1.5, t * 1.5)}{line(-t / 2, t / 2, t / 2, t * 1.5)}{line(t / 2, -t / 2, t * 1.5, t / 2)}</>}
            {p === "north west lines" && <>{line(-t / 2, t * 1.5, t * 1.5, -t / 2)}{line(-t / 2, t / 2, t / 2, -t / 2)}{line(t / 2, t * 1.5, t * 1.5, t / 2)}</>}
            {p === "horizontal lines" && line(0, t / 2, t, t / 2)}
            {p === "vertical lines" && line(t / 2, 0, t / 2, t)}
            {p === "crosshatch" && <>{line(0, t / 2, t, t / 2)}{line(t / 2, 0, t / 2, t)}</>}
            {p === "dots" && <circle cx={t / 2} cy={t / 2} r={ptToCm(0.5)} fill={col} />}
          </pattern>
        );
      })}
    </defs>
  );
}

/** A TikZ-like "to" arrow tip at `tip`, pointing along `dir`. */
function ArrowTip({ tip, from, st, z }: { tip: Vec; from: Vec; st: Style; z: number }) {
  const d = sub(tip, from);
  const l = len(d);
  if (l < 1e-9) return null;
  const u = { x: d.x / l, y: d.y / l };
  const n = { x: -u.y, y: u.x };
  const lw = ptToCm(st.width);
  const L = ptToCm(2.2) + 3.5 * lw;
  const W = ptToCm(1.6) + 2.5 * lw;
  const back = { x: tip.x - u.x * L, y: tip.y - u.y * L };
  const p1 = { x: back.x + n.x * W, y: back.y + n.y * W };
  const p2 = { x: back.x - n.x * W, y: back.y - n.y * W };
  const c1 = { x: tip.x - u.x * L * 0.3 + n.x * W * 0.15, y: tip.y - u.y * L * 0.3 + n.y * W * 0.15 };
  const c2 = { x: tip.x - u.x * L * 0.3 - n.x * W * 0.15, y: tip.y - u.y * L * 0.3 - n.y * W * 0.15 };
  return (
    <path
      d={`M${p1.x},${p1.y} Q${c1.x},${c1.y} ${tip.x},${tip.y} Q${c2.x},${c2.y} ${p2.x},${p2.y}`}
      fill="none"
      stroke={xcolorCss(st.stroke)}
      strokeWidth={Math.max(lw, 0.75 / z)}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/** Arrowheads in the middle of the line (style.mid), as TikZ draws them:
 *  the tip at the mark, a second one just behind it for "two". */
function MidMarks({ o, st, z }: { o: Obj; st: Style; z: number }) {
  const marks = marksOf(o);
  if (!marks.length || !st.stroke) return null;
  const n = Math.min(2, Math.abs(st.mid ?? 0));
  const lw = ptToCm(st.width);
  const step = ptToCm(2.2) + 3.5 * lw;
  return (
    <>
      {marks.flatMap((m, i) =>
        Array.from({ length: n }, (_, k) => {
          const tip = { x: m.p.x - m.dir.x * step * 0.8 * k, y: m.p.y - m.dir.y * step * 0.8 * k };
          return <ArrowTip key={i + "-" + k} tip={tip} from={{ x: tip.x - m.dir.x, y: tip.y - m.dir.y }} st={st} z={z} />;
        }),
      )}
    </>
  );
}

/** pt per font size command (11pt document). */
const FONT_PT: Record<string, number> = { "\\tiny": 6, "\\scriptsize": 8, "\\footnotesize": 9, "\\small": 10, "": 10.95, "\\large": 12, "\\Large": 14.4, "\\LARGE": 17.28 };

/** Text along a curve. Drawn in a y-down frame so the letters stand upright. */
function CurveTextView({ o }: { o: Extract<Obj, { type: "curve" }> }) {
  const segs = curveSegments(o);
  if (!segs.length) return null;
  const f = (p: Vec) => `${p.x},${-p.y}`;
  const d = `M${f(segs[0].a)}` + segs.map((s) => ` C${f(s.c1)} ${f(s.c2)} ${f(s.b)}`).join("");
  const id = "tp-" + o.id;
  const plain = o.text!.replace(/\$/g, "").replace(/\\[a-zA-Z]+\s*/g, "").replace(/[{}|]/g, "");
  return (
    <g data-id={o.id} transform="scale(1,-1)">
      <path id={id} d={d} fill="none" stroke="none" />
      <text fontSize={ptToCm(FONT_PT[o.textFont ?? ""] ?? 10.95)} fill={xcolorCss(o.style.stroke ?? "black")} fontFamily="'Latin Modern Roman', 'CMU Serif', Georgia, serif">
        <textPath href={"#" + id} startOffset="50%" textAnchor="middle">
          {plain}
        </textPath>
      </text>
    </g>
  );
}

function ObjView({ o, z }: { o: Obj; z: number }) {
  if (o.type === "curve" && o.text)
    return (
      <g data-id={o.id}>
        <ObjView o={{ ...o, text: undefined }} z={z} />
        <CurveTextView o={o} />
      </g>
    );
  // Hidden: faint, so it can still be found and selected.
  if (o.hidden)
    return (
      <g opacity={0.22} data-hidden="1">
        <VisibleObjView o={o} z={z} />
      </g>
    );
  return <VisibleObjView o={o} z={z} />;
}

function VisibleObjView({ o, z }: { o: Obj; z: number }) {
  if ((o.parts?.length || o.cross?.length) && (o.type === "path" || o.type === "curve" || o.type === "ellipse")) return <PartedView o={o} z={z} />;
  return <NoPartsView o={o} z={z} />;
}

/** An object whose line is drawn in stretches (pieces with their own
 *  stroke, gaps where something goes over it): the fill, then each stretch
 *  with its own look, then the arrowheads. */
function PartedView({ o, z }: { o: Obj; z: number }) {
  const objects = useStore((s) => s.scene.objects);
  const sr = strokeRuns(o, objects);
  if (!sr) return <NoPartsView o={o} z={z} />;
  const { runs } = sr;
  const firstRun = runs.find((r) => r.first);
  const lastRun = runs.find((r) => r.last);
  const p0 = firstRun?.pieces[0];
  const pn = lastRun?.pieces[lastRun.pieces.length - 1];
  const dirFrom = (p: NonNullable<typeof p0>, end: boolean) => {
    const at = end ? p.b : p.a;
    return (end ? [p.c2, p.c1, p.a] : [p.c1, p.c2, p.b]).find((c) => Math.hypot(c.x - at.x, c.y - at.y) > 1e-6) ?? (end ? p.a : p.b);
  };
  return (
    <g data-id={o.id}>
      {sr.fill && <PlainObjView o={sr.fill} z={z} />}
      {runs.map((r, i) => (
        <path key={i} d={piecesSvgD(r.pieces)} {...strokeProps(r.style, z)} fill="none" data-run="1" />
      ))}
      {sr.arrowEnd && pn && lastRun!.style.stroke && <ArrowTip tip={pn.b} from={dirFrom(pn, true)} st={lastRun!.style} z={z} />}
      {sr.arrowStart && p0 && firstRun!.style.stroke && <ArrowTip tip={p0.a} from={dirFrom(p0, false)} st={firstRun!.style} z={z} />}
      <MidMarks o={o} st={{ ...o.style, dash: "solid" }} z={z} />
    </g>
  );
}

/** Drawn as if it had no pieces or crossings (a wave, or a plain line). */
function NoPartsView({ o, z }: { o: Obj; z: number }) {
  const w = waved(o);
  if (w)
    return (
      <g data-id={o.id}>
        <PlainObjView o={{ ...w, style: { ...w.style, mid: undefined } }} z={z} />
        <MidMarks o={o} st={o.style} z={z} />
      </g>
    );
  return <PlainObjView o={o} z={z} />;
}

/** The holes of a filled shape, as more SVG subpaths. */
function holesD(o: { holes?: Obj[] }): string {
  return (o.holes ?? []).map((h) => (h.type === "path" ? " " + h.pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ") + " Z" : h.type === "curve" ? " " + curvePathD(h) : "")).join("");
}

function PlainObjView({ o, z }: { o: Obj; z: number }) {
  switch (o.type) {
    case "path": {
      const d = o.pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ") + (o.closed ? " Z" : "") + holesD(o);
      const n = o.pts.length;
      return (
        <g data-id={o.id}>
          <path d={d} {...strokeProps(o.style, z)} fillRule={o.holes?.length ? "evenodd" : undefined} />
          {!o.closed && o.style.stroke && o.style.arrowEnd && n >= 2 && <ArrowTip tip={o.pts[n - 1]} from={o.pts[n - 2]} st={o.style} z={z} />}
          {!o.closed && o.style.stroke && o.style.arrowStart && n >= 2 && <ArrowTip tip={o.pts[0]} from={o.pts[1]} st={o.style} z={z} />}
          <MidMarks o={o} st={o.style} z={z} />
        </g>
      );
    }
    case "curve": {
      const segs = curveSegments(o);
      const closed = o.closed && o.nodes.length >= 3;
      const first = segs[0];
      const last = segs[segs.length - 1];
      const tipFrom = (s: typeof last, end: boolean) => {
        // Direction of the curve at its end: towards the nearest distinct control point
        const cands = end ? [s.c2, s.c1, s.a] : [s.c1, s.c2, s.b];
        const at = end ? s.b : s.a;
        return cands.find((c) => Math.hypot(c.x - at.x, c.y - at.y) > 1e-6) ?? (end ? s.a : s.b);
      };
      return (
        <g data-id={o.id}>
          <path d={curvePathD(o) + holesD(o)} {...strokeProps(o.style, z)} fillRule={o.holes?.length ? "evenodd" : undefined} />
          {!closed && last && o.style.stroke && o.style.arrowEnd && <ArrowTip tip={last.b} from={tipFrom(last, true)} st={o.style} z={z} />}
          {!closed && first && o.style.stroke && o.style.arrowStart && <ArrowTip tip={first.a} from={tipFrom(first, false)} st={o.style} z={z} />}
          <MidMarks o={o} st={o.style} z={z} />
        </g>
      );
    }
    case "ellipse": {
      const el = <ellipse data-id={o.id} cx={0} cy={0} rx={o.rx} ry={o.ry} transform={`translate(${o.c.x},${o.c.y}) rotate(${o.rot})`} {...strokeProps(o.style, z)} />;
      if (!o.style.mid) return el;
      return (
        <g data-id={o.id}>
          {el}
          <MidMarks o={o} st={o.style} z={z} />
        </g>
      );
    }
    case "point":
      return <circle data-id={o.id} cx={o.p.x} cy={o.p.y} r={ptToCm(o.size)} fill={xcolorCss(o.style.stroke ?? "black")} />;
    case "label":
      return <LabelView o={o} z={z} />;
  }
}

function LabelView({ o, z }: { o: Extract<Obj, { type: "label" }>; z: number }) {
  const editing = useStore((s) => s.editingLabel === o.id);
  const e = getLabel(o);
  const b = labelNodeBox(o);
  if (!e || !b) {
    // Empty label: show where it is while it's being edited.
    if (!editing) return null;
    const s = 6 / z;
    return <rect x={o.p.x - s} y={o.p.y - s} width={2 * s} height={2 * s} fill="none" stroke={SEL} strokeWidth={1 / z} strokeDasharray={`${3 / z} ${2 / z}`} />;
  }
  if (e.status === "ok") {
    const url = labelImage(e, z);
    return (
      <g data-id={o.id} transform={`translate(${b.minX},${b.maxY}) scale(1,-1)`}>
        {o.bg && <rect x={0} y={0} width={b.maxX - b.minX} height={b.maxY - b.minY} fill="white" />}
        {url && <image href={url} x={0} y={0} width={b.maxX - b.minX} height={b.maxY - b.minY} preserveAspectRatio="none" />}
      </g>
    );
  }
  const err = e.status === "error";
  return (
    <g data-id={o.id} transform={`translate(${o.p.x},${o.p.y}) scale(${1 / z},${-1 / z})`}>
      <text x={0} y={4} textAnchor="middle" fontSize={12} fill={err ? "#c62828" : "#999"} fontFamily="ui-monospace, Menlo, monospace">
        {err ? "⚠ " : ""}
        {o.text}
      </text>
    </g>
  );
}

function Highlight({ o, z }: { o: Obj; z: number }) {
  const w = 1.5 / z;
  switch (o.type) {
    case "curve":
      return <path d={curvePathD(o)} fill="none" stroke={SEL} strokeWidth={w} opacity={0.7} pointerEvents="none" />;
    case "path": {
      const d = o.pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ") + (o.closed ? " Z" : "");
      return <path d={d} fill="none" stroke={SEL} strokeWidth={w} opacity={0.7} pointerEvents="none" />;
    }
    case "ellipse":
      return (
        <ellipse
          cx={0}
          cy={0}
          rx={o.rx}
          ry={o.ry}
          transform={`translate(${o.c.x},${o.c.y}) rotate(${o.rot})`}
          fill="none"
          stroke={SEL}
          strokeWidth={w}
          opacity={0.7}
          pointerEvents="none"
        />
      );
    case "point":
      return <circle cx={o.p.x} cy={o.p.y} r={ptToCm(o.size) + 3 / z} fill="none" stroke={SEL} strokeWidth={w} />;
    case "label": {
      const b = labelBox(o);
      if (!b) return null;
      return <rect x={b.minX} y={b.minY} width={b.maxX - b.minX} height={b.maxY - b.minY} fill="none" stroke={SEL} strokeWidth={w} opacity={0.7} />;
    }
  }
}

/** Pieces picked in the panel (blue band) and the one under the mouse there (orange). */
function PieceHighlights({ z }: { z: number }) {
  const sel = useStore((s) => s.pieceSel);
  const hover = useStore((s) => s.pieceHover);
  const objects = useStore((s) => s.scene.objects);
  const out: React.ReactElement[] = [];
  const band = (id: string, at: number, color: string, key: string) => {
    const o = objects.find((x) => x.id === id);
    if (!o) return;
    const d = piecesSvgD(componentPieces(o, objects, at));
    if (d) out.push(<path key={key} d={d} fill="none" stroke={color} strokeWidth={6 / z} strokeLinecap="round" opacity={0.35} pointerEvents="none" data-testid="piece-highlight" />);
  };
  sel?.ats.forEach((at, i) => band(sel.id, at, SEL, "s" + i));
  if (hover) band(hover.id, hover.at, "#e8590c", "h");
  return <>{out}</>;
}

// ---------------------------------------------------------------- overlays

function SelectionOverlay({ toScreen, multi }: { toScreen: (p: Vec) => Vec; multi: boolean }) {
  const pointEdit = useStore((s) => s.pointEdit);
  const activeNode = useStore((s) => s.activeNode);
  const editObj = useStore((s) => (s.pointEdit ? s.scene.objects.find((o) => o.id === s.pointEdit) : undefined));
  useStore((s) => s.scene);
  useStore((s) => s.selection);
  useStore((s) => s.preview);
  const handles = getHandles();
  // The box is drawn whenever it has handles (a single object too: the rotate
  // knob and edge handles sit on it).
  const b = multi || handles.some((h) => h.kind === "box") ? selectionBox() : null;
  return (
    <g pointerEvents="none">
      {b && <MarqueeRect b={b} toScreen={toScreen} dashed />}
      {handles.map((h, i) => {
        if ((h.kind !== "control" && h.kind !== "rotate") || !h.from) return null;
        const p = toScreen(h.p);
        const a = toScreen(h.from);
        return <line key={"l" + i} x1={a.x} y1={a.y} x2={p.x} y2={p.y} stroke={SEL} strokeWidth={1} opacity={0.6} />;
      })}
      {handles.map((h, i) => {
        const p = toScreen(h.p);
        if (h.kind === "rotate") return <circle key={i} cx={p.x} cy={p.y} r={4.5} fill="white" stroke={SEL} strokeWidth={1.5} data-testid="rotate-handle" />;
        // On one of the object's points: grabs the object there (a circle, like the other points).
        if (h.kind === "grab") return <circle key={i} cx={p.x} cy={p.y} r={4.5} fill="white" stroke={SEL} strokeWidth={1.5} data-testid="grab-handle" />;
        if (h.kind === "edge") return <rect key={i} x={p.x - 3.5} y={p.y - 3.5} width={7} height={7} fill="white" stroke={SEL} strokeWidth={1.5} data-testid="edge-handle" />;
        if (h.kind === "control") return <rect key={i} x={p.x - 3.5} y={p.y - 3.5} width={7} height={7} fill={SEL} stroke="white" strokeWidth={1} transform={`rotate(45 ${p.x} ${p.y})`} data-testid="control-handle" />;
        const obj = h.id === editObj?.id ? editObj : h.id ? store.objById(h.id) : undefined;
        const nodeIndex = obj?.type === "curve" ? Math.floor(h.handle / 3) : h.handle;
        const active = !!pointEdit && activeNode === nodeIndex && obj?.type !== "ellipse";
        const corner = obj?.type === "curve" && obj.nodes[nodeIndex]?.mode === "corner";
        return h.kind === "anchor" ? (
          corner ? (
            <rect key={i} x={p.x - 4} y={p.y - 4} width={8} height={8} fill={active ? SEL : "white"} stroke={SEL} strokeWidth={1.5} data-testid="vertex-handle" />
          ) : (
            <circle key={i} cx={p.x} cy={p.y} r={4.5} fill={active ? SEL : "white"} stroke={SEL} strokeWidth={1.5} data-testid="vertex-handle" />
          )
        ) : (
          <rect key={i} x={p.x - 4} y={p.y - 4} width={8} height={8} fill="white" stroke={SEL} strokeWidth={1.5} data-testid="scale-handle" />
        );
      })}
    </g>
  );
}

function MarqueeRect({ b, toScreen, dashed }: { b: Box; toScreen: (p: Vec) => Vec; dashed?: boolean }) {
  const a = toScreen({ x: b.minX, y: b.maxY });
  const c = toScreen({ x: b.maxX, y: b.minY });
  return (
    <rect
      x={a.x}
      y={a.y}
      width={c.x - a.x}
      height={c.y - a.y}
      fill={dashed ? "none" : "rgba(47,111,237,0.08)"}
      stroke={SEL}
      strokeWidth={1}
      strokeDasharray={dashed ? "4 3" : undefined}
      pointerEvents="none"
    />
  );
}

/** Where a double-click adds a point. */
function InsertHint({ p }: { p: Vec }) {
  return (
    <g pointerEvents="none" data-testid="insert-hint">
      <circle cx={p.x} cy={p.y} r={4.5} fill="white" stroke={SEL} strokeWidth={1.5} strokeDasharray="2 1.5" />
      <circle cx={p.x} cy={p.y} r={1.5} fill={SEL} />
    </g>
  );
}

function SnapMark({ p, kind }: { p: Vec; kind: string }) {
  // Big enough to show around the tip of the mouse pointer.
  if (kind === "grid" || kind === "angle" || kind === "guide") return <circle cx={p.x} cy={p.y} r={4} fill={SEL} stroke="white" strokeWidth={1.5} pointerEvents="none" data-testid="snap-dot" />;
  return (
    <g pointerEvents="none">
      <rect x={p.x - 5} y={p.y - 5} width={10} height={10} fill="none" stroke="#e8590c" strokeWidth={1.5} transform={kind === "intersection" ? `rotate(45 ${p.x} ${p.y})` : undefined} />
      <text x={p.x + 9} y={p.y - 8} fontSize={10.5} fill="#e8590c" fontFamily="system-ui, sans-serif">
        {kind.replace("-", " ")}
      </text>
    </g>
  );
}

function Grid({ size, z, tx, ty, grid }: { size: { w: number; h: number }; z: number; tx: number; ty: number; grid: number }) {
  const g = visibleGrid(grid, z);
  const lines: React.ReactElement[] = [];
  const x0 = Math.floor(-tx / z / g) * g;
  const x1 = (size.w - tx) / z;
  const y0 = Math.floor((ty - size.h) / z / g) * g;
  const y1 = ty / z;
  const major = (v: number) => Math.abs(v - Math.round(v)) < 1e-6; // whole cm
  for (let x = x0; x <= x1; x += g) {
    const sx = Math.round(x * z + tx) + 0.5;
    lines.push(<line key={"x" + x.toFixed(4)} x1={sx} x2={sx} y1={0} y2={size.h} stroke={major(x) ? "#dfe3ea" : "#f0f2f5"} />);
  }
  for (let y = y0; y <= y1; y += g) {
    const sy = Math.round(-y * z + ty) + 0.5;
    lines.push(<line key={"y" + y.toFixed(4)} x1={0} x2={size.w} y1={sy} y2={sy} stroke={major(y) ? "#dfe3ea" : "#f0f2f5"} />);
  }
  return <g pointerEvents="none">{lines}</g>;
}

function TextWidthGuide({ size, z, tx, widthCm }: { size: { w: number; h: number }; z: number; tx: number; widthCm: number }) {
  // Fixed while you draw (set when the figure is opened).
  const cx = useStore((s) => s.guideCx);
  const xs = [cx - widthCm / 2, cx + widthCm / 2].map((x) => x * z + tx);
  return (
    <g pointerEvents="none">
      {xs.map((x, i) => (
        <line key={i} x1={x} x2={x} y1={0} y2={size.h} stroke="#c9a227" strokeDasharray="6 4" />
      ))}
      <text x={xs[0] + 6} y={16} fontSize={11} fill="#a07f10" fontFamily="system-ui, sans-serif">
        text width ({widthCm} cm)
      </text>
    </g>
  );
}

/** Smart guides: alignment, equal spacing and symmetry found while snapping. */
function Guides({ toScreen }: { toScreen: (p: Vec) => Vec }) {
  const guides = useStore((s) => s.guides);
  if (!guides.length) return null;
  const C = "#e0368c";
  return (
    <g pointerEvents="none" data-testid="guides">
      {guides.map((g, i) => {
        const a = toScreen(g.a);
        const b = toScreen(g.b);
        if (g.kind === "spacing") {
          // A measured gap: a line with end ticks.
          const d = sub(b, a);
          const l = len(d) || 1;
          const n = { x: (-d.y / l) * 4, y: (d.x / l) * 4 };
          return (
            <g key={i} stroke={C} strokeWidth={1}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              <line x1={a.x - n.x} y1={a.y - n.y} x2={a.x + n.x} y2={a.y + n.y} />
              <line x1={b.x - n.x} y1={b.y - n.y} x2={b.x + n.x} y2={b.y + n.y} />
            </g>
          );
        }
        return (
          <g key={i}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={C} strokeWidth={1} strokeDasharray={g.kind === "symmetry" ? "5 3" : undefined} />
            {(g.marks ?? []).map((m, k) => {
              const q = toScreen(m);
              return <path key={k} d={`M${q.x - 3},${q.y - 3}L${q.x + 3},${q.y + 3}M${q.x - 3},${q.y + 3}L${q.x + 3},${q.y - 3}`} stroke={C} strokeWidth={1.2} />;
            })}
          </g>
        );
      })}
    </g>
  );
}

function StatusBar() {
  const cursor = useStore((s) => s.cursor);
  const zoom = useStore((s) => s.view.zoom);
  const snap = useStore((s) => s.snap);
  const message = useStore((s) => s.message);
  const tool = useStore((s) => s.tool);
  // What is being edited: its points (a curve, a polygon) or its radii (an ellipse).
  const editing = useStore((s) => {
    const o = s.pointEdit ? s.scene.objects.find((x) => x.id === s.pointEdit) : undefined;
    if (o) return o.type;
    return s.showControls && s.tool === "select" && s.scene.objects.some((x) => x.type === "curve" && s.selection.includes(x.id)) ? "curve" : null;
  });
  const hint =
    editing === "ellipse"
      ? "Drag a dot to change that radius"
      : editing === "path"
        ? "↵ adds a point at the dot on the line · ⌫ deletes one"
      : editing
      ? "↵ adds a point at the dot on the line · ⌫ deletes one · ⇧-drag mirrors"
      : tool === "polyline" || tool === "curve"
        ? "↵ to finish · click the first point to close"
        : tool === "fill"
          ? "Click inside a closed region to fill it"
        : tool === "trim"
          ? "Click a piece to cut it away, or drag across pieces"
          : tool === "select" || tool === "sketch" || tool === "text" || tool === "point"
          ? ""
          : "⇧ constrains · ⌥ turns off snapping";
  return (
    <div className="statusbar">
      <span className="zoom">{Math.round((zoom / (96 / 2.54)) * 100)}%</span>
      <span className="coords" data-testid="coords">{cursor ? `(${cursor.x.toFixed(2)}, ${cursor.y.toFixed(2)}) cm` : ""}</span>
      {snap && snap.kind !== "none" && <span className="muted">snap: {snap.kind}</span>}
      <span className="muted grow" data-testid="hint">{hint}</span>
      {message && <span className="message">{message}</span>}
    </div>
  );
}

