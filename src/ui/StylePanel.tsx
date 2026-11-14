import { applyProps, applyStyle, deleteSelection, saveSettings, smartLabel } from "../actions";
import { saveSelectionToLibrary } from "../library";
import { useState } from "react";
import { FONT_SIZES, LINE_WIDTHS, type Obj, type Style } from "../model/types";
import { componentAt, componentNames, components, componentStyles } from "../model/parts";
import { PALETTE, TINTS, xcolorCss } from "../model/xcolor";
import { askText, store, useStore } from "../store";

/** "blue!30" -> ["blue", 30]; "green!60!black" -> ["green!60!black", 100] */
function splitTint(c: string | null): [string | null, number] {
  if (!c) return [null, 100];
  for (const base of PALETTE) {
    if (c === base) return [base, 100];
    const m = c.match(new RegExp(`^${base.replace(/[!]/g, "\\!")}!(\\d+)$`));
    if (m) return [base, parseInt(m[1])];
  }
  return [c, 100];
}
const withTint = (base: string, tint: number) => (tint >= 100 ? base : `${base}!${tint}`);

function Swatches({ value, onPick, allowNone, testid }: { value: string | null; onPick: (c: string | null) => void; allowNone?: boolean; testid: string }) {
  return (
    <div className="swatches" data-testid={testid}>
      {allowNone && (
        <button className={"swatch none" + (value === null ? " active" : "")} title="None" onClick={() => onPick(null)}>
          <svg width="18" height="18"><path d="M3 15L15 3" stroke="#d33" strokeWidth="1.5" /></svg>
        </button>
      )}
      {PALETTE.map((c) => (
        <button key={c} className={"swatch" + (value === c ? " active" : "")} title={c} onClick={() => onPick(c)}>
          <span style={{ background: xcolorCss(c) }} />
        </button>
      ))}
    </div>
  );
}

function Seg<T extends string | number | boolean>({ options, value, onPick }: { options: { v: T; label: React.ReactNode; title?: string }[]; value: T | undefined; onPick: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.v)} title={o.title} className={value === o.v ? "active" : ""} onClick={() => onPick(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The pieces of an object (between its crossings with other objects), or
 *  null when it has fewer than two. */
function piecesOf(o: Obj, objects: Obj[]) {
  if (o.type !== "path" && o.type !== "curve" && o.type !== "ellipse") return null;
  const { chain, comps } = components(o, objects);
  if (!chain || comps.length < 2) return null;
  const n = chain.pieces.length;
  const names = componentNames(o, chain, comps);
  const styles = componentStyles(o, comps, n);
  const index = (at: number) => componentAt(comps, at, n);
  return {
    list: comps.map((c, k) => ({ at: c.mid % n, name: names[k], style: styles[k] })),
    index,
    nameAt: (at: number) => names[index(at)] ?? "piece",
    styleAt: (at: number) => styles[index(at)] ?? o.style,
  };
}

let piecesOpen = false;

/** A small, collapsible list of the object's pieces. Picking some makes the
 *  stroke settings below apply to just those. */
function PiecesSection({ id, pieces, picked }: { id: string; pieces: NonNullable<ReturnType<typeof piecesOf>>; picked: number[] }) {
  const [open, setOpen] = useState(piecesOpen);
  const pickedIdx = new Set(picked.map(pieces.index));
  const toggle = (at: number) => {
    const k = pieces.index(at);
    const next = pickedIdx.has(k) ? picked.filter((a) => pieces.index(a) !== k) : [...picked, at];
    store.set({ pieceSel: next.length ? { id, ats: next } : null });
  };
  return (
    <section className="pieces">
      <button
        className="pieces-head"
        onClick={() => {
          piecesOpen = !open;
          setOpen(!open);
          if (open) store.set({ pieceSel: null, pieceHover: null });
        }}
        data-testid="pieces-toggle"
        title="The pieces between where other lines cross this one. Pick some to style just them."
      >
        <span className={"caret" + (open ? " open" : "")}>▸</span> Pieces <span className="muted">{pieces.list.length}</span>
      </button>
      {open && (
        <div className="piece-list" onMouseLeave={() => store.set({ pieceHover: null })}>
          {pieces.list.map((p, k) => (
            <button
              key={k}
              className={"piece" + (pickedIdx.has(k) ? " active" : "")}
              onClick={() => toggle(p.at)}
              onMouseEnter={() => store.set({ pieceHover: { id, at: p.at } })}
              data-testid="piece"
            >
              <svg width="22" height="10">
                <line x1="2" x2="20" y1="5" y2="5" stroke={xcolorCss(p.style.stroke) ?? "#bbb"} strokeWidth={Math.max(1, Math.min(3, p.style.width * 2.2))} strokeDasharray={p.style.dash === "dashed" ? "4 3" : p.style.dash === "dotted" ? "1.2 2.4" : undefined} strokeLinecap="round" />
              </svg>
              {p.name}
            </button>
          ))}
          {picked.length > 0 && (
            <button className="piece clear" onClick={() => store.set({ pieceSel: null })} title="Style the whole object again">
              whole
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function StylePanel() {
  const sel = useStore((s) => s.selection);
  const scene = useStore((s) => s.scene);
  const current = useStore((s) => s.style);
  const tool = useStore((s) => s.tool);
  const objs = scene.objects.filter((o) => sel.includes(o.id));
  const pieceSel = useStore((s) => s.pieceSel);
  const pieces = objs.length === 1 ? piecesOf(objs[0], scene.objects) : null;
  const picked = pieces && pieceSel?.id === objs[0].id ? pieceSel.ats : [];
  const pieceMode = picked.length > 0;
  // Show the style of the first selected object (or of the first picked
  // piece), or the style for new objects.
  const st: Style = pieceMode ? pieces!.styleAt(picked[0]) : (objs[0]?.style ?? current);
  const types = new Set(objs.map((o) => o.type));
  const onlyLabels = objs.length > 0 && [...types].every((t) => t === "label");
  const onlyPoints = objs.length > 0 && [...types].every((t) => t === "point");
  const hasOpen = objs.length === 0 || objs.some((o) => (o.type === "path" || o.type === "curve") && !o.closed);
  const hasFillable = objs.length === 0 || objs.some((o) => ((o.type === "path" || o.type === "curve") && o.closed) || o.type === "ellipse");
  const labels = objs.filter((o): o is Extract<Obj, { type: "label" }> => o.type === "label");
  const points = objs.filter((o): o is Extract<Obj, { type: "point" }> => o.type === "point");
  const [fillBase, fillTint] = splitTint(st.fill);
  const curves = objs.filter((o) => o.type === "curve").length;
  const showControls = useStore((s) => s.showControls);
  const editingCurve = useStore((s) => !!s.pointEdit && s.scene.objects.some((o) => o.id === s.pointEdit && o.type === "curve"));

  return (
    <div data-testid="style-panel">
      <div className="panel-title">
        {objs.length === 0 ? "New objects" : objs.length === 1 ? objTitle(objs[0]) : `${objs.length} objects`}
        {pieceMode && <span className="muted"> · {picked.length === 1 ? pieces!.nameAt(picked[0]) : `${picked.length} pieces`}</span>}
      </div>

      {pieces && <PiecesSection id={objs[0].id} pieces={pieces} picked={picked} />}

      <section>
        <h4>{onlyLabels ? "Text colour" : onlyPoints ? "Colour" : "Stroke"}</h4>
        <Swatches testid="stroke-swatches" value={st.stroke} allowNone={!onlyLabels && !onlyPoints} onPick={(c) => applyStyle({ stroke: c })} />
      </section>

      {!onlyLabels && !onlyPoints && (
        <>
          <section>
            <h4>Thickness</h4>
            <div className="widths">
              {LINE_WIDTHS.map((w, i) => (
                <button key={w.name} className={Math.abs(st.width - w.pt) < 1e-9 ? "active" : ""} title={`${w.name} (${w.pt}pt) — key ${i + 1}`} onClick={() => applyStyle({ width: w.pt })}>
                  <svg width="20" height="16"><line x1="2" x2="18" y1="8" y2="8" stroke="currentColor" strokeWidth={Math.max(0.6, w.pt * 2.2)} /></svg>
                </button>
              ))}
            </div>
          </section>
          <section>
            <h4>Dash</h4>
            <Seg
              value={st.dash}
              onPick={(dash) => applyStyle({ dash })}
              options={[
                { v: "solid", label: <svg width="34" height="10"><line x1="2" x2="32" y1="5" y2="5" stroke="currentColor" strokeWidth="1.5" /></svg>, title: "solid" },
                { v: "dashed", label: <svg width="34" height="10"><line x1="2" x2="32" y1="5" y2="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" /></svg>, title: "dashed" },
                { v: "dotted", label: <svg width="34" height="10"><line x1="2" x2="32" y1="5" y2="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1.5 3" strokeLinecap="round" /></svg>, title: "dotted" },
              ]}
            />
          </section>
        </>
      )}

      {hasFillable && !onlyLabels && !onlyPoints && !pieceMode && (
        <section>
          <h4>Fill</h4>
          <Swatches testid="fill-swatches" value={fillBase} allowNone onPick={(c) => applyStyle({ fill: c ? withTint(c, fillBase ? fillTint : 15) : null })} />
          {fillBase && (
            <Seg value={fillTint} onPick={(t) => applyStyle({ fill: withTint(fillBase, t) })} options={TINTS.map((t) => ({ v: t, label: `${t}%`, title: `${fillBase}!${t}` }))} />
          )}
        </section>
      )}

      {hasOpen && !onlyLabels && !onlyPoints && !pieceMode && (
        <section>
          <h4>Arrowheads</h4>
          <Seg
            value={`${st.arrowStart ? "<" : ""}-${st.arrowEnd ? ">" : ""}`}
            onPick={(v) => applyStyle({ arrowStart: v.startsWith("<"), arrowEnd: v.endsWith(">") })}
            options={[
              { v: "-", label: "—" },
              { v: "->", label: "→" },
              { v: "<-", label: "←" },
              { v: "<->", label: "↔" },
            ]}
          />
        </section>
      )}

      {points.length > 0 && (
        <section>
          <h4>Dot size</h4>
          <Seg value={points[0].size} onPick={(size) => applyProps({ size } as Partial<Obj>, (o) => o.type === "point")} options={[1, 1.5, 2, 3].map((v) => ({ v, label: `${v}pt` }))} />
        </section>
      )}

      {labels.length > 0 && (
        <section>
          <h4>Size</h4>
          <Seg
            value={labels[0].font}
            onPick={(font) => applyProps({ font } as Partial<Obj>, (o) => o.type === "label")}
            options={FONT_SIZES.map((f, i) => ({
              v: f,
              label: <span style={{ fontFamily: "Georgia, serif", fontSize: [9, 10.5, 12, 13.5, 15, 17, 19.5][i] }}>A</span>,
              title: f || "\\normalsize (the document's size)",
            }))}
          />
        </section>
      )}

      {curves > 0 && (
        <section>
          <label className="check-row" title="Show the anchors and handles of the selected curves">
            <input
              type="checkbox"
              checked={showControls || editingCurve}
              onChange={(e) => {
                // On: the same as double-clicking the curve (one curve) — edit its points.
                const sel = store.selected().filter((o) => o.type === "curve");
                const on = e.target.checked;
                store.set({ showControls: on, pointEdit: on && sel.length === 1 ? sel[0].id : null, activeNode: null });
              }}
              data-testid="show-controls"
            />
            <span>Control points</span>
          </label>
        </section>
      )}

      <Presets current={st} />

      {tool === "sketch" && objs.length === 0 && <SketchOptions />}

      {objs.length > 0 && (
        <section className="panel-actions">
          {!onlyLabels && (
            <button className="text-btn" onClick={smartLabel} title="Add a label next to this (⇧T)" data-testid="smart-label">
              Label
            </button>
          )}
          <button className="text-btn" onClick={saveSelectionToLibrary} title="Keep this in the figure library">
            Add to library
          </button>
          <button className="text-btn danger" onClick={deleteSelection}>
            Delete
          </button>
        </section>
      )}
    </div>
  );
}

function Presets({ current }: { current: Style }) {
  const settings = useStore((s) => s.settings);
  const presets = settings.presets ?? [];
  const add = async () => {
    const name = await askText("Save style as a preset", { placeholder: "e.g. thick dashed blue", ok: "Save", label: `It gets the key ⌥${presets.length + 1}.` });
    if (!name) return;
    await saveSettings({ ...settings, presets: [...presets, { name, style: { ...current } }] });
  };
  const remove = (i: number) => saveSettings({ ...settings, presets: presets.filter((_, j) => j !== i) });
  return (
    <section>
      <h4>Presets</h4>
      <div className="presets">
        {presets.map((p, i) => (
          <span key={i} className="preset" title={i < 9 ? `⌥${i + 1}` : undefined}>
            <button onClick={() => applyStyle(p.style)}>
              <svg width="18" height="10">
                <line x1="1" x2="17" y1="5" y2="5" stroke={xcolorCss(p.style.stroke ?? "black")} strokeWidth={Math.max(1, (p.style.width ?? 0.4) * 2)} strokeDasharray={p.style.dash === "dashed" ? "4 3" : p.style.dash === "dotted" ? "1 2" : undefined} />
              </svg>
              {p.name}
            </button>
            <button className="x" title="Remove preset" onClick={() => remove(i)}>
              ×
            </button>
          </span>
        ))}
        {presets.length < 9 && (
          <button className="preset-add" title="Save this style as a preset" onClick={add} data-testid="preset-add">
            +
          </button>
        )}
      </div>
    </section>
  );
}

function SketchOptions() {
  const settings = useStore((s) => s.settings);
  return (
    <section data-testid="sketch-options">
      <h4>Sketch</h4>
      <label className="slider-row" title="How far the clean curve may stray from your stroke">
        <span className="muted small">Exact</span>
        <input type="range" min={1} max={12} step={0.5} value={settings.sketchSmoothing} onChange={(e) => saveSettings({ ...settings, sketchSmoothing: parseFloat(e.target.value) })} />
        <span className="muted small">Smooth</span>
      </label>
      <label className="check-row">
        <input type="checkbox" checked={settings.recognizeShapes} onChange={(e) => saveSettings({ ...settings, recognizeShapes: e.target.checked })} />
        <span>Recognise shapes</span>
      </label>
    </section>
  );
}

function objTitle(o: Obj): string {
  switch (o.type) {
    case "path":
      return o.closed ? (o.pts.length === 4 ? "Quadrilateral" : o.pts.length === 3 ? "Triangle" : "Polygon") : o.pts.length === 2 ? "Line" : "Polyline";
    case "curve":
      return o.closed ? "Closed curve" : "Curve";
    case "ellipse":
      return Math.abs(o.rx - o.ry) < 1e-9 ? "Circle" : "Ellipse";
    case "point":
      return "Point";
    case "label":
      return "Label";
  }
}
