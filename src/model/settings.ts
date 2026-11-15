// App settings. Stored as JSON (settings.json in the app's data folder) and
// editable either in the Settings window or by hand.

import type { Style } from "./types";

/** A named style you can apply with one key (⌥1 … ⌥9, in order). */
export interface StylePreset {
  name: string;
  style: Partial<Style>;
}

export interface Settings {
  /** After placing an object, switch back to the Select tool. */
  returnToSelect: boolean;
  /** Grid spacing in cm. */
  gridSize: number;
  showGrid: boolean;
  snapToGrid: boolean;
  snapToObjects: boolean;
  /** What snapping goes to (the snapping menu). */
  snapKinds: SnapKinds;
  /** Snap radius in screen pixels. */
  snapRadiusPx: number;
  /** The \documentclass line of the documents figures go into (only the
   *  class and the font size option are used for labels). */
  documentClass: string;
  /** Preamble used to compile labels (everything between \documentclass and
   *  \begin{document}). Ignored when preambleFile is set. */
  preamble: string;
  /** Optional: a .tex file whose preamble is used instead of `preamble`. */
  preambleFile: string;
  /** Text width of the target document in cm (for the page-width guide). */
  textWidthCm: number;
  showTextWidthGuide: boolean;
  /** In the text panel: Enter commits the label (Shift+Enter = new line). */
  enterCommitsLabel: boolean;
  /** Path to the VS Code snippet file (latex.json). Empty: yalatex's. */
  snippetFile: string;
  /** Sketch tool: how far (screen px) the clean curve may stray from the stroke. */
  sketchSmoothing: number;
  /** Sketch tool: turn strokes that look like lines, polygons, circles or
   *  ellipses into those shapes. */
  recognizeShapes: boolean;
  /** Folder of the figure library. Empty: "library" in the app's data folder. */
  libraryDir: string;
  presets: StylePreset[];
  /** Show keyboard shortcuts on buttons (master switch), in the toolbar, in the style panel. */
  showKeys: boolean;
  showToolbarKeys: boolean;
  showStyleKeys: boolean;
  /** Colours made with the colour picker (xcolor expressions), newest first. */
  customColors: string[];
  /** Tool keys, e.g. { "curve": "B" }; only the ones you change (edit settings.json). */
  toolKeys: Record<string, string>;
}

export interface SnapKinds {
  /** Vertices, ends, anchors and dots. */
  points: boolean;
  midpoints: boolean;
  /** Centres and quadrant points of circles and ellipses. */
  centres: boolean;
  intersections: boolean;
  /** Anywhere on a line or curve. */
  onObjects: boolean;
  /** Smart guides: alignment, equal spacing, symmetry. */
  guides: boolean;
}

export const DEFAULT_SNAP_KINDS: SnapKinds = { points: true, midpoints: true, centres: true, intersections: true, onObjects: true, guides: true };

export const DEFAULT_SETTINGS: Settings = {
  returnToSelect: true,
  gridSize: 0.25,
  showGrid: true,
  snapToGrid: true,
  snapToObjects: true,
  snapKinds: DEFAULT_SNAP_KINDS,
  snapRadiusPx: 10,
  documentClass: "\\documentclass[11pt]{article}",
  preamble: "\\usepackage[notes]{yalatex}",
  preambleFile: "",
  textWidthCm: 15.9,
  showTextWidthGuide: false,
  enterCommitsLabel: true,
  snippetFile: "",
  sketchSmoothing: 4,
  recognizeShapes: true,
  libraryDir: "",
  presets: [],
  toolKeys: {},
  showKeys: true,
  showToolbarKeys: true,
  showStyleKeys: true,
  customColors: [],
};

export function withDefaults(s: Partial<Settings> | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...(s ?? {}), snapKinds: { ...DEFAULT_SNAP_KINDS, ...(s?.snapKinds ?? {}) } };
}

/** Used when snippetFile is empty. */
export const DEFAULT_SNIPPET_FILE = "~/latex/yalatex/vscode/latex.json";
