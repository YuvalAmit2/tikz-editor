# TikZ Editor

A desktop editor (Electron + React + TypeScript + Vite) for drawing figures that are saved as `.tikz` files and put into LaTeX documents with `\tikzfig{name}` (from `tex/tikzfig.sty`). See `README.md` for features and keys, `docs/design.md` for the design.

## Related folders

- `~/latex/yalatex`: the user's LaTeX package and VS Code extension (`vscode/yalatex-vscode`). Its ⌃⌘F command turns the current line into `\tikzfig{name}` and opens `graphics/name.tikz` here via `bin/tikz-editor`.
- `~/latex/notes/`: the user's lecture notes, which use these figures. Don't edit the notes unless asked.
- `tex/tikzfig.sty` is symlinked into `~/Library/texmf`, so changes to it apply to every document at once.

## How we work

- Work on `main`. Commit finished rounds of work; **never push without the user's approval**.
- The user sends feedback in rounds, usually as a list in `feedback/next.md` (an Obsidian vault, git-ignored) with screenshots in `feedback/images/`. `/fb` reads it.
- Where a request is ambiguous, pick a reasonable reading, build it, and say which reading you took.
- After a change, reload the running app with ⌘R. Changes to `electron/` or `bin/` need the app restarted.

## Code map

- `src/model/`: scene types, geometry, curves, snapping (`snap.ts`), smart guides (`guides.ts`), label placement, pieces (`parts.ts`), paint-bucket regions (`region.ts`), settings.
- `src/tools/controller.ts`: pointer handling for all tools.
- `src/actions.ts`: commands; `src/store.ts`: state and undo; `src/smartLabels.ts`: labels that follow their objects.
- `src/tikz/export.ts`: scene → TikZ (`.tikz` file and the pasteable picture from Copy).
- `src/ui/`: React components. `server/`: file and LaTeX backend (labels are compiled with the user's preamble). `electron/`: main process.

## Tests

- Unit tests: `npx vitest run` (`tests/unit/perf.test.ts` sometimes fails on timing when the machine is busy).
- Browser tests: `CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npx playwright test` (Playwright's own browsers aren't installed). Each feedback round gets its own file, e.g. `tests/e2e/round5.spec.ts`. The tests share one settings file, so a test that changes settings must put them back.
- Desktop-app tests: `npm run test:app`.
- Typecheck: `npx tsc --noEmit -p .`
- `.claude/launch.json` has a dev server (`tikz-dev`, port 5175) for the browser pane.
