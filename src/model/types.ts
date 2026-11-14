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

export type FontSize = "" | "\\tiny" | "\\scriptsize" | "\\footnotesize" | "\\small" | "\\large" | "\\Large";

interface Base {
  id: string;
  style: Style;
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
