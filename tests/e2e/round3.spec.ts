// UI tests for the third feedback round.
import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__store);
  await page.evaluate(async () => {
    const s = (window as any).__store;
    const settings = { ...s.get().settings, preamble: "", preambleFile: "", documentClass: "\\documentclass[11pt]{article}", presets: [], recognizeShapes: true, showGrid: true, snapToGrid: true, snapToObjects: true, returnToSelect: true, gridSize: 0.25, snippetFile: "", toolKeys: {}, showTextWidthGuide: true, textWidthCm: 10 };
    await fetch("/api", { method: "POST", body: JSON.stringify({ method: "saveSettings", params: { settings } }) });
    s.set({ settings, view: { cx: 0, cy: 0, zoom: 40 } });
  });
}
async function at(page: Page, x: number, y: number): Promise<[number, number]> {
  const b = (await page.getByTestId("canvas").boundingBox())!;
  return [b.x + b.width / 2 + x * 40, b.y + b.height / 2 - y * 40];
}
const objs = (page: Page) => page.evaluate(() => (window as any).__store.get().scene.objects);
const st = (page: Page) => page.evaluate(() => (window as any).__store.get());
async function drag(page: Page, a: [number, number], b: [number, number], mod?: string) {
  if (mod) await page.keyboard.down(mod);
  await page.mouse.move(...(await at(page, ...a)));
  await page.mouse.down();
  await page.mouse.move(...(await at(page, ...b)), { steps: 6 });
  await page.mouse.up();
  if (mod) await page.keyboard.up(mod);
}
async function rect(page: Page, a: [number, number], b: [number, number]) {
  await page.keyboard.press("r");
  await drag(page, a, b);
}
const box = (o: any) => {
  const xs = o.pts.map((p: any) => p.x);
  const ys = o.pts.map((p: any) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

test("selection box: edge handles scale one way, ⌘ scales about the centre, the knob rotates", async ({ page }) => {
  await setup(page);
  await rect(page, [0, 0], [2, 1]);
  await expect(page.getByTestId("edge-handle")).toHaveCount(4);
  await expect(page.getByTestId("rotate-handle")).toHaveCount(1);
  // East edge (2, 0.5) out to 3: only x changes
  await drag(page, [2, 0.5], [3, 0.8]);
  expect(box((await objs(page))[0])).toEqual({ minX: 0, maxX: 3, minY: 0, maxY: 1 });
  // ⌘ + NE corner: both sides move
  await drag(page, [3, 1], [3.5, 1.5], "Meta");
  expect(box((await objs(page))[0])).toEqual({ minX: -0.5, maxX: 3.5, minY: -0.5, maxY: 1.5 });
  // Rotate 90° (⇧ snaps to 15°) about the centre (1.5, 0.5)
  const knob = await page.getByTestId("rotate-handle").boundingBox();
  const c = await at(page, 1.5, 0.5);
  await page.keyboard.down("Shift");
  await page.mouse.move(knob!.x + knob!.width / 2, knob!.y + knob!.height / 2);
  await page.mouse.down();
  await page.mouse.move(c[0] - 80, c[1], { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const b = box((await objs(page))[0]);
  expect(b.minX).toBeCloseTo(0.5, 6);
  expect(b.maxX).toBeCloseTo(2.5, 6);
  expect(b.minY).toBeCloseTo(-1.5, 6);
  expect(b.maxY).toBeCloseTo(2.5, 6);
});

test("easier selecting: a click a little off the line selects it, and inside the box drags it", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("l");
  await page.mouse.click(...(await at(page, 0, 0)));
  await page.mouse.click(...(await at(page, 3, 0)));
  await page.keyboard.press("Escape");
  await page.mouse.click(...(await at(page, 1.5, 0.22))); // 8.8 px away
  expect((await st(page)).selection).toHaveLength(1);
  await rect(page, [0, 1], [2, 2]);
  await drag(page, [1, 1.5], [2, 1.5]); // inside the (unfilled) rectangle
  expect(box((await objs(page))[1])).toEqual({ minX: 1, maxX: 3, minY: 1, maxY: 2 });
});

test("⌘-mirror: letting go of ⌘ mid-drag keeps the mirrored point where it is", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("l");
  await page.mouse.click(...(await at(page, -1, 0)));
  await page.mouse.click(...(await at(page, 1, 0)));
  await page.mouse.dblclick(...(await at(page, 0.5, 0)));
  await page.mouse.move(...(await at(page, 1, 0)));
  await page.keyboard.down("Meta");
  await page.mouse.down();
  await page.mouse.move(...(await at(page, 2, 0)), { steps: 4 });
  await page.keyboard.up("Meta");
  await page.mouse.move(...(await at(page, 2.5, 0)), { steps: 4 });
  await page.mouse.up();
  expect((await objs(page))[0].pts).toEqual([
    { x: -2, y: 0 },
    { x: 2.5, y: 0 },
  ]);
});

test("control points: the toggle edits the curve; hovering shows where a double-click adds a node, on the grid", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("b");
  for (const [x, y] of [[-2, 0], [0, 2], [2, 0]]) await page.mouse.click(...(await at(page, x, y)));
  await page.keyboard.press("Enter");
  await page.getByTestId("show-controls").check();
  const s = await st(page);
  expect(s.pointEdit).toBe(s.selection[0]);
  await expect(page.locator(".statusbar")).toContainText("Double-click the line");
  // Hover near the curve at x ≈ 1.03: the hint sits on the curve at x = 1 (a grid line)
  const o = (await objs(page))[0];
  await page.mouse.move(...(await at(page, 1.03, 1.55)), { steps: 3 });
  await expect(page.getByTestId("insert-hint")).toHaveCount(1);
  const hint = (await st(page)).insertHint;
  expect(hint.x).toBeCloseTo(1, 6);
  await page.mouse.dblclick(...(await at(page, 1.03, 1.55)));
  const after = (await objs(page))[0];
  expect(after.nodes).toHaveLength(o.nodes.length + 1);
  expect(after.nodes[2].p.x).toBeCloseTo(1, 6);
  expect((await st(page)).pointEdit).toBe(s.selection[0]);
});

test("drawing a curve shows the handle being pulled out", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("b");
  await page.mouse.move(...(await at(page, 0, 0)));
  await page.mouse.down();
  await page.mouse.move(...(await at(page, 1, 1)), { steps: 5 });
  await expect(page.getByTestId("control-handle")).toHaveCount(2);
  await expect(page.getByTestId("vertex-handle")).toHaveCount(1);
  await page.mouse.up();
});

test("status bar keeps its width; text-width guide stays put; grid fine lines only when zoomed in", async ({ page }) => {
  await setup(page);
  await page.mouse.move(...(await at(page, 0.1, 0.1)));
  const w1 = (await page.getByTestId("coords").boundingBox())!.width;
  await page.mouse.move(...(await at(page, -10.37, -5.21)));
  const w2 = (await page.getByTestId("coords").boundingBox())!.width;
  expect(w2).toBe(w1);
  const guideX = () => page.evaluate(() => [...document.querySelectorAll("svg.canvas line[stroke='#c9a227']")].map((l) => l.getAttribute("x1")));
  const g0 = await guideX();
  await rect(page, [3, 3], [6, 4]);
  expect(await guideX()).toEqual(g0);
  // 100%: the 0.25 cm grid (9.4 px) is hidden (lines every 0.5 cm); at 200% it shows
  const spacing = (zoom: number) =>
    page.evaluate((zoom) => {
      (window as any).__store.set({ view: { cx: 0, cy: 0, zoom } });
      const xs = [...document.querySelectorAll("svg.canvas > g:first-of-type > line")].map((l) => Number(l.getAttribute("x1")));
      return Math.round(((xs[1] - xs[0]) / zoom) * 100) / 100;
    }, zoom);
  expect(await spacing(96 / 2.54)).toBeCloseTo(0.5, 1);
  expect(await spacing((2 * 96) / 2.54)).toBeCloseTo(0.25, 1);
});
