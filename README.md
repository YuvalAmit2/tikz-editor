# TikZ Editor

A fast figure editor for LaTeX that writes TikZ, made for live-TeXing lecture notes. Labels are compiled with your own preamble, so macros and fonts match your document.

Shapes, smooth curves, a sketch tool that cleans up rough strokes, snapping, styles and presets, labels with your preamble and VS Code snippets, a figure library, and a VS Code command to draw a figure for the current line. See [docs/design.md](docs/design.md) for the design.

## Requirements

- macOS or Linux, [Node.js](https://nodejs.org) 20+
- A TeX distribution with `pdflatex` and the `mylatexformat` package (both are in full MacTeX / TeX Live)

## Run it

```bash
npm install
npm run app        # the desktop app (Electron), with live reload
```

or, in a browser:

```bash
npm run dev        # then open http://localhost:5173
```

Open a figure directly: `bin/tikz-editor path/to/graphics/name.tikz` (it builds the app first if needed; a path that doesn't exist yet starts a new figure that saves there; if the app is already running, the figure opens in its window).

### From VS Code

With the yalatex extension, type a figure name on its own line in a `.tex` file and press **Ctrl+⌘F**: the line becomes `\tikzfig{name}` and the editor opens `graphics/name.tikz`. **⌘Enter** saves and takes you back.

## Using figures in LaTeX

Run `npm run install-sty` once (it links `tex/tikzfig.sty` into your personal TeX folder; yalatex then loads it automatically), or copy the file next to your document, then:

```latex
\usepackage{tikzfig}
...
\tikzfig{torus}            % graphics/torus.tikz, at the size you drew it
\tikzfig[5cm]{torus}       % 5cm wide
\tikzfig[0.4]{torus}       % 0.4\linewidth wide
\tikzfig[height=3cm]{torus}
\tikzfig[scale=1.5]{torus}
\tikzfig[caption={A torus}, label=fig:torus]{torus}   % a figure with a caption
\tikzfig[inline]{torus}   % in the line, not centred
```

On a line of its own a figure is centred. Sizes scale the drawing only; labels keep the document's font size and lines keep their thickness.

## Keys

| | |
|---|---|
| Space (tap) or V | Select |
| L P B S R N E D T F X | Line (its menu, the arrow beside it: line or curly brace), Polyline, Curve, Sketch, Rectangle, Regular polygon (drag from the middle to a corner; ⇧: sitting on a side; sides in the style panel), Ellipse (⇧: circle), Dot (its menu: a dot, an upright or flat dash, or a dash across the line it's on), Text, Fill (paint bucket), Trim |
| - . _ | Dashed, dotted (again: solid), solid (also takes a wave off) |
| G | Grid snapping on/off |
| ⇧T | Label the selection (placed next to it, clear of other lines; next to the edge or the part of a line you clicked) |
| 1–7 | Line thickness (ultra thin … ultra thick) |
| ⌥1–⌥9 | Style presets |
| Shift (while drawing) | 15° angles, squares, circles |
| Alt (while drawing) | No snapping |
| Click / double-click a label | Select it (to move it) / edit its text |
| Double-click a shape | Edit its points. On a side of a line or polygon, that side is also picked out: its colour, dash and arrows change on their own (it still moves with the rest); click elsewhere or Esc for the whole shape again |
| …while editing points | ↵: add a point at the dot shown on the line under the mouse; double-click an anchor: smooth ↔ corner; ⌫: delete the last clicked point; Alt-drag a handle: move it alone; ⇧-drag: the mirror-image point moves too |
| Selection box | Corners and edges scale (⇧: about the centre, ⌘: keep proportions); the knob above rotates (⇧: 15° steps). A corner or edge handle on one of a curve's points is a circle: dragging it moves just that point (snapping onto other objects); the rest of the curve stays |
| While drawing a curve or polyline | ⌘Z takes back the last click, ⌫ drops the whole thing |
| Right-click | Menu: front/back, forward/backward, Show height (two crossing lines), label, copy, duplicate, flip, library, delete |
| ⇧H ⇧V ⇧R | Flip horizontally / vertically, rotate 90° |
| Arrow keys | Nudge by about 15 screen px in grid steps (finer when zoomed in; Shift: four, Alt: a fifth) |
| ⌘Z ⇧⌘Z ⌘C ⌘V ⌘D ⌘A | Undo, redo, copy, paste (at the mouse, in whole grid steps), duplicate, select all. ⌘D on a copy you just moved repeats the move (⌘D, drag, ⌘D ⌘D … for evenly spaced copies), and counts subscripts up (a_1, a_2, …) |
| ⌘] ⌘[ | Bring to front, send to back |
| ⌘G, ⇧⌘G | Group, ungroup (grouped objects are selected and moved together) |
| ⇧⌘H | Hide or show (hidden objects are faint here and left out of the TikZ; on a curve with text, only its line hides, and isn't shown here unless the curve is selected) |
| ⌘K | Command palette (every command and library figure) |
| ⌘S ⌘O ⌘, | Save, open (in a new tab), settings |
| ⌘T (⌘N) ⌘W ⌃Tab | New tab, close tab (asks to save), next tab (⌃⇧Tab: previous) |
| 1–9, 0 (library open) | Insert the first ten library figures at the mouse |
| ⌘Enter | Save and go back (hides the window) |
| Space-drag, two-finger scroll | Pan |
| Pinch, ⌘-scroll, ⌘= ⌘- | Zoom |
| ⌘0 / ⇧1 | True size / fit figure (a "Back to the drawing" button shows when it's out of sight) |

Tool keys can be changed with `"toolKeys": { "curve": "K" }` in `settings.json` (in `~/Library/Application Support/tikz-editor/`).

In the text panel: labels are **math by default** (`\cO_K`), but a label containing `$…$` is text (`Consider $\cO_K$`). ⌘T forces text mode. Enter finishes, Shift+Enter starts a new line. Your VS Code snippets (yalatex's `vscode/latex.json`) work as in VS Code: type the all-caps prefix, then Enter or Tab (a second Enter finishes the label).

**Trim (X):** click a piece of a shape to cut it away up to where it crosses other lines, or drag across several pieces. The sides of rectangles, polygons and polylines go one at a time. To cut an ellipse in half, draw a line across it, trim one half, delete the line.

**Paint bucket (F):** click inside a region bounded by any lines to fill it. Shapes inside it are left as holes (a ring between two circles, a disc with punctures); loops in one curve and shapes that touch count too.

**Pieces:** the quickest way is to double-click a side of a line or polygon (each side is a piece of its own). Otherwise, to style part of a shape (e.g. the hidden half of a sphere's equator dashed), select it and open **Pieces** in the style panel. It lists the stretches between where other lines cross it, each drawn as a small picture; hovering one highlights it. Pick one or more, and the stroke colour, thickness and dash (including the `-` and `.` keys) apply to just those (on a line or polygon, the arrows in the middle too). **whole** goes back to styling the whole shape. A styled piece follows the crossings when things move, and stays a piece if the line that cut it is deleted.

**Copy** gives a `tikzpicture` you can paste straight into a document. To keep editing a figure, save it as a `.tikz` file and insert it with `\tikzfig{name}` instead (the command palette also copies the `.tikz` contents or the `\tikzfig` line).

**Labels made with the Label button** (⇧T) stay with what they label, and are deleted, copied and duplicated with it. Text made with the Text tool is centred on the point you clicked. A label's outline fits its visible text, and labels are placed, picked and lined up by that box (the TikZ node keeps its usual padding, so the PDF is unchanged). After every change they find their spot again, as near where they were first put as they can be clear of lines, so a label pushed aside (say by a pasted copy) comes back once the way is clear. One you move by hand stays where you put it and just moves with its object. In the style panel, "Keeps clear of lines" turns this off, and a 3×3 grid puts the label at a side or corner of what it labels (the middle: on top of it); **Auto** lets it find its own spot again.

**Text along a curve:** select an open curve and type into "Text along the curve" in the style panel; the curve is replaced by the text (TikZ's `decorations.text`, which `tikzfig.sty` loads; pasted pictures need `\usetikzlibrary{decorations.text}`).

**Arrows** (style panel): the first row is arrowheads at the ends; the second puts one or two in the middle of each straight edge, or halfway along a curve or ellipse, for identification diagrams (a torus as a square with marked edges) and contours.

**Plot a function** (⌘K): type `y =` something, like `x^3/3 - x` or `sin(2x), -pi, pi` (the range of x is optional; by default the width of the view). It becomes an ordinary curve that follows the graph closely, split where the function is undefined or jumps (`1/x`, `tan x`). Also in ⌘K: **Regular polygon…**, and **Blend**: select two lines, curves or shapes and get any number evenly in between (families of curves, homotopies, level sets).

**Dots hold their lines:** moving a dot (dragging, arrow keys, flipping) moves the line ends, corners and curve points that were on it, so graphs and triangulations stay joined. ⌘-drag moves a dot alone.

**Wavy, zigzag and coiled lines** (under Line, with solid, dashed and dotted): a whole number of waves fits the line so its ends stay put. **Curly braces** come from the Line tool's menu: a brace goes from the first point to the last, on its left (flip it, ⇧H/⇧V, for the other side), and ⇧T labels its tip. Both are written as coordinates, so the PDF looks exactly like the editor.

**See-through fills** (Fill, "See-through") let overlapping shapes show both colours, as in Venn diagrams. A label's **White background** lets it sit on a line.

**Show height** (knots, braids, a curve passing in front of a surface): select two lines that cross, right-click, Show height. The one in front goes over: the one behind gets a gap where they cross (its fill stays whole). ⌘] / ⌘[ swap which is on top; the menu item again turns it off.

**Library:** click a figure to insert it, or press its number (1–9, 0) to put it at the mouse. Drag figures to reorder them; right-click one to rename it or insert it at half or twice its size.

**Tabs:** each open figure has a tab. A figure sent from VS Code opens in a new tab (or its own, if it's already open).

**Hatched fills:** pick a pattern under Fill; the strength buttons (15%–100%) then set how dense the hatching is, not how pale (100% is TikZ's own pattern; lighter ones use `patterns.meta`, which `tikzfig.sty` loads).

**Colours:** the rainbow swatch opens a colour picker (hex too); colours you make are kept as swatches (right-click one to remove it). They're written as `{rgb,255:red,…}`, which needs no extra package.

**Snapping**: the magnet button in the toolbar picks what to snap to (grid, points, midpoints, centres, crossings, lines and curves, smart guides). Smart guides snap lightly to alignment with other objects' points and edges, equal spacing between objects, and mirror images about an object's centre line, and show a pink guide when they do.

**Grid snapping** is magnetic per axis: near a grid line, that coordinate sticks to it and the other one stays free, so you can slide along a grid line.

## Development

```bash
npm test                     # unit tests (needs pdflatex)
npx playwright install chromium   # or set CHROME_PATH to your Chrome
npm run test:e2e             # UI tests (browser)
npm run test:app             # desktop app tests (Electron)
npm run typecheck
```
