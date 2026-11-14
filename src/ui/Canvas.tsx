import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { zoomAt } from "../actions";
import { getLabel, labelBox, labelImage, labelStore } from "../labels/render";
import { ptToCm, sceneGeomBox, sub, len, type Box } from "../model/geometry";
import type { Obj, Style, Vec } from "../model/types";
import { xcolorCss } from "../model/xcolor";
import { curvePathD, curveSegments } from "../model/curve";
import {
  getHandles,
  isPanning,
  onDoubleClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  selectionBox,
  type PEvent,
} from "../tools/controller";
import { store, useStore } from "../store";

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
        onPointerLeave={() => store.set({ cursor: null })}
      >
        {s.settings.showGrid && <Grid size={size} z={z} tx={tx} ty={ty} grid={s.settings.gridSize} />}
        {s.settings.showTextWidthGuide && <TextWidthGuide size={size} z={z} tx={tx} widthCm={s.settings.textWidthCm} />}
        <g transform={`matrix(${z},0,0,${-z},${tx},${ty})`}>
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
        </g>
        <SelectionOverlay toScreen={toScreen} multi={s.selection.length > 1} />
        {s.marquee && <MarqueeRect b={s.marquee} toScreen={toScreen} />}
        {showSnap && s.snap && <SnapMark p={toScreen(s.snap.p)} kind={s.snap.kind} />}
      </svg>
      <StatusBar />
    </div>
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
    fill: xcolorCss(st.fill),
    strokeMiterlimit: 10,
  };
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

function ObjView({ o, z }: { o: Obj; z: number }) {
  switch (o.type) {
    case "path": {
      const d = o.pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ") + (o.closed ? " Z" : "");
      const n = o.pts.length;
      return (
        <g data-id={o.id}>
          <path d={d} {...strokeProps(o.style, z)} />
          {!o.closed && o.style.stroke && o.style.arrowEnd && n >= 2 && <ArrowTip tip={o.pts[n - 1]} from={o.pts[n - 2]} st={o.style} z={z} />}
          {!o.closed && o.style.stroke && o.style.arrowStart && n >= 2 && <ArrowTip tip={o.pts[0]} from={o.pts[1]} st={o.style} z={z} />}
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
          <path d={curvePathD(o)} {...strokeProps(o.style, z)} />
          {!closed && last && o.style.stroke && o.style.arrowEnd && <ArrowTip tip={last.b} from={tipFrom(last, true)} st={o.style} z={z} />}
          {!closed && first && o.style.stroke && o.style.arrowStart && <ArrowTip tip={first.a} from={tipFrom(first, false)} st={o.style} z={z} />}
        </g>
      );
    }
    case "ellipse":
      return (
        <ellipse
          data-id={o.id}
          cx={0}
          cy={0}
          rx={o.rx}
          ry={o.ry}
          transform={`translate(${o.c.x},${o.c.y}) rotate(${o.rot})`}
          {...strokeProps(o.style, z)}
        />
      );
    case "point":
      return <circle data-id={o.id} cx={o.p.x} cy={o.p.y} r={ptToCm(o.size)} fill={xcolorCss(o.style.stroke ?? "black")} />;
    case "label":
      return <LabelView o={o} z={z} />;
  }
}

function LabelView({ o, z }: { o: Extract<Obj, { type: "label" }>; z: number }) {
  const editing = useStore((s) => s.editingLabel === o.id);
  const e = getLabel(o);
  const b = labelBox(o);
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

// ---------------------------------------------------------------- overlays

function SelectionOverlay({ toScreen, multi }: { toScreen: (p: Vec) => Vec; multi: boolean }) {
  const pointEdit = useStore((s) => s.pointEdit);
  const activeNode = useStore((s) => s.activeNode);
  const editObj = useStore((s) => (s.pointEdit ? s.scene.objects.find((o) => o.id === s.pointEdit) : undefined));
  useStore((s) => s.scene);
  useStore((s) => s.selection);
  const handles = getHandles();
  const b = multi ? selectionBox() : null;
  return (
    <g pointerEvents="none">
      {b && <MarqueeRect b={b} toScreen={toScreen} dashed />}
      {handles.map((h, i) => {
        if (h.kind !== "control" || !h.from) return null;
        const p = toScreen(h.p);
        const a = toScreen(h.from);
        return <line key={"l" + i} x1={a.x} y1={a.y} x2={p.x} y2={p.y} stroke={SEL} strokeWidth={1} opacity={0.6} />;
      })}
      {handles.map((h, i) => {
        const p = toScreen(h.p);
        if (h.kind === "control") return <rect key={i} x={p.x - 3.5} y={p.y - 3.5} width={7} height={7} fill={SEL} stroke="white" strokeWidth={1} transform={`rotate(45 ${p.x} ${p.y})`} data-testid="control-handle" />;
        const nodeIndex = editObj?.type === "curve" ? Math.floor(h.handle / 3) : h.handle;
        const active = activeNode === nodeIndex && editObj?.type !== "ellipse";
        const corner = editObj?.type === "curve" && editObj.nodes[nodeIndex]?.mode === "corner";
        return pointEdit ? (
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

function SnapMark({ p, kind }: { p: Vec; kind: string }) {
  if (kind === "grid" || kind === "angle") return <circle cx={p.x} cy={p.y} r={2.5} fill={SEL} pointerEvents="none" />;
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
  let g = grid;
  while (g * z < 8) g *= 2;
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
  const scene = useStore((s) => s.scene);
  const b = sceneGeomBox(scene.objects);
  const cx = b ? (b.minX + b.maxX) / 2 : 0;
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

function StatusBar() {
  const cursor = useStore((s) => s.cursor);
  const zoom = useStore((s) => s.view.zoom);
  const snap = useStore((s) => s.snap);
  const message = useStore((s) => s.message);
  const tool = useStore((s) => s.tool);
  const pointEdit = useStore((s) => s.pointEdit);
  const hint =
    pointEdit
      ? "Drag points · double-click the line to add a point · Backspace deletes · Esc: done"
      : tool === "polyline" || tool === "curve"
        ? "Click to add points · click the first point to close · Enter or double-click to finish"
        : tool === "sketch"
          ? "Draw roughly; it becomes a smooth curve or a clean shape"
        : tool === "select"
          ? ""
          : "Shift: 15° angles / squares · Alt: no snapping · Esc: cancel";
  return (
    <div className="statusbar">
      <span>{Math.round((zoom / (96 / 2.54)) * 100)}%</span>
      {cursor && (
        <span>
          ({cursor.x.toFixed(2)}, {cursor.y.toFixed(2)}) cm
        </span>
      )}
      {snap && snap.kind !== "none" && <span className="muted">snap: {snap.kind}</span>}
      <span className="muted grow">{hint}</span>
      {message && <span className="message">{message}</span>}
    </div>
  );
}

