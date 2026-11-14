# Overnight log (2026-11-14 → 15)

Everything here is on the `overnight` branch (tikz-editor, and yalatex for the VS Code command). Each entry: what I decided, what I passed over, and why. Items marked **[review]** are the ones most worth a look. "Left for you" lists ideas I deliberately didn't build.

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
