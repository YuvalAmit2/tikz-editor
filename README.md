# TikZ Editor

A fast figure editor for LaTeX that writes TikZ, made for live-TeXing lecture notes. Labels are compiled with your own preamble, so macros and fonts match your document.

Status: early. Milestone 1 (shapes, snapping, styles, labels, TikZ export) works. See [docs/design.md](docs/design.md) for the design and what's planned.

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

Open a figure directly: `npm run build && npx electron . path/to/graphics/name.tikz` (a path that doesn't exist yet starts a new figure that saves there).

## Using figures in LaTeX

Copy `tex/tikzfig.sty` next to your document or into your personal TeX folder (`~/Library/texmf/tex/latex/tikzfig/` on a Mac), then:

```latex
\usepackage{tikzfig}
...
\tikzfig{torus}            % graphics/torus.tikz, at the size you drew it
\tikzfig[5cm]{torus}       % 5cm wide
\tikzfig[0.4]{torus}       % 0.4\linewidth wide
\tikzfig[height=3cm]{torus}
\tikzfig[scale=1.5]{torus}
```

Sizes scale the drawing only; labels keep the document's font size and lines keep their thickness.

## Keys

| | |
|---|---|
| V L P R C E D T | Select, Line, Polyline/polygon, Rectangle, Circle, Ellipse, Dot, Text |
| 1–7 | Line thickness (ultra thin … ultra thick) |
| Shift (while drawing) | 15° angles, squares, circles |
| Alt (while drawing) | No snapping |
| Double-click | Edit a shape's points / a label's text |
| ⇧H ⇧V ⇧R | Flip horizontally / vertically, rotate 90° |
| Arrow keys | Nudge by one grid step (Shift: four) |
| ⌘Z ⇧⌘Z ⌘C ⌘V ⌘D ⌘A | Undo, redo, copy, paste, duplicate, select all |
| ⌘S ⌘O ⌘N ⌘, | Save, open, new, settings |
| Space-drag, two-finger scroll | Pan |
| Pinch, ⌘-scroll, ⌘= ⌘- | Zoom |
| ⌘0 / ⇧1 | True size / fit figure |

In the text panel: labels are **math by default** (`\cO_K`), but a label containing `$…$` is text (`Consider $\cO_K$`). ⌘T forces text mode. Enter finishes, Shift+Enter starts a new line.

## Development

```bash
npm test                     # unit tests (needs pdflatex)
npx playwright install chromium
npm run test:e2e             # UI tests
npm run typecheck
```
