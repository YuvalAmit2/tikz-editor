// UI tests for the eighth round: line patterns, the brace tool, Show height,
// the paint bucket, labels, the library, tabs.
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
const api = (page: Page, method: string, params: unknown = {}) => page.evaluate(([method, params]) => fetch("/api", { method: "POST", body: JSON.stringify({ method, params }) }).then((r) => r.json()), [method, params] as const);

test("line patterns are one choice; a brace stays a brace", async ({ page }) => {
  await setup(page);
  await commit(page, [{ id: "a", type: "path", pts: [{ x: -1, y: 0 }, { x: 1, y: 0 }], closed: false }], ["a"]);
  await page.getByTestId("line-snake").click();
  expect((await objs(page))[0].style).toMatchObject({ wave: "snake", dash: "solid" });
  await page.getByTestId("line-dashed").click();
  expect((await objs(page))[0].style.wave).toBeUndefined();
  expect((await objs(page))[0].style.dash).toBe("dashed");
  // A brace: dashed keeps it a brace, and it has no wave choices.
  await commit(page, [{ id: "b", type: "path", pts: [{ x: -1, y: 0 }, { x: 1, y: 0 }], closed: false, style: { stroke: "black", width: 0.4, dash: "solid", fill: null, arrowStart: false, arrowEnd: false, wave: "brace" } }], ["b"]);
  await expect(page.getByTestId("line-snake")).toHaveCount(0);
  await page.keyboard.press("-");
  expect((await objs(page))[0].style).toMatchObject({ wave: "brace", dash: "dashed" });
});

test("the Line tool's menu draws a curly brace; its label goes at the tip", async ({ page }) => {
  await setup(page);
  await page.getByTestId("line-kinds").click();
  await page.getByTestId("line-kind-brace").click();
  expect((await st(page)).tool).toBe("line");
  await page.mouse.click(...(await at(page, -2, 0)));
  await page.mouse.click(...(await at(page, 2, 0)));
  const [b] = await objs(page);
  expect(b.style.wave).toBe("brace");
  await page.keyboard.press("Shift+T");
  const l = (await objs(page)).find((o: any) => o.type === "label");
  expect(l.anchor).toBe("south");
  expect(l.p.x).toBeCloseTo(0, 5);
  expect(l.p.y).toBeGreaterThan(0.1);
  await page.keyboard.press("Escape");
  // Back to plain lines.
  await page.getByTestId("line-kinds").click();
  await page.getByTestId("line-kind-line").click();
  expect((await st(page)).lineKind).toBe("line");
});

test("Show height: the line behind gets a gap, from the right-click menu", async ({ page }) => {
  await setup(page);
  await commit(page, [{ id: "a", type: "path", pts: [{ x: -2, y: 0 }, { x: 2, y: 0 }], closed: false }, { id: "b", type: "path", pts: [{ x: 0, y: -2 }, { x: 0, y: 2 }], closed: false }], ["a", "b"]);
  await page.mouse.click(...(await at(page, 0, 1.5)), { button: "right" });
  await page.getByTestId("menu-height").click();
  const [a, b] = await objs(page);
  expect(a.cross).toEqual(["b"]);
  expect(b.cross).toEqual(["a"]);
  // a is behind: drawn in two runs.
  await expect(page.locator('svg.canvas g[data-id="a"] path[data-run]')).toHaveCount(2);
  // ⌘] brings a to the front: now b has the gap.
  await page.evaluate(() => (window as any).__store.set({ selection: ["a"] }));
  await page.keyboard.press("Meta+]");
  await expect(page.locator('svg.canvas g[data-id="b"] path[data-run]')).toHaveCount(2);
  // Again from the menu: off.
  await page.evaluate(() => (window as any).__store.set({ selection: ["a", "b"] }));
  await page.mouse.click(...(await at(page, 0, 1.5)), { button: "right" });
  await page.getByTestId("menu-height").click();
  expect((await objs(page)).every((o: any) => !o.cross)).toBe(true);
});

test("paint bucket: a ring between circles, then back to Select", async ({ page }) => {
  await setup(page);
  await commit(page, [
    { id: "o", type: "ellipse", c: { x: 0, y: 0 }, rx: 2, ry: 2, rot: 0 },
    { id: "i", type: "ellipse", c: { x: 0, y: 0 }, rx: 1, ry: 1, rot: 0 },
  ]);
  await page.keyboard.press("f");
  await page.mouse.click(...(await at(page, 1.5, 0.2)));
  const os = await objs(page);
  expect(os).toHaveLength(3);
  expect(os[0].holes).toHaveLength(1);
  expect((await st(page)).tool).toBe("select");
  await expect(page.locator('svg.canvas path[fill-rule="evenodd"]')).toHaveCount(1);
});

test("deleting an object deletes its label; ⌘D copies it along", async ({ page }) => {
  await setup(page);
  await commit(page, [{ id: "d", type: "point", p: { x: 0, y: 0 }, size: 1.5 }], ["d"]);
  await page.keyboard.press("Shift+T");
  await page.keyboard.type("a_1");
  await page.keyboard.press("Escape");
  await page.evaluate(() => (window as any).__store.set({ selection: ["d"], editingLabel: null }));
  await page.keyboard.press("Meta+d");
  let os = await objs(page);
  expect(os).toHaveLength(4);
  expect(os.filter((o: any) => o.type === "label").map((o: any) => o.text).sort()).toEqual(["a_1", "a_2"]);
  await page.evaluate(() => (window as any).__store.set({ selection: ["d"] }));
  await page.keyboard.press("Backspace");
  os = await objs(page);
  expect(os).toHaveLength(2);
  expect(os.find((o: any) => o.type === "label").text).toBe("a_2");
});

test("text is centred on the point clicked", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("t");
  await page.mouse.click(...(await at(page, 1, 1)));
  await page.keyboard.type("G");
  await page.keyboard.press("Escape");
  await expect.poll(async () => page.evaluate(() => {
    const o = (window as any).__store.get().scene.objects[0];
    const b = (window as any).__labelBox(o);
    return b && b.maxX - b.minX < 0.6 ? [Math.round(((b.minX + b.maxX) / 2) * 1000) / 1000, Math.round(((b.minY + b.maxY) / 2) * 1000) / 1000] : null;
  }), { timeout: 30_000 }).toEqual([1, 1]);
});

test("Back to the drawing", async ({ page }) => {
  await setup(page);
  await commit(page, [{ id: "a", type: "ellipse", c: { x: 0, y: 0 }, rx: 1, ry: 1, rot: 0 }]);
  await expect(page.getByTestId("back-to-drawing")).toHaveCount(0);
  await page.evaluate(() => (window as any).__store.set({ view: { cx: 40, cy: 0, zoom: 40 } }));
  await page.getByTestId("back-to-drawing").click();
  const v = (await st(page)).view;
  expect(Math.abs(v.cx)).toBeLessThan(0.01);
  await expect(page.getByTestId("back-to-drawing")).toHaveCount(0);
});

test("library: reorder by dragging, rename, insert large, keys", async ({ page }) => {
  await setup(page);
  // A clean library.
  for (const it of (await api(page, "listLibrary")).result) await api(page, "deleteLibraryItem", { file: it.file });
  await api(page, "setLibraryOrder", { files: [] });
  const style = { stroke: "black", width: 0.4, dash: "solid", fill: null, arrowStart: false, arrowEnd: false };
  for (const [i, name] of ["one", "two", "three"].entries())
    await api(page, "saveLibraryItem", { item: { name, created: 3 - i, objects: [{ id: "x", type: "ellipse", style, c: { x: 0, y: 0 }, rx: 1, ry: 1, rot: 0 }], thumb: "<svg></svg>" } });
  await page.getByTestId("tab-library").click();
  const names = () => page.getByTestId("library-item").locator(".name").allTextContents();
  await expect.poll(names).toEqual(["one", "two", "three"]);
  await page.getByTestId("library-item").nth(2).dragTo(page.getByTestId("library-item").nth(0), { targetPosition: { x: 5, y: 30 } });
  await expect.poll(names).toEqual(["three", "one", "two"]);
  // Kept after reloading the list.
  await page.reload();
  await page.waitForFunction(() => (window as any).__ready);
  await page.evaluate(() => (window as any).__store.set({ side: "library", view: { cx: 0, cy: 0, zoom: 40 } }));
  await expect.poll(names).toEqual(["three", "one", "two"]);
  // Rename: it keeps its place.
  await page.getByTestId("library-item").nth(1).click({ button: "right" });
  await page.getByTestId("lib-rename").click();
  await page.getByTestId("prompt").locator("input").fill("uno");
  await page.keyboard.press("Enter");
  await expect.poll(names).toEqual(["three", "uno", "two"]);
  // Insert large: twice the size.
  await page.getByTestId("library-item").nth(0).click({ button: "right" });
  await page.getByTestId("lib-insert-large").click();
  expect((await objs(page))[0].rx).toBeCloseTo(2, 6);
  // Key 2 inserts the second.
  await page.mouse.move(...(await at(page, 3, 0)));
  await page.keyboard.press("2");
  expect(await objs(page)).toHaveLength(2);
  for (const it of (await api(page, "listLibrary")).result) await api(page, "deleteLibraryItem", { file: it.file });
});

test("tabs: ⌘T, switching keeps each figure and its undo, ⌘W asks to save", async ({ page }) => {
  await setup(page);
  await commit(page, [{ id: "a", type: "point", p: { x: 0, y: 0 }, size: 1.5 }]);
  await page.keyboard.press("Meta+t");
  await expect(page.getByTestId("tab")).toHaveCount(2);
  expect(await objs(page)).toHaveLength(0);
  await commit(page, [{ id: "b", type: "point", p: { x: 1, y: 0 }, size: 1.5 }]);
  await page.getByTestId("tab").first().click();
  expect((await objs(page)).map((o: any) => o.id)).toEqual(["a"]);
  await page.keyboard.press("Meta+z");
  expect(await objs(page)).toHaveLength(0);
  await page.keyboard.press("Control+Tab");
  expect((await objs(page)).map((o: any) => o.id)).toEqual(["b"]);
  // ⌘W on a changed figure: Cancel keeps it, Don't save closes it.
  await page.keyboard.press("Meta+w");
  await page.getByTestId("choice-cancel").click();
  await expect(page.getByTestId("tab")).toHaveCount(2);
  await page.keyboard.press("Meta+w");
  await page.getByTestId("choice-discard").click();
  await expect(page.getByTestId("tab")).toHaveCount(1);
});

test("a figure opened from outside goes in its own tab", async ({ page }) => {
  await setup(page);
  // Files that don't exist yet: new figures that will be saved there.
  const dir = "/tmp/tikz-editor-e2e-tabs";
  await commit(page, [{ id: "a", type: "point", p: { x: 0, y: 0 }, size: 1.5 }]);
  const openFromOutside = (p: string) => page.evaluate((p) => import("/src/actions.ts").then((m) => m.openFromOutside(p)), p);
  await openFromOutside(`${dir}/one.tikz`);
  await expect(page.getByTestId("tab")).toHaveCount(2);
  expect((await st(page)).filePath).toBe(`${dir}/one.tikz`);
  // Again: the same tab, not a third.
  await page.getByTestId("tab").first().click();
  await openFromOutside(`${dir}/one.tikz`);
  await expect(page.getByTestId("tab")).toHaveCount(2);
  expect((await st(page)).filePath).toBe(`${dir}/one.tikz`);
});
