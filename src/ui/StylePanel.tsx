import { applyProps, applyStyle, deleteSelection, groupSelection, saveSettings, smartLabel, toggleHidden, ungroupSelection } from "../actions";
import { ColorPicker } from "./ColorPicker";
import { followRef } from "../smartLabels";
import { geomBox } from "../model/geometry";
import { toChain } from "../model/trim";
import { saveSelectionToLibrary } from "../library";
import { useState } from "react";
import { FONT_SIZES, LINE_WIDTHS, PATTERNS, type Obj, type Pattern, type Style } from "../model/types";
import { componentAt, componentPieces, components, componentStyles, piecesSvgD } from "../model/parts";
import { PALETTE, TINTS, isCustomColor, splitTint, xcolorCss } from "../model/xcolor";
import { askText, store, useStore } from "../store";

const withTint = (base: string, tint: number) => (tint >= 100 || isCustomColor(base) ? base : `${base}!${tint}`);

/** A shortcut written on a button (when Settings shows them). */
function K({ k }: { k: string }) {
  const show = useStore((s) => s.settings.showKeys && s.settings.showStyleKeys);
  return show ? <span className="pkey">{k}</span> : null;
}

function Swatches({ value, onPick, allowNone, testid }: { value: string | null; onPick: (c: string | null) => void; allowNone?: boolean; testid: string }) {
  const [picking, setPicking] = useState(false);
  const settings = useStore((s) => s.settings);
  const custom = settings.customColors ?? [];
  const pickCustom = (c: string) => {
    setPicking(false);
    void saveSettings({ ...store.get().settings, customColors: [c, ...custom.filter((x) => x !== c)].slice(0, 10) });
    onPick(c);
  };
  return (
    <div className="swatches" data-testid={testid}>
      {allowNone && (
        <button className={"swatch none" + (value === null ? " active" : "")} title="None" onClick={() => onPick(null)}>
          <svg width="18" height="18"><path d="M3 15L15 3" stroke="#d33" strokeWidth="1.5" /></svg>
        </button>
      )}
      {PALETTE.map((c) => (
        <button key={c} className={"swatch" + (value === c ? " active" : "")} title={c} onClick={() => onPick(c)}>
          <span style={{ background: xcolorCss(c) }} className={c === "white" ? "white" : undefined} />
        </button>
      ))}
      {custom.map((c) => (
        <button key={c} className={"swatch" + (value === c ? " active" : "")} title="Your colour (right-click to remove)" onClick={() => onPick(c)} onContextMenu={(e) => {
          e.preventDefault();
          void saveSettings({ ...store.get().settings, customColors: custom.filter((x) => x !== c) });
        }}>
          <span style={{ background: xcolorCss(c) }} />
        </button>
      ))}
      <button className="swatch more" title="Pick any colour" onClick={() => setPicking(!picking)} data-testid={testid + "-more"}>
        <span />
      </button>
      {picking && <ColorPicker initial={value} onPick={pickCustom} onClose={() => setPicking(false)} />}
    </div>
  );
}

function Seg<T extends string | number | boolean>({ options, value, onPick, testid }: { options: { v: T; label: React.ReactNode; title?: string; k?: string }[]; value: T | undefined; onPick: (v: T) => void; testid?: string }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.v)} title={o.title} className={value === o.v ? "active" : ""} onClick={() => onPick(o.v)} data-testid={testid ? `${testid}-${o.v}` : undefined}>
          {o.label}
          {o.k && <K k={o.k} />}
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
  const names = comps.map((_, k) => `${k + 1}`);
  const styles = componentStyles(o, comps, n);
  const index = (at: number) => componentAt(comps, at, n);
  return {
    list: comps.map((c, k) => ({ at: c.mid % n, name: names[k], style: styles[k] })),
    index,
    nameAt: (at: number) => `piece ${names[index(at)] ?? ""}`,
    styleAt: (at: number) => styles[index(at)] ?? o.style,
  };
}

let piecesOpen = false;

/** The whole object in grey with one piece drawn in its own style. */
function PieceThumb({ id, at, style }: { id: string; at: number; style: Style }) {
  const objects = useStore((s) => s.scene.objects);
  const o = objects.find((x) => x.id === id);
  const chain = o ? toChain(o) : null;
  const b = o ? geomBox(o) : null;
  if (!o || !chain || !b) return null;
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY, 0.2) * 0.12;
  const w = b.maxX - b.minX + 2 * pad;
  const h = b.maxY - b.minY + 2 * pad;
  const piece = piecesSvgD(componentPieces(o, objects, at));
  const col = style.stroke && style.stroke !== "white" ? xcolorCss(style.stroke) : "#2f6fed";
  return (
    <svg width="46" height="34" viewBox={`${b.minX - pad} ${-(b.maxY + pad)} ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
      <g transform="scale(1,-1)">
        <path d={piecesSvgD(chain.pieces)} fill="none" stroke="#c8ccd4" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
        <path d={piece} fill="none" stroke={col} strokeWidth={2.4} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeDasharray={style.dash === "dashed" ? "4 3" : style.dash === "dotted" ? "1 3" : undefined} />
      </g>
    </svg>
  );
}

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
        <span className={"caret" + (open ? " open" : "")}>▸</span> Split into {pieces.list.length} pieces
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
              <PieceThumb id={id} at={p.at} style={p.style} />
              <span className="piece-name">{p.name}</span>
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
  const hasLine = objs.length === 0 || objs.some((o) => (o.type === "path" || o.type === "curve" || o.type === "ellipse") && o.style.stroke);
  const hasOpen = objs.length === 0 || objs.some((o) => (o.type === "path" || o.type === "curve") && !o.closed);
  const hasFillable = objs.length === 0 || objs.some((o) => ((o.type === "path" || o.type === "curve") && (o.closed || !!o.style.fill)) || o.type === "ellipse");
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
                  <K k={`${i + 1}`} />
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
                { v: "solid", label: <svg width="34" height="10"><line x1="2" x2="32" y1="5" y2="5" stroke="currentColor" strokeWidth="1.5" /></svg>, title: "solid (_)", k: "_" },
                { v: "dashed", label: <svg width="34" height="10"><line x1="2" x2="32" y1="5" y2="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" /></svg>, title: "dashed (-)", k: "-" },
                { v: "dotted", label: <svg width="34" height="10"><line x1="2" x2="32" y1="5" y2="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1.5 3" strokeLinecap="round" /></svg>, title: "dotted (.)", k: "." },
              ]}
            />
            {hasLine && !pieceMode && !onlyLabels && !onlyPoints && (
              <>
                <Seg
                  value={st.wave ?? ""}
                onPick={(w) => applyStyle({ wave: (w || undefined) as Style["wave"] })}
                testid="wave"
                options={[
                  { v: "", label: <svg width="26" height="10" viewBox="0 0 34 10"><line x1="2" x2="32" y1="5" y2="5" stroke="currentColor" strokeWidth="1.5" /></svg>, title: "Straight" },
                  { v: "snake", label: <svg width="26" height="10" viewBox="0 0 34 10"><path d="M2 5q2.5-5 5 0t5 0 5 0 5 0 5 0 5 0" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>, title: "Wavy (photon lines, branch cuts)" },
                  { v: "zigzag", label: <svg width="26" height="10" viewBox="0 0 34 10"><path d="M2 5l2.5-3.5 5 7 5-7 5 7 5-7 5 7 2.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>, title: "Zigzag (branch cuts, springs)" },
                  { v: "coil", label: <svg width="26" height="10" viewBox="0 0 34 10"><path d="M2 5c3-6 7-6 4 0s1 6 4 0 7-6 4 0 1 6 4 0 7-6 4 0 1 6 4 0" fill="none" stroke="currentColor" strokeWidth="1.1" /></svg>, title: "Coil (gluons, springs)" },
                  { v: "brace", label: <svg width="26" height="10" viewBox="0 0 34 10"><path d="M3 9q0-3 3-3h8q3 0 3-4q0 4 3 4h8q3 0 3 3" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>, title: "Curly brace, from the first point to the last, on the left going along the line (flip it for the other side)" },
                ]}
              />
                <label className="check-row" title="Drawn over a wider white line, so lines below it are broken where it crosses them (knots, braids, a curve passing in front). ⌘] brings it to the front.">
                  <input type="checkbox" checked={!!st.gap} onChange={(e) => applyStyle({ gap: e.target.checked || undefined })} data-testid="gap-toggle" />
                  <span>Gap where it crosses lines below</span>
                </label>
              </>
            )}
          </section>
        </>
      )}

      {hasFillable && !onlyLabels && !onlyPoints && !pieceMode && (
        <section>
          <h4>Fill</h4>
          <Swatches testid="fill-swatches" value={fillBase} allowNone onPick={(c) => applyStyle({ fill: c ? withTint(c, fillBase ? fillTint : 15) : null })} />
          {fillBase && (
            <Seg value={fillTint} onPick={(t) => applyStyle({ fill: withTint(fillBase, t) })} options={TINTS.map((t) => ({ v: t, label: `${t}%`, title: st.pattern ? `Hatching density ${t}% (lighter is sparser)` : `${fillBase}!${t}` }))} />
          )}
          <div className="patterns" data-testid="fill-patterns">
            {[{ p: null as Pattern | null, name: "Solid" }, ...PATTERNS].map(({ p, name }) => (
              <button
                key={name}
                className={(st.pattern ?? null) === p ? "active" : ""}
                title={p ? `${name} (TikZ pattern ${p})` : "Solid fill"}
                data-testid={"pattern-" + (p ?? "solid").replace(/ /g, "-")}
                onClick={() => applyStyle({ pattern: p, fill: st.fill ?? (p ? "black" : null) })}
              >
                <PatternIcon p={p} />
              </button>
            ))}
          </div>
          {fillBase && (
            <label className="check-row" title="Half see-through (TikZ fill opacity=0.5): overlapping shapes show both colours">
              <input type="checkbox" checked={(st.opacity ?? 1) < 1} onChange={(e) => applyStyle({ opacity: e.target.checked ? 0.5 : undefined })} data-testid="see-through" />
              <span>See-through</span>
            </label>
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

      {hasLine && !onlyLabels && !onlyPoints && !pieceMode && (
        <section>
          <h4>Arrows in the middle</h4>
          <Seg
            value={st.mid ?? 0}
            onPick={(mid) => applyStyle({ mid: mid || undefined })}
            options={[
              { v: 0, label: "—", title: "None" },
              { v: 1, label: "›", title: "One, along the line (each straight edge gets one)" },
              { v: 2, label: "»", title: "Two, along the line" },
              { v: -1, label: "‹", title: "One, pointing back" },
              { v: -2, label: "«", title: "Two, pointing back" },
            ]}
            testid="mid"
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
          <label className="check-row" title="A white box behind the text (TikZ fill=white), so it can sit on a line">
            <input type="checkbox" checked={labels.every((l) => l.bg)} onChange={(e) => applyProps({ bg: e.target.checked || undefined } as Partial<Obj>, (o) => o.type === "label")} data-testid="label-bg" />
            <span>White background</span>
          </label>
        </section>
      )}

      {labels.length === 1 && labels[0].follow && (
        <section>
          <h4>Follows</h4>
          <label className="check-row" title="When what it labels moves, the label goes with it">
            <input
              type="checkbox"
              checked={!labels[0].follow.off}
              onChange={(e) => {
                // Back on: from where things are now (no jump).
                const f = labels[0].follow!;
                const ref = followRef(scene.objects.filter((x) => f.ids.includes(x.id))) ?? f.ref;
                applyProps({ follow: { ...f, off: !e.target.checked, ref } } as Partial<Obj>, (o) => o.type === "label");
              }}
              data-testid="label-follow"
            />
            <span>Moves with its object</span>
          </label>
          <label className="check-row" title="When it moves, find a spot again that doesn't cross any lines">
            <input
              type="checkbox"
              checked={labels[0].follow.avoid}
              disabled={!!labels[0].follow.off}
              onChange={(e) => applyProps({ follow: { ...labels[0].follow!, avoid: e.target.checked } } as Partial<Obj>, (o) => o.type === "label")}
              data-testid="label-avoid"
            />
            <span>Keeps clear of lines</span>
          </label>
        </section>
      )}

      {objs.length === 1 && objs[0].type === "curve" && !objs[0].closed && <CurveText o={objs[0]} />}

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
        <section>
          <label className="check-row" title={objs.length === 1 && objs[0].type === "curve" && objs[0].text ? "Hide the line; the text along it stays" : "Hidden objects aren't in the TikZ; they show faintly here"}>
            <input type="checkbox" checked={objs.every((o) => o.hidden)} onChange={toggleHidden} data-testid="hide-toggle" />
            <span>{objs.length === 1 && objs[0].type === "curve" && objs[0].text ? "Hide the line" : "Hidden"}</span>
            <K k="⇧⌘H" />
          </label>
          {objs.length > 1 && !objs.every((o) => o.group && o.group === objs[0].group) && (
            <button className="text-btn" onClick={groupSelection} data-testid="group-btn">
              Group <K k="⌘G" />
            </button>
          )}
          {objs.some((o) => o.group) && (
            <button className="text-btn" onClick={ungroupSelection} data-testid="ungroup-btn">
              Ungroup <K k="⇧⌘G" />
            </button>
          )}
        </section>
      )}

      {objs.length > 0 && (
        <section className="panel-actions">
          {!onlyLabels && (
            <button className="text-btn" onClick={smartLabel} title="Add a label next to this (⇧T)" data-testid="smart-label">
              Label <K k="⇧T" />
            </button>
          )}
          <button className="text-btn" onClick={saveSelectionToLibrary} title="Keep this in the figure library">
            Add to library
          </button>
          <button className="text-btn danger" onClick={deleteSelection}>
            Delete <K k="⌫" />
          </button>
        </section>
      )}
    </div>
  );
}

/** Text written along a curve (TikZ's "text along path"). The line is drawn
 *  too unless it's hidden. */
function CurveText({ o }: { o: Extract<Obj, { type: "curve" }> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? o.text ?? "";
  const commit = () => {
    if (draft === null) return;
    const text = draft.trim() ? draft : undefined;
    setDraft(null);
    if (text !== o.text) applyProps({ text } as Partial<Obj>, (x) => x.id === o.id);
  };
  return (
    <section className="text-row">
      <h4>Text along the curve</h4>
      <input
        value={value}
        placeholder="Write along the curve…"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            setDraft(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
        spellCheck={false}
        data-testid="curve-text"
      />
      {o.text && (
        <Seg
          value={o.textFont ?? ""}
          onPick={(textFont) => applyProps({ textFont } as Partial<Obj>, (x) => x.id === o.id)}
          options={FONT_SIZES.map((f, i) => ({ v: f, label: <span style={{ fontFamily: "Georgia, serif", fontSize: [9, 10.5, 12, 13.5, 15, 17, 19.5][i] }}>A</span>, title: f || "\\normalsize" }))}
        />
      )}
    </section>
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
              {i < 9 && <K k={`⌥${i + 1}`} />}
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

/** A small swatch of a fill pattern. */
function PatternIcon({ p }: { p: Pattern | null }) {
  const L = (d: string) => <path d={d} stroke="currentColor" strokeWidth="1" />;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <rect x="1" y="1" width="16" height="16" rx="2" fill={p ? "none" : "currentColor"} fillOpacity={0.35} stroke="currentColor" strokeWidth="1" />
      {p === "north east lines" && L("M1 9L9 1M1 17L17 1M9 17L17 9")}
      {p === "north west lines" && L("M9 1L17 9M1 1L17 17M1 9L9 17")}
      {p === "horizontal lines" && L("M1 5H17M1 9H17M1 13H17")}
      {p === "vertical lines" && L("M5 1V17M9 1V17M13 1V17")}
      {p === "crosshatch" && L("M1 6H17M1 12H17M6 1V17M12 1V17")}
      {p === "dots" && [5, 9, 13].flatMap((x) => [5, 9, 13].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1" fill="currentColor" />))}
    </svg>
  );
}
