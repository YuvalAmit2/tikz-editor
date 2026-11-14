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
  arrowStart: boolean;
  arrowEnd: boolean;
}

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
}

export interface PartStyle {
  at: number;
  style: Partial<Pick<Style, "stroke" | "width" | "dash">>;
}

/** Polyline or polygon (closed). Lines and rectangles are paths too. */
export interface PathObj extends Base {
  type: "path";
  pts: Vec[];
  closed: boolean;
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
  follow?: { ids: string[]; ref: Vec; avoid: boolean; off?: boolean };
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
