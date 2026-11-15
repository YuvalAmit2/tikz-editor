// UI tests for the seventh round (overnight testing).
import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__store && (window as any).__ready);
  await page.evaluate(async () => {
    const s = (window as any).__store;
    const kinds = { points: true, midpoints: true, centres: true, intersections: true, onObjects: true, guides: true };
    const clean = { ...s.get().settings, preamble: "\\usepackage{amssymb}", preambleFile: "", documentClass: "\\documentclass[11pt]{article}", presets: [], recognizeShapes: true, showGrid: true, snapToGrid: true, snapToObjects: true, snapKinds: kinds, returnToSelect: true, gridSize: 0.25, snippetFile: "", toolKeys: {}, customColors: [] };
    await fetch("/api", { method: "POST", body: JSON.stringify({ method: "saveSettings", params: { settings: clean } }) });
    // Grid snapping off for these tests (not saved).
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

test("⌘D on a copy you moved repeats the move", async ({ page }) => {
  await setup(page);
  await commit(page, [{ id: "d", type: "point", p: { x: 0, y: 0 }, size: 1.5, group: "g" }, { id: "e", type: "point", p: { x: 0, y: 1 }, size: 1.5, group: "g" }], ["d", "e"]);
  await page.keyboard.press("Meta+d");
  // Drag the copy to 1 cm right of the original.
  const copy = (await st(page)).selection;
  await page.evaluate((ids) => {
    const s = (window as any).__store;
    s.commit(s.withReplaced(ids.map((id: string) => { const o = s.objById(id); return { ...o, p: { x: 1, y: o.p.y > 0.5 ? 1 : 0 } }; })));
  }, copy);
  await page.keyboard.press("Meta+d");
  await page.keyboard.press("Meta+d");
  const xs = (await objs(page)).map((o: any) => Math.round(o.p.x * 1000) / 1000).sort();
  expect(xs).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  // Each copy is its own group.
  expect(new Set((await objs(page)).map((o: any) => o.group)).size).toBe(4);
});

test("arrows in the middle: the panel sets them, the TikZ marks them", async ({ page }) => {
  await setup(page);
  await commit(page, [{ id: "a", type: "path", pts: [{ x: 0, y: 0 }, { x: 2, y: 0 }], closed: false }], ["a"]);
  await page.getByTestId("mid-2").click();
  expect((await objs(page))[0].style.mid).toBe(2);
  // Two arrowheads drawn, besides the line itself.
  await expect(page.locator('svg.canvas g[data-id="a"] path')).toHaveCount(3);
  const tikz = await page.evaluate(async (url) => (await import(url)).sceneToTikz((window as any).__store.get().scene), "/src/tikz/export.ts");
  expect(tikz).toContain("\\path[draw,->>] (0.95,0) -- (1,0);");
  await page.getByTestId("mid-0").click();
  expect((await objs(page))[0].style.mid).toBeUndefined();
});

test("⇧T labels the edge of a shape that was clicked", async ({ page }) => {
  await setup(page);
  await commit(page, [{ id: "r", type: "path", pts: [{ x: -2, y: -1 }, { x: 2, y: -1 }, { x: 2, y: 1 }, { x: -2, y: 1 }], closed: true }]);
  // Click the left edge.
  await page.mouse.click(...(await at(page, -2, 0.3)));
  await page.keyboard.press("Shift+T");
  await page.keyboard.type("b");
  await page.keyboard.press("Enter");
  await expect(page.locator("svg.canvas image")).toHaveCount(1, { timeout: 20_000 });
  await expect.poll(async () => (await objs(page)).find((o: any) => o.type === "label").attach).toBeUndefined();
  const box = await page.evaluate(() => {
    const s = (window as any).__store.get();
    return (window as any).__labelBox(s.scene.objects.find((o: any) => o.type === "label"));
  });
  // Left of the left edge, by its middle.
  expect(box.maxX).toBeLessThan(-2);
  expect(box.maxX).toBeGreaterThan(-2.3);
  expect((box.minY + box.maxY) / 2).toBeCloseTo(0, 1);
});

test("a line with a gap breaks the lines below it", async ({ page }) => {
  await setup(page);
  await commit(page, [{ id: "a", type: "path", pts: [{ x: -1, y: 0 }, { x: 1, y: 0 }], closed: false }, { id: "b", type: "path", pts: [{ x: 0, y: -1 }, { x: 0, y: 1 }], closed: false }], ["b"]);
  await page.getByTestId("gap-toggle").check();
  expect((await objs(page))[1].style.gap).toBe(true);
  // A white line under b.
  await expect(page.locator('svg.canvas g[data-id="b"] path[stroke="rgb(255,255,255)"]')).toHaveCount(1);
});

test("dragging a dot brings the lines that end at it; ⌘-drag moves it alone", async ({ page }) => {
  await setup(page);
  await commit(page, [
    { id: "d", type: "point", p: { x: 0, y: 1 }, size: 1.5 },
    { id: "a", type: "path", pts: [{ x: -1, y: -1 }, { x: 0, y: 1 }, { x: 1, y: -1 }], closed: false },
  ]);
  await page.mouse.move(...(await at(page, 0, 1)));
  await page.mouse.down();
  await page.mouse.move(...(await at(page, 0.5, 1.6)), { steps: 6 });
  await page.mouse.up();
  let a = (await objs(page)).find((o: any) => o.id === "a");
  const d = (await objs(page)).find((o: any) => o.id === "d");
  expect(a.pts[1].x).toBeCloseTo(d.p.x, 9);
  expect(a.pts[1].y).toBeCloseTo(d.p.y, 9);
  expect(d.p.x).toBeGreaterThan(0.3);
  // Undo puts both back in one step.
  await page.keyboard.press("Meta+z");
  a = (await objs(page)).find((o: any) => o.id === "a");
  expect(a.pts[1]).toEqual({ x: 0, y: 1 });
  await page.keyboard.down("Meta");
  await page.mouse.move(...(await at(page, 0, 1)));
  await page.mouse.down();
  await page.mouse.move(...(await at(page, 0.5, 1.6)), { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Meta");
  a = (await objs(page)).find((o: any) => o.id === "a");
  expect(a.pts[1]).toEqual({ x: 0, y: 1 });
});
