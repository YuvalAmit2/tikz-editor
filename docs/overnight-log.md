# Overnight log (2026-11-14 → 15)

Everything here is on the `overnight` branch (tikz-editor, and yalatex for the VS Code command). Each entry: what I decided, what I passed over, and why. Items marked **[review]** are the ones most worth a look. "Left for you" lists ideas I deliberately didn't build.

## Round 3 (your feedback, 2026-11-14 afternoon)

Tests: 50 unit, 29 browser, 5 desktop-app, all passing. Nothing is pushed.

- **Snippets** match in any case (`fra` works like `FRA`), except straight after a backslash, and a lone lowercase letter offers nothing (so a one-letter label finished with Enter isn't turned into a snippet).
- **Snap dot** is bigger (radius 4 with a white ring) so the pointer doesn't hide it.
- **Text-width frame** no longer follows the drawing. It's centred where the figure was when it was opened (x = 0 for a new figure) [review: if you'd rather centre it on the drawing with a button, say so].
- **Easier selecting:** a click within 10 px of a line picks it (was 6), and pressing inside the box around what's selected drags it, even on empty space inside an unfilled shape.
- **Selection box handles:** the four edge middles scale one way only; the round knob above the box rotates about its centre (⇧ snaps to 15°, the angle shows in the status bar). Hovering a handle shows a matching cursor. ⌘ on any corner or edge scales about the centre, so both sides move.
- **⌘-mirror:** the drag now carries on from the current shape whenever ⌘ is pressed or let go, so nothing jumps back. The mirrored point moves by the mirror image of how the dragged point moved (the same as before for a symmetric shape, and no jump for a lopsided one).
- **Adding nodes:** while editing points, hovering near the line shows a dotted ring where a double-click would add a node. It snaps to where the line crosses a grid line, or to another object's special point. ⌥ turns that off.
- **Control points** toggle now puts you in the same mode as double-clicking the curve (with one curve selected): the hint shows and a double-click on the line adds a node. With several curves selected, double-clicking any of them adds a node there.
- **Status bar** zoom and coordinates have fixed widths, so nothing after them shifts.
- **Grid:** lines are drawn (and snapped to) only when at least 12 px apart (was 8), so at 100% the 0.25 cm grid shows every 0.5 cm, and the fine lines come back from about 130%.
- **Drawing a Bézier:** the anchors placed so far and the handle you're pulling out are shown while you drag.

## Round 2 (your feedback, night of 2026-11-15)

**To try it:** restart `npm run app`. In yalatex, merge `overnight` again and run `yalatex vscode-extension` (extension 0.2.1: **Ctrl+⌘F**). Nothing is pushed. Tests at the end: 50 unit, 23 browser, 5 desktop-app, all passing.

### Your list, item by item
- **Arrow keys in text boxes / click vs double-click.** These were one bug: a single click opened the label for editing, so the arrows went to the text editor. Now a **click selects** a label (arrows and dragging move it) and a **double-click edits** it. While you're editing, the arrows move the text cursor.
- **Finer nudge:** ⌥-arrow moves a fifth of a grid step (0.05 cm by default). ⇧ is still ×4.
- **Dash keys:** `-` toggles dashed and `.` toggles dotted (pressing the same key again goes back to solid).
- **Anchors removed** from the panel, replaced by smart labels (below). Labels still have an anchor internally: smart labels set it so the text grows away from the object.
- **Font size:** the picker has 7 sizes, `\scriptsize … \LARGE`, with the document's own size (the default) in the middle [review]. I added `\Large` and `\LARGE` instead of making `\small` the default, so a default label still matches your text size.
- **Shortcuts visible:** each toolbar button shows its key underneath. Grid snapping has its own toolbar toggle and key, **G**.
- **tikzfig:** centred when it's on a line of its own. It stays inline in running text, or with `[inline]`. `caption=` and `label=` make a figure float (`place=h` etc. sets where it goes, default `htbp`). Inside your own `figure` environment it adds the caption without nesting another float. Checked with Ghostscript: the centred figure lines up with `\centerline` to within 0.3pt.
- **Removing part of a shape → a Trim tool (X)** [review]. You asked whether there's a general way: there is, the CAD "trim" idea. Every shape (line, polygon, curve, ellipse) is turned into a chain of straight/cubic pieces. **Click** a piece and it's cut away up to the nearest crossings with other objects; **drag** across several pieces to cut each one. The piece that would go is shown in red before you click. Cutting an ellipse in half means drawing a line across it, trimming one half, then deleting the line. A line in another spot gives any other amount. What's left is a curve with exact handles (or a path if all its pieces are straight), so it stays editable. One ⌘Z undoes a whole stroke. A piece with no crossings is removed entirely.
- **Settings:** Save/Cancel stay visible at the bottom when the dialog scrolls. **Esc saves and closes**, and so does clicking outside. Cancel still discards.
- **Smarter grid snapping** [review]: grid lines are now **magnetic per axis**. Near a vertical grid line, x sticks to it and y moves freely, sticking only when you pass near a horizontal line. The band is a quarter of the grid spacing (at most 6 px), and when you're zoomed out it uses the grid that's actually drawn. The catch: a click that's not near a grid line now gives an off-grid point, whereas it used to always round to the nearest grid point. If that turns out to be worse for quick rectangles, the old rounding is one line to bring back, or could be a setting.
- **Gear and ⌘ icons** for settings and the palette.
- **Symmetry** [review]: hold **⌘ while dragging a point** of a line, polyline or open curve (in point editing, or with Control points on), and its mirror-image point moves too. Point *i* pairs with the point as far from the other end. For a plain line the mirror is through the midpoint, so the line grows from both ends. Otherwise it's across the shape's axis, the line through the middle of the two ends and the middle point. That covers your 3-point arch: drag one end onto the bottom curve and the other end follows symmetrically. Handles are mirrored too. Closed shapes and the middle point itself have no partner. I left out anything automatic (e.g. detecting symmetric shapes) as too contrived.
- **Control points toggle** in the panel whenever curves are selected. It shows anchors and handles of *every* selected curve, and they can be dragged directly.
- **Space = Select:** a tap switches to Select, holding it still pans. V also still works.
- **Smart labels:** select something and press **Label** in the panel, or **⇧T**. A label is placed next to it and opened for typing. Candidate spots are around points, outside ellipses (on the ellipse, pushed outward), beside the middle of lines and curves (convex side first), past line ends, and around the bounding box. The chosen spot crosses no lines (filled insides don't count) and doesn't overlap other labels; upper-right is preferred. It's placed once with a guessed size, then **placed again once with the real compiled size**. Moving it by hand turns this off. Several objects get one label, `\large`.
- **Ctrl+⌘F** in VS Code instead of Ctrl+F. Note that macOS VS Code binds Ctrl+⌘F to full screen by default. The extension's binding only applies in `.tex` files, where it wins.
- **Restyling a selection now also sets the style for new objects** (changed back as you asked). One exception: picking a colour for a *label* only changes the new-object stroke colour, so it doesn't turn off fills for the next shape.
- **Snippets** [review]: I couldn't make them fail. With your real `~/latex/yalatex/vscode/latex.json` and default settings, typing `FRA` → Enter gives `\frac{}{}` in both the browser build and the Electron app. My guess is that the app you tried was started before the overnight changes, so restarting `npm run app` should fix it. Only the snippets that make sense in a label are offered: PD, MATR, TIT, TBF, IMP, IMB, TERM, FRAC, PAREN, BRAX (environment snippets like THM are left out). They need capitals: `FRA`, not `fra`. **Enter accepts a suggestion, and the next Enter finishes the label**; there's now a test for exactly this.
- **Copy** button in the top bar: copies the figure's TikZ code.

### Bugs found while testing this round
- ⇧T typed a "T" into the label it had just opened.
- Esc in Settings closed the dialog only after the save finished, so a key pressed right after it was lost. It now closes at once.
- After clicking a checkbox in the side panel (Control points, Recognise shapes), keyboard shortcuts stopped working until you clicked the canvas. Checkboxes and sliders no longer count as "typing".

## Morning checklist (round 1)

1. Review this log, then try things out: `npm run app` (restart it if it's still running from yesterday: the Electron side changed).
2. `npm run install-sty` once, so `\tikzfig` works in your documents (yalatex loads it automatically on the `overnight` branch).
3. In yalatex: merge `overnight`, then `yalatex vscode-extension` to install extension 0.2.0 (Ctrl+F figures).
4. Merge tikz-editor's `overnight` branch. **Nothing is pushed**: both branches are local only.
5. Tests: `npm test` (34), `CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:e2e` (14), `npm run test:app` (5). All passed at the end of the night.

## Decisions

### Style panel
- **Restyling a selection no longer changes the style for new objects** (your answer). With nothing selected, the panel edits the new-object style, as before. Number keys 1–7 follow the same rule.

### Curve tool (B)
- **Click the points the curve passes through**; handles are computed automatically. Enter / double-click finishes, clicking the first point closes the curve, Backspace removes the last point, Esc cancels.
- **Pen-style drag while placing a point** pulls out its handle (that anchor becomes "manual"). Free extra, same gesture as Illustrator/Inkscape.
- **The smoothing algorithm** [review]: I couldn't verify Hobby's exact equations from memory, so I derived the same idea from first principles. Tangents are continuous, the curvature of the two pieces meeting at an anchor is equal (linearised), each end has "curl 1", and handle lengths use Hobby's velocity function (the part I'm sure of). Unit tests check that 4 points on a circle give the circle to 0.2%, 3 points give the exact arc, collinear points give a straight line, and symmetric input gives symmetric output. In use it looks like MetaPost/Hobby curves.
- **Editing** (double-click the curve): drag anchors; drag handles (the anchor becomes manual and the opposite handle mirrors its direction, keeping its own length; hold Alt to move one handle alone); **double-click an anchor** to toggle smooth ↔ corner (a manual anchor returns to smooth); **double-click the line** to insert an anchor; **Backspace** deletes the anchor you last clicked. Inserting and deleting points also works for polylines and polygons.
- Corner anchors are squares, smooth ones circles; the active one is filled.
- **Output**: explicit `.. controls (a) and (b) ..` segments (as decided), closed curves end with `.. cycle`.
- Key **B** (for Bézier): P was already the polyline tool.

### Sketch tool (S)
- Pipeline: resample → smooth → find corners (turns over ~55°) → Schneider fit with tolerance = the smoothing slider (in screen px, so it behaves the same at any zoom) → an ordinary editable curve with manual handles.
- **Shape recognition** (on by default, a checkbox in the panel while the tool is active): line, polyline, polygon (3–8 corners; a near-rectangle becomes an exact axis-aligned one when its sides are within ~12° of the axes), circle (axis ratio over 0.86), and ellipse (snapped axis-aligned when within 8°). **One ⌘Z turns a recognised shape back into the freehand curve.**
- The ends of an open stroke snap onto objects (so a sketched curve can end exactly on a point), but not to the grid: sketches should keep their shape.
- Smoothing slider ("Exact … Smooth", 1–12 px, default 4) and the recognition checkbox are saved in settings.
- **Not built:** "redraw a section" (draw over part of a curve to replace that stretch). It would need splitting curves at arbitrary parameters and matching tangents at both seams. Doable, but it's the most complex item and the least certain to feel good, so it's in "Left for you".

### Snippets in the label editor
- Reads `~/latex/yalatex/vscode/latex.json` by default (a "Snippet file" setting can point elsewhere; empty = that default) and **re-reads it every time you start editing a label**, so new snippets show up straight away.
- **Behaves like VS Code**: typing an all-caps prefix shows the matching snippets; Tab or Enter inserts; Tab moves between tab stops. It uses Monaco's own snippet engine, so `${1:default}`, `$0`, nested placeholders and `$TM_SELECTED_TEXT` follow VS Code's rules. In practice the selection is usually replaced as you type the prefix, so wrapping existing text isn't really reachable; I left that as is.
- Snippets whose body contains `\begin{` (THM, EQ, …) are left out, since environments don't belong in a label.
- While a suggestion is showing, Enter accepts it rather than finishing the label.

### Figure library
- **Add**: select objects → **Add to library** (style panel) or **+ Add** (library tab) or ⌘K → "Save selection to library…" → type a name. Saving a name that already exists asks before replacing.
- **Insert**: click a thumbnail in the **Library** tab (next to Style in the right panel), or ⌘K and type its name. A plain copy (as decided) goes in the middle of the view, snapped to the grid and selected, ready to drag.
- **Storage** [review]: one JSON file per item (objects centred on the origin + an SVG thumbnail), in `~/Library/Application Support/tikz-editor/library` by default. A **Library folder** setting can point it elsewhere: set it to e.g. `~/latex/yalatex/tikz-library` to get syncing and versioning as we discussed. I didn't create that folder in your repo myself.
- No tags: search matches names. Tags felt like extra UI for little gain at this size. Easy to add later.
- Delete: hover a thumbnail → ×.

### Command palette (⌘K)
- Fuzzy search over every command, every tool, the toggles (grid, snapping, text-width guide, return-to-Select) and every library figure ("ins torus" → Enter).

### Extras I added (small, and relevant to drawing figures)
- **Bring to front / send to back**: ⌘] / ⌘[ (and in the palette).
- **Align** left/right/top/bottom/centres: palette only, to keep the toolbar clean.
- **Copy `\tikzfig{name}`** and **Copy TikZ code**: palette.
- **In-app text prompt**: Save/Open in the browser and "Add to library" used `window.prompt`, which Electron doesn't support at all (it silently returns nothing). That would have broken the library in the desktop app, so I replaced it with a small dialog.
- Settings window: new fields for the snippet file and the library folder.

### VS Code quick-figure command (yalatex `overnight` branch)
- **Ctrl+F** (in .tex files) [review]: the same key inkscape-figures uses, which your `\incfig` came from. The current line's text becomes the figure name (`Fiber over p` → `fiber-over-p`), the line becomes `\tikzfig{fiber-over-p}` (indent kept), and TikZ Editor opens `graphics/fiber-over-p.tikz` next to the .tex file. On a line that already has `\tikzfig[…]{name}`, Ctrl+F reopens that figure. On an empty line it asks for a name.
- In TikZ Editor, **⌘Enter = save and go back**. The window hides instead of quitting, so the next Ctrl+F opens instantly. If the app is already running, a new figure opens in the same window, and the current figure is saved first (or you're asked if it was never saved).
- The extension finds the editor via a `yalatex.tikzEditor` setting (default `~/latex/tikz-editor/bin/tikz-editor`).
- `bin/tikz-editor` is the launcher: it rebuilds the app first when the source changed (a few seconds), loads nvm if Node isn't on the PATH, and starts the Electron binary directly. Tested with a bare `PATH=/usr/bin:/bin`, like VS Code started from the Dock.
- **tikzfig.sty** [review]: `ya-base.sty` now has `\IfFileExists{tikzfig.sty}{\RequirePackage{tikzfig}}{}`, so `\tikzfig` works in every yalatex document once the .sty is installed, and nothing changes until then. **To do once:** `npm run install-sty` in tikz-editor (symlinks `tex/tikzfig.sty` into your TEXMFHOME, so it stays up to date). The extension warns once per session if LaTeX can't find tikzfig.sty.
- Extension version 0.1.1 → 0.2.0, so `yalatex check`/`update` notice. **To do:** reinstall it with `yalatex vscode-extension` after merging.
- Not done: the "small always-on-top window" idea. Hiding and showing the normal window felt simpler and more predictable; easy to add if you miss it.

### Desktop-app tests
- New `npm run test:app`: Playwright drives the real Electron app with its own data folder (`TIKZ_EDITOR_HOME`, so your settings and library are never touched). It covers the command-line file, ⌘S, compiling a label, the library and its name prompt, a second launch handing its figure to the running window, and ⌘Enter hiding the window.

### Testing pass: bugs found and fixed
- **One broken label broke every label** (real bug, from before tonight). A stray `}` (e.g. while typing `\frac{a}{b}`) closed the TikZ node early and swallowed everything after it, so every label in the figure showed an error. Fixed three ways: braces are checked before compiling (clear message, "A } has no matching {"), each label sits on its own line so a `%` can only comment out itself, and if a batch still derails, labels are compiled one at a time so good ones always render. Tested with 12 hostile labels next to good ones.
- **Snippets could miss the first label**: they loaded only when an edit started, and fast typing could beat the load. Now also loaded at startup.
- **Stretching a curve changed its shape**: auto-smooth curves aren't invariant under non-uniform scaling, so the box handles produced a slightly different curve instead of a stretched one. Now a non-uniform scale fixes the handles first, so the result is exactly the stretched curve (rotations, flips and uniform scaling keep the anchors automatic).
- The browser tests had settings leaking between tests and some races; fixed.
- New randomised tests: 300 random curves pass through their anchors with finite handles; smooth anchors have no kink; transforms commute with the curve; random scenes round-trip through .tikz; **40 random figures (every object type, style and label kind) compile with pdfLaTeX** through `\tikzfig`.

### Polish
- **Less explaining**: removed "Nothing selected: these settings apply to the next objects you draw", the long hints in the text panel, and most status-bar hints (what's left is short: "↵ to finish · click the first point to close", "⇧ constrains · ⌥ turns off snapping", and in point editing "Double-click the line to add a point · ⌫ deletes one"). The math/text badge says just "Math" or "Text"; its tooltip says why.
- **Text panel** is a slim bar ("Label · T to add one") until you edit a label, then expands. That gives the canvas about 80 px more height. It's still a fixed panel at the bottom, as decided.
- **Label sizes** are shown as five graded "A"s (the LaTeX command is in the tooltip). The words didn't fit.
- **Thickness** is one row of 7.
- **Toolbar**: tools grouped (select | lines and curves | shapes | text); a ⌘K button next to Settings, so the palette is discoverable.
- Electron shows "TikZ Editor" as the app name instead of "Electron".

### Things from our discussion I resolved myself
- **True size vs. free drawing**: left as it is. You draw freely, ⌘0 shows true size, the text-width guide shows the page, and `\tikzfig[width]` sets the size. This was the open question from before; nothing I built depends on it.
- **Colour hotkeys**: not separate keys (the letters are taken by tools). Style presets (⌥1–⌥9) cover "this colour + this thickness + dashed" in one key.
- **Commutative diagrams**: still out of scope (quiver).

## Left for you (deliberately not built)
- **Redraw a section of a curve** by sketching over it. The most complex item; needs curve splitting and tangent matching at both seams.
- **Labels that stick to an object** and move with it (e.g. a label attached to a point). It needs a notion of attachment or grouping in the model.
- **Groups** (move/scale several objects as one, also in the library). The library already treats a selection as a unit; real groups touch selection, hit-testing and export.
- **Dark theme**: the design said light. The colours are CSS variables, so it's mostly a stylesheet.
- **Arcs and angle marks** (an arc tool, right-angle marks). Common in lecture figures and very doable, but it's a new object type, so I'd rather you choose what it should look like.
- **Packaging** as a real .app (electron-builder) with an icon, so it isn't "Electron" in the Dock when started outside `bin/tikz-editor`.
