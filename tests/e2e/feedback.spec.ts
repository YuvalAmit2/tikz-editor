// UI tests for the second feedback round.
import { expect, test, type Page } from "@playwright/test";

const PREAMBLE = "\\usepackage{amssymb}";

async function setup(page: Page, extra: Record<string, unknown> = {}) {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__store && (window as any).__ready);
  await page.evaluate(
    async ({ preamble, extra }) => {
      const s = (window as any).__store;
      const settings = { ...s.get().settings, preamble, preambleFile: "", documentClass: "\\documentclass[11pt]{article}", presets: [], recognizeShapes: true, showGrid: true, snapToGrid: true, snapToObjects: true, returnToSelect: true, gridSize: 0.25, snippetFile: "", toolKeys: {}, ...extra };
      await fetch("/api", { method: "POST", body: JSON.stringify({ method: "saveSettings", params: { settings } }) });
      s.set({ settings, view: { cx: 0, cy: 0, zoom: 40 } });
    },
    { preamble: PREAMBLE, extra },
  );
}
async function at(page: Page, x: number, y: number): Promise<[number, number]> {
  const b = (await page.getByTestId("canvas").boundingBox())!;
  return [b.x + b.width / 2 + x * 40, b.y + b.height / 2 - y * 40];
}
const objs = (page: Page) => page.evaluate(() => (window as any).__store.get().scene.objects);
const st = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__store.get();
    return { tool: s.tool, selection: s.selection, editingLabel: s.editingLabel, style: s.style, settings: s.settings, showSettings: s.showSettings };
  });
async function line(page: Page, a: [number, number], b: [number, number]) {
  await page.keyboard.press("l");
  await page.mouse.click(...(await at(page, ...a)));
  await page.mouse.click(...(await at(page, ...b)));
}

test("labels: click selects and arrows move it; double-click edits; arrows then move the cursor", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("t");
  await page.mouse.click(...(await at(page, 0, 0)));
  await page.keyboard.type("x");
  await page.keyboard.press("Enter");
  await expect(page.locator("svg.canvas image")).toHaveCount(1, { timeout: 20_000 });
  await page.keyboard.press("Escape");
  // One click: selected, not editing
  await page.mouse.click(...(await at(page, 0, 0)));
  let s = await st(page);
  expect(s.selection).toHaveLength(1);
  expect(s.editingLabel).toBeNull();
  // (Text tool labels: the text is centred on the point, inkAt; TikZ's
  // node point p is beside it.)
  await page.keyboard.press("ArrowRight");
  expect((await objs(page))[0].inkAt.x).toBeCloseTo(0.25, 9);
  await page.keyboard.press("Alt+ArrowRight");
  expect((await objs(page))[0].inkAt.x).toBeCloseTo(0.3, 9);
  // Double click: editing; arrows move the text cursor, not the label
  await page.mouse.dblclick(...(await at(page, 0.3, 0)));
  s = await st(page);
  expect(s.editingLabel).toBe(s.selection[0]);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("y");
  await page.keyboard.press("Enter");
  const o = (await objs(page))[0];
  expect(o.text).toBe("yx");
  expect(o.inkAt.x).toBeCloseTo(0.3, 9);
});

test("keys: Space taps to Select, - and . toggle dashes, G toggles grid snapping", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("r");
  expect((await st(page)).tool).toBe("rect");
  await page.keyboard.press("Space");
  expect((await st(page)).tool).toBe("select");
  await line(page, [0, 0], [2, 0]);
  await page.keyboard.press("-");
  expect((await objs(page))[0].style.dash).toBe("dashed");
  await page.keyboard.press(".");
  expect((await objs(page))[0].style.dash).toBe("dotted");
  await page.keyboard.press(".");
  expect((await objs(page))[0].style.dash).toBe("solid");
  await page.keyboard.press("g");
  expect((await st(page)).settings.snapToGrid).toBe(false);
  await page.getByTestId("snap-menu").click();
  await expect(page.getByTestId("snap-grid")).not.toBeChecked();
  await page.getByTestId("snap-menu").click();
  await page.keyboard.press("g");
  expect((await st(page)).settings.snapToGrid).toBe(true);
  // Shortcuts are written under the toolbar buttons
  await expect(page.getByTestId("tool-line")).toContainText("L");
});

test("grid lines are magnetic: dragging along a vertical line keeps x, y moves freely", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("l");
  await page.mouse.move(...(await at(page, 1.02, 0)));
  await page.mouse.down();
  // (at 40 px/cm the 0.25 cm grid is too fine to show: lines every 0.5 cm)
  await page.mouse.move(...(await at(page, 1.03, 1.27)), { steps: 6 });
  await page.mouse.up();
  const o = (await objs(page))[0];
  expect(o.pts[1].x).toBe(1);
  expect(o.pts[1].y).toBeCloseTo(1.27, 2);
});

test("trim: a line through a circle, click the top half away", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("e"); // ellipse with ⇧: a circle
  await page.keyboard.down("Shift");
  await page.mouse.click(...(await at(page, 0, 0)));
  await page.mouse.click(...(await at(page, 2, 0)));
  await page.keyboard.up("Shift");
  await line(page, [-3, 0], [3, 0]);
  await page.keyboard.press("x");
  await page.mouse.move(...(await at(page, 0, 2)));
  // The piece that would go is previewed
  await expect.poll(async () => (await page.evaluate(() => (window as any).__store.get().preview)).length).toBe(1);
  await page.mouse.click(...(await at(page, 0, 2)));
  const os = await objs(page);
  expect(os.map((o: any) => o.type).sort()).toEqual(["curve", "path"]);
  const half = os.find((o: any) => o.type === "curve");
  for (const n of half.nodes) expect(n.p.y).toBeLessThan(1e-6);
  // A stroke across both remaining pieces of the line (outside the circle) trims them
  await page.mouse.move(...(await at(page, -2.5, 0.5)));
  await page.mouse.down();
  await page.mouse.move(...(await at(page, -2.5, -0.5)), { steps: 5 });
  await page.mouse.up();
  const after = await objs(page);
  const l = after.find((o: any) => o.type === "path");
  expect(Math.min(...l.pts.map((p: any) => p.x))).toBeCloseTo(-2, 6);
  // Undo brings it back in one step
  await page.keyboard.press("Control+z");
  expect((await objs(page)).find((o: any) => o.type === "path").pts[0].x).toBe(-3);
});

test("symmetric editing: ⇧-drag a line's end grows it from both ends", async ({ page }) => {
  await setup(page);
  await line(page, [-1, 0], [1, 0]);
  await page.mouse.dblclick(...(await at(page, 0.5, 0)));
  await page.keyboard.down("Shift");
  await page.mouse.move(...(await at(page, 1, 0)));
  await page.mouse.down();
  await page.mouse.move(...(await at(page, 2, 0)), { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  expect((await objs(page))[0].pts).toEqual([
    { x: -2, y: 0 },
    { x: 2, y: 0 },
  ]);
});

test("control points toggle shows handles of every selected curve", async ({ page }) => {
  await setup(page);
  for (const y of [0, 2]) {
    await page.keyboard.press("b");
    for (const [x, dy] of [[-2, 0], [0, 1], [2, 0]]) await page.mouse.click(...(await at(page, x, y + dy)));
    await page.keyboard.press("Enter");
  }
  await page.keyboard.press("Control+a");
  await expect(page.getByTestId("control-handle")).toHaveCount(0);
  await page.getByTestId("show-controls").check();
  await expect(page.getByTestId("control-handle")).toHaveCount(8);
  await expect(page.getByTestId("vertex-handle")).toHaveCount(6);
});

test("smart label: Label button adds a label beside the object and opens it", async ({ page }) => {
  await setup(page);
  await line(page, [-2, 0], [2, 0]);
  await line(page, [0, -2], [0, 2]);
  await page.mouse.click(...(await at(page, 1, 0)));
  await page.getByTestId("smart-label").click();
  const s = await st(page);
  expect(s.editingLabel).toBeTruthy();
  await page.keyboard.type("\\ell");
  await page.keyboard.press("Enter");
  await expect(page.locator("svg.canvas image")).toHaveCount(1, { timeout: 20_000 });
  // Placed again with its real size, and the hint to do so is gone.
  await expect.poll(async () => (await objs(page)).find((o: any) => o.type === "label").attach).toBeUndefined();
  const lab = (await objs(page)).find((o: any) => o.type === "label");
  expect(Math.abs(lab.p.y)).toBeGreaterThan(0.01);
  expect(Math.abs(lab.p.y)).toBeLessThan(0.6);
  expect(lab.anchor).not.toBe("center");
  // Several objects: one label, a size larger
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Shift+T");
  const big = (await objs(page)).find((o: any) => o.type === "label" && o.text === "");
  expect(big.font).toBe("\\large");
});

test("settings: Esc saves and closes; Copy button copies TikZ", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("Control+,");
  await expect(page.getByTestId("settings")).toBeVisible();
  await page.getByText("Show grid").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings")).toHaveCount(0);
  expect((await st(page)).settings.showGrid).toBe(false);
  // The save button stays on screen even in a short window
  await page.setViewportSize({ width: 900, height: 420 });
  await page.keyboard.press("Control+,");
  await expect(page.getByTestId("settings-save")).toBeInViewport();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 820 });
  // Let the canvas take its size again before clicking on it.
  await page.waitForTimeout(300);
  // Record what's written (the real clipboard is shared with the rest of the system).
  await page.evaluate(() => {
    (navigator.clipboard as any).writeText = async (t: string) => void ((window as any).__copied = t);
  });
  await line(page, [0, 0], [1, 0]);
  await page.getByTestId("copy-tikz").click();
  // A tikzpicture to paste as it is, centred on the origin
  await expect.poll(() => page.evaluate(() => (window as any).__copied ?? "")).toContain("\\path[draw] (-0.5,0) -- (0.5,0);");
  const copied: string = await page.evaluate(() => (window as any).__copied);
  expect(copied.startsWith("\\begin{tikzpicture}")).toBe(true);
  expect(copied).not.toContain("tikz-editor-scene");
});

test("snippets: Enter accepts the suggestion, the next Enter finishes the label", async ({ page }) => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = mkdtempSync(path.join(os.tmpdir(), "snip-"));
  const file = path.join(dir, "latex.json");
  writeFileSync(file, `{ "Frac": { "prefix": "FRAC", "body": "\\\\frac{\${1:$TM_SELECTED_TEXT}}{$2}$0" } }`);
  await setup(page, { snippetFile: file });
  await page.keyboard.press("t");
  await page.mouse.click(...(await at(page, 0, 0)));
  await page.keyboard.type("FRA");
  await expect(page.locator(".suggest-widget")).toContainText("FRAC");
  await page.keyboard.press("Enter");
  expect((await st(page)).editingLabel).toBeTruthy();
  await page.keyboard.type("1");
  await page.keyboard.press("Tab");
  await page.keyboard.type("2");
  await page.keyboard.press("Enter");
  expect((await st(page)).editingLabel).toBeNull();
  expect((await objs(page))[0].text).toBe("\\frac{1}{2}");
  // Lowercase works too, but not after a backslash or for a single letter.
  await page.keyboard.press("Escape");
  await page.keyboard.press("t");
  await page.mouse.click(...(await at(page, 0, -2)));
  await page.keyboard.type("fra");
  await expect(page.locator(".suggest-widget")).toContainText("FRAC");
  await page.keyboard.press("Enter");
  await page.keyboard.type("a");
  await page.keyboard.press("Tab");
  await page.keyboard.type("b");
  await page.keyboard.press("Enter");
  expect((await objs(page))[1].text).toBe("\\frac{a}{b}");
  await page.keyboard.press("Escape");
  await page.keyboard.press("t");
  await page.mouse.click(...(await at(page, 0, 2)));
  await page.keyboard.type("$\\frac");
  await page.waitForTimeout(300);
  await expect(page.locator(".suggest-widget.visible")).toHaveCount(0);
  await page.keyboard.type("{x}{y}$");
  await page.keyboard.press("Enter");
  expect((await objs(page))[2].text).toBe("$\\frac{x}{y}$");
});
