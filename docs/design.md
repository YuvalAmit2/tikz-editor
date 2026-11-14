# TikZ Editor — Design Decisions

Local LaTeX TikZ figure editor, built for speed while live-TeXing lecture notes. Works with the yalatex template (https://github.com/YuvalAmit2/yalatex). Repo: https://github.com/YuvalAmit2/tikz-editor

Status (2026-11-14): milestone 1 built. The app shell, canvas, basic tools, snapping, style panel, labels, TikZ export, `tikzfig.sty` and settings all work. Curves, sketch, snippets, the library and the VS Code command come next.

## Architecture

- **Scene model:** the editor's own JSON (points, paths, shapes, labels, styles), in cm with y up. The canvas draws geometry directly (SVG); no TeX compile is needed for drawing.
- **Labels only go through LaTeX:** labels are compiled with the user's preamble (batched, one pdfLaTeX run for many labels). The PDF is drawn on the canvas with **pdf.js**, which is bundled in the app, so there's nothing extra to install. Labels are re-rendered sharply at each zoom level.
- **Output:** TikZ, written to `graphics/name.tikz`. The scene JSON is embedded in a comment so the figure can be reopened and edited. Arbitrary hand-written TikZ is not imported.
- **App shell:** Electron. Front end React + TypeScript + SVG. During development it also runs in a browser (`npm run dev`); the same backend API is then served by the Vite dev server.
- **Text editor component:** Monaco (VS Code's editor), for exact VS Code snippet behaviour.

## Label compilation

- Engine: **pdfLaTeX** for previews. yalatex's `ya-fonts-xcharter.sty` has a pdfLaTeX branch (Type 1 XCharter + newtxmath), visually the same as the LuaLaTeX/OTF fonts used in documents.
- The preamble is precompiled into a format file (`mylatexformat`). It is rebuilt automatically when the preamble text or any file it read changes (tracked with `-recorder`).
- One run compiles many labels. A marker in the log before each label assigns LaTeX errors to the right label, so one bad label doesn't block the others.
- Measured: first compile (builds the format) ~1.5 s; after that ~0.2 s per batch.
- The preamble source is configurable in Settings: a document-class line + preamble text (default `\usepackage[notes]{yalatex}`), or "use the preamble of this .tex file".

## Inserting into documents: `tikzfig.sty`

- Ships with the editor as a separate `tikzfig.sty` (not in yalatex).
- `\tikzfig{name}` inputs `graphics/name.tikz` at the size it was drawn.
- Size options scale **geometry only**. Labels stay at document font size, and line widths stay fixed (implemented by scaling the coordinate units).
  - `\tikzfig[width=5cm]{name}`, `\tikzfig[height=3cm]{name}`, `\tikzfig[scale=1.5]{name}`, `\tikzfig[dir=figures/]{name}`
  - Shorthand: an option without `=` is a width: `\tikzfig[5cm]{name}` = `width=5cm`. A bare number is a fraction of `\linewidth`: `\tikzfig[0.4]{name}` = `width=0.4\linewidth`.
  - With both width and height, the figure fits inside both.
- `width`/`height` measure the **drawing only, ignoring labels**. The editor writes the natural geometry width/height into the `.tikz` file, and the macro sets scale = target / natural.

## Output details

- Coordinates in cm, rounded to **3 decimals** (0.01 mm, invisible). Code readability is not a goal.
- Curves (when added) are written as explicit cubic Bézier segments (`.. controls (a) and (b) ..`), not `plot[smooth]`/`hobby`.
- Flip/rotate/scale are applied to the coordinates themselves, not written as TikZ transforms (an ellipse keeps a `rotate around`).
- Colours are xcolor expressions that need no extra packages (`blue`, `orange!30`, `green!60!black`).

## User interface

- **Light theme.**
- **Toolbar:** a horizontal bar across the top: tools, undo/redo, flip/rotate, file name, New/Open/Save, settings.
- **Style panel:** on the right. Shows the selection's style, or the style for new objects when nothing is selected. Holds stroke colour, thickness (TikZ's 7 named widths), dash, fill + tint, arrowheads, label size/anchor, dot size.
- **Text panel:** fixed at the bottom (Monaco).
- **Canvas:** infinite, no frame, grid. A status bar shows zoom, cursor position, snap target and hints. An optional text-width guide (Settings).

## Tools and interaction

- **Tools (keys):** Select V, Line L, Polyline/polygon P, Rectangle R, Circle C (centre, then radius), Ellipse E (centre, then corner), Dot D, Text T.
- Shapes are drawn by dragging, or by clicking twice.
- **After placing an object, the tool returns to Select** by default (setting).
- **Select tool:**
  - Click / Shift-click / marquee to select. Drag to move: the grabbed vertex snaps onto targets.
  - Corner handles scale (Shift = uniform). Flip with ⇧H/⇧V, rotate 90° with ⇧R.
  - **Double-click** a line/polygon/ellipse to edit its points; double-click a label to edit its text.
- **Snapping:** grid, vertices, midpoints, centres, quadrant points, intersections, points on objects. Shift = 15° angles (and squares/circles). Alt = no snapping.
- **Keys:**
  - 1–7: line thickness. Arrows: nudge by a grid step (Shift ×4).
  - ⌘Z/⇧⌘Z undo/redo, ⌘C/⌘V/⌘D copy/paste/duplicate, ⌘A select all.
  - ⌘S save, ⌘O open, ⌘N new, ⌘, settings.
  - Space-drag or middle-drag to pan; two-finger scroll pans; pinch/⌘-scroll zooms; ⌘0 true size; ⇧1 fit.
- **Planned:**
  - **Curve tool, "auto-smooth anchors":** click the points the curve passes through, and handles are computed automatically (Hobby-style). Dragging a handle makes that anchor manual.
  - **Sketch tool:** resample and smooth the stroke → detect corners → fit the fewest cubic pieces (Schneider's algorithm) → an editable curve. Extras: shape recognition, redrawing a section, a smoothing slider.
  - ⌘K command palette; editable key bindings.

## Text

- A **fixed panel at the bottom** of the window (Monaco). Enter finishes (setting), Shift+Enter is a new line, Esc finishes. An emptied label is deleted.
- **Math by default:** a label with no unescaped `$` / `\(` is typeset as math (`\cO_K` works). A label containing `$…$` is typeset as text (`Consider $\cO_K$` works). `\$` is a literal dollar.
- A **toggle in the panel** (button + ⌘T) forces plain-text mode, for labels like "torus".
- LaTeX errors are shown in the panel; the label shows its source in red on the canvas.
- Labels are TikZ nodes with an anchor (9-point picker) and a size (`\scriptsize` … `\large`).

## Snippets (planned)

- Read from yalatex's `vscode/latex.json` and watched for changes. Parsed leniently (the file has comments and trailing commas).
- Uses VS Code snippet syntax via Monaco: `$1…$0`, `${1:default}`, `$TM_SELECTED_TEXT`. All-caps prefixes are triggered with Tab/Enter.

## Figure library (planned)

- Select objects → "Save to library" with a name and tags. Stored as scene JSON + SVG thumbnail in a folder you choose.
- **Inserted items are plain copies.**

## Settings

- A settings window (⌘,), stored as `settings.json` in the app's data folder (`~/Library/Application Support/tikz-editor` on macOS).
- Current settings: return-to-Select, grid spacing, grid/snapping toggles, Enter finishes a label, document class + preamble or preamble file, text width + guide.

## VS Code integration (planned)

- A command (added to the yalatex VS Code extension): type a figure name and press a hotkey. The editor opens, and saving writes `graphics/name.tikz` and inserts `\tikzfig{name}`. The app already opens a `.tikz` path given on its command line, and a second launch passes the file to the running window.

## Testing

- Unit tests (Vitest): geometry, ellipse transforms, snapping, label mode rule, number formatting, and `tikzfig.sty` (compiles figures and checks the sizes TeX reports for every size option).
- UI tests (Playwright): drawing with snapping, move/scale/point-edit/undo, labels (math/text/error/delete), save and reopen.
- Golden check: a figure drawn in the UI, saved, and compiled with `\tikzfig` matches the canvas.
- Manual feel/usability testing on macOS.

## Out of scope

- Commutative diagrams (quiver already handles these).
- Importing arbitrary hand-written TikZ.
