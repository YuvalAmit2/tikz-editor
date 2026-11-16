// UI tests for the ninth round: the paint bucket around shapes, clicking
// shapes drawn on a fill, the ellipse hint, shortcut key caps.
import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__store && (window as any).__ready);
  await page.evaluate(async () => {
    const s = (window as any).__store;
    const kinds = { points: true, midpoints: true, centres: true, intersections: true, onObjects: true, guides: true };
    const clean = { ...s.get().settings, preamble: "\\usepackage{amssymb}", preambleFile: "", documentClass: "\\documentclass[11pt]{article}", presets: [], recognizeShapes: true, showGrid: true, snapToGrid: true, snapToObjects: true, snapKinds: kinds, returnToSelect: true, gridSize: 0.25, snippetFile: "", toolKeys: {}, customColors: [] };
    await fetch("/api", { method: "POST", body: JSON.stringify({ method: "saveSettings", params: { settings: clean } }) });
    s.set({ settings: { ...clean, snapToGrid: false }, view: { cx: 0, cy: 0, zoom: 40 } });
  });
}

async function at(page: Page, x: number, y: number): Promise<[number, number]> {
  const b = (await page.getByTestId("canvas").boundingBox())!;
  return [b.x + b.width / 2 + x * 40, b.y + b.height / 2 - y * 40];
}
const objs = (page: Page) => page.evaluate(() => (window as any).__store.get().scene.objects);
const st = (page: Page) => page.evaluate(() => (window as any).__store.get());
const commit = (page: Page, objects: unknown[], selection: string[] = []) =>
  page.evaluate(([objects, selection]) => {
    const s = (window as any).__store;
    const style = { ...s.get().style };
    s.commit({ version: 1, objects: (objects as any[]).map((o) => ({ style, ...o })) }, { selection });
  }, [objects, selection] as const);
const blob = { id: "blob", type: "curve", closed: true, nodes: [[-3, 0], [0, 2], [3, 0], [0, -2]].map(([x, y]) => ({ p: { x, y }, mode: "smooth" })) };
const left = { id: "c1", type: "ellipse", c: { x: -1.5, y: 0 }, rx: 0.5, ry: 0.5, rot: 0 };
const right = { id: "c2", type: "ellipse", c: { x: 1.2, y: 0 }, rx: 0.5, ry: 0.5, rot: 0 };

test("the paint bucket fills a blob around the circles in it, wherever you click", async ({ page }) => {
  await setup(page);
  await commit(page, [blob, left, right]);
  for (const [x, y] of [[0, 0], [-0.5, 0.2], [2, -0.3], [-2.4, 0]]) {
    await page.evaluate(() => (window as any).__store.set({ tool: "fill" }));
    await page.mouse.click(...(await at(page, x, y)));
    const filled = (await objs(page))[0];
    expect(filled.holes?.length, `at ${x}, ${y}`).toBe(2);
    await page.keyboard.press("Meta+z");
  }
});

test("a circle drawn on a filled shape can be clicked (on its line or inside it)", async ({ page }) => {
  await setup(page);
  await commit(page, [{ ...blob, style: { stroke: "black", width: 0.4, dash: "dashed", fill: "gray!30", arrowStart: false, arrowEnd: false } }, left, right], ["blob"]);
  await page.mouse.click(...(await at(page, 1.2, 0.1)));
  expect((await st(page)).selection).toEqual(["c2"]);
  await page.mouse.click(...(await at(page, -2, 0)));
  expect((await st(page)).selection).toEqual(["c1"]);
  // Elsewhere on the fill: the blob.
  await page.mouse.click(...(await at(page, 0, 1)));
  expect((await st(page)).selection).toEqual(["blob"]);
});

test("editing an ellipse doesn't show the curve hints", async ({ page }) => {
  await setup(page);
  await commit(page, [left]);
  await page.mouse.dblclick(...(await at(page, -1.5, 0.5)));
  expect((await st(page)).pointEdit).toBe("c1");
  await expect(page.getByTestId("hint")).toHaveText("Drag a dot to change that radius");
});

test("line pattern shortcuts are shown as key caps", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const s = (window as any).__store;
    s.set({ settings: { ...s.get().settings, showKeys: true, showStyleKeys: true } });
  });
  await commit(page, [{ id: "a", type: "path", pts: [{ x: -1, y: 0 }, { x: 1, y: 0 }], closed: false }], ["a"]);
  const cap = page.getByTestId("line-dashed").locator(".pkey");
  await expect(cap).toHaveText("-");
  const b = (await cap.boundingBox())!;
  expect(b.height).toBeGreaterThanOrEqual(10);
  expect(await cap.evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe("solid");
});
