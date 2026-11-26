// The scene model. All coordinates are in cm, with y pointing UP (as in TikZ).

export interface Vec {
  x: number;
  y: number;
}

export type Dash = "solid" | "dashed" | "dotted";

export interface Style {
  /** xcolor expression ("black", "blue!60"), or null for no stroke. */
  stroke: string | null;
  /** Line width in pt. */
  width: number;
  dash: Dash;
  /** xcolor expression, or null for no fill. */
  fill: string | null;
  /** Hatching in the fill colour instead of a solid fill (a TikZ pattern). */
  pattern?: Pattern | null;
  arrowStart: boolean;
  arrowEnd: boolean;
  /** Arrowheads in the middle of each straight edge (or halfway along a
   *  curve or ellipse): 1 or 2 of them, negative pointing backwards. */
  mid?: number;
  /** Drawn as a wave, zigzag or coil along the line, or as a curly brace
   *  (see model/wave.ts). */
  wave?: "snake" | "zigzag" | "coil" | "brace";
  /** A see-through fill (TikZ fill opacity), 0–1. */
  opacity?: number;
}

export type Pattern = "north east lines" | "north west lines" | "horizontal lines" | "vertical lines" | "crosshatch" | "dots";

/** Patterns offered in the style panel, with a short name. */
export const PATTERNS: { p: Pattern; name: string }[] = [
  { p: "north east lines", name: "Hatched ⟋" },
  { p: "north west lines", name: "Hatched ⟍" },
  { p: "horizontal lines", name: "Horizontal lines" },
  { p: "vertical lines", name: "Vertical lines" },
  { p: "crosshatch", name: "Crosshatch" },
  { p: "dots", name: "Dots" },
];

export const DEFAULT_STYLE: Style = {
  stroke: "black",
  width: 0.4,
  dash: "solid",
  fill: null,
  arrowStart: false,
  arrowEnd: false,
};

/** TikZ's named line widths, in pt. */
export const LINE_WIDTHS: { name: string; pt: number }[] = [
  { name: "ultra thin", pt: 0.1 },
  { name: "very thin", pt: 0.2 },
  { name: "thin", pt: 0.4 },
  { name: "semithick", pt: 0.6 },
  { name: "thick", pt: 0.8 },
  { name: "very thick", pt: 1.2 },
  { name: "ultra thick", pt: 1.6 },
];

export type Anchor =
  | "center"
  | "north"
  | "south"
  | "east"
  | "west"
  | "north east"
  | "north west"
  | "south east"
  | "south west";

export const ANCHORS: Anchor[] = [
  "north west",
  "north",
  "north east",
  "west",
  "center",
  "east",
  "south west",
  "south",
  "south east",
];

export type FontSize = "" | "\\tiny" | "\\scriptsize" | "\\footnotesize" | "\\small" | "\\large" | "\\Large" | "\\LARGE";

/** The size picker, smallest to largest; "" (the document's size) is in the middle. */
export const FONT_SIZES: FontSize[] = ["\\scriptsize", "\\footnotesize", "\\small", "", "\\large", "\\Large", "\\LARGE"];

interface Base {
  id: string;
  style: Style;
  /** Pieces drawn differently from the rest (see model/parts.ts): each names
   *  a piece by a point on it (chain parameter) and overrides its stroke. */
  parts?: PartStyle[];
  /** Where the object was cut into pieces when a piece was styled (chain
   *  parameters): kept so the pieces stay even if what crossed it goes. */
  cuts?: number[];
  /** Hidden: shown faintly in the editor, left out of the TikZ. On a curve
   *  with text along it, only the line is hidden. */
  hidden?: boolean;
  /** Objects with the same group id are selected and moved together. */
  group?: string;
  /** "Show height" (model/height.ts): objects whose crossings with this one
   *  show which is on top (the one drawn later goes over). */
  cross?: string[];
}

export interface PartStyle {
  at: number;
  style: Partial<Pick<Style, "stroke" | "width" | "dash" | "mid">>;
}

/** Polyline or polygon (closed). Lines and rectangles are paths too. */
export interface PathObj extends Base {
  type: "path";
  pts: Vec[];
  closed: boolean;
  /** Holes in the fill (a filled ring, a disc with punctures). */
  holes?: (PathObj | CurveObj)[];
  /** Made as a regular polygon: its number of sides can be changed. */
  regular?: boolean;
}

/** Ellipse (circle when rx = ry), rotated by `rot` degrees about its centre. */
export interface EllipseObj extends Base {
  type: "ellipse";
  c: Vec;
  rx: number;
  ry: number;
  rot: number;
}

/** A dot. Drawn as a filled circle of fixed size (does not scale). */
export interface PointObj extends Base {
  type: "point";
  p: Vec;
  /** Radius in pt. */
  size: number;
  /** Drawn as a short dash instead of a dot (a tick on a number line), at
   *  `angle` degrees (90: upright), half as long as 2 × size. */
  look?: "tick";
  angle?: number;
}

/** A text/math label: a TikZ node. */
export interface LabelObj extends Base {
  type: "label";
  p: Vec;
  /** As typed. Math by default: see labels/mode.ts. */
  text: string;
  /** Force text mode for a label with no $...$ (e.g. "torus"). */
  textMode: boolean;
  /** Which point of the label's box sits at p. */
  anchor: Anchor;
  font: FontSize;
  /** Smart label: the objects it labels. While set, the label is moved to
   *  the best spot once its real size is known (cleared when moved by hand). */
  attach?: string[];
  /** Labels made with the Label button stay with what they label: when it
   *  moves, the label moves too (ref: where it was), or with `avoid`, it's
   *  placed again so it stays clear of lines. */
  follow?: {
    ids: string[];
    ref: Vec;
    avoid: boolean;
    off?: boolean;
    /** Where it would like to be (from ref): placed again after every change,
     *  as near there as it can be clear of lines. */
    home?: Vec;
    /** Put somewhere by hand: it only moves with its objects. */
    custom?: boolean;
    /** Chosen from the 3×3 grid: that side or corner of its objects' box
     *  ("center" on top of them). */
    at?: Anchor;
  };
  /** A white box behind the text (so it can sit on a line). */
  bg?: boolean;
  /** Made by clicking with the Text tool: the text itself (not TikZ's box
   *  around it) is kept centred on this point, through any edits. */
  inkAt?: Vec;
}

/** An anchor of a smooth curve (see model/curve.ts). */
export interface CurveNode {
  p: Vec;
  mode: "smooth" | "corner" | "manual";
  /** Manual anchors only: handle offsets from p (incoming and outgoing). */
  hin?: Vec;
  hout?: Vec;
}

/** A smooth curve through its anchors: cubic Bézier pieces. */
export interface CurveObj extends Base {
  type: "curve";
  nodes: CurveNode[];
  closed: boolean;
  /** Holes in the fill (see PathObj). */
  holes?: (PathObj | CurveObj)[];
  /** Text written along the curve instead of a line (TikZ "text along path"). */
  text?: string;
  textFont?: FontSize;
}

export type Obj = PathObj | EllipseObj | PointObj | LabelObj | CurveObj;

export interface Scene {
  version: 1;
  objects: Obj[];
}

export const emptyScene = (): Scene => ({ version: 1, objects: [] });

let idCounter = 0;
export function newId(): string {
  idCounter++;
  return Date.now().toString(36) + "-" + idCounter.toString(36) + Math.random().toString(36).slice(2, 6);
}
