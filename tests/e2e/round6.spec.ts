// UI tests for the sixth feedback round.
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

test("_ makes a line solid again", async ({ page }) => {
  await setup(page);
  await commit(page, [{ id: "a", type: "path", pts: [{ x: 0, y: 0 }, { x: 2, y: 0 }], closed: false }], ["a"]);
  await page.keyboard.press("-");
  expect((await objs(page))[0].style.dash).toBe("dashed");
  await page.keyboard.press("_");
  expect((await objs(page))[0].style.dash).toBe("solid");
  await page.keyboard.press(".");
  await page.keyboard.press("_");
  expect((await objs(page))[0].style.dash).toBe("solid");
});

test("dragging a curve's end at a box corner moves just that end, onto a point", async ({ page }) => {
  await setup(page);
  await commit(
    page,
    [
      { id: "c", type: "curve", nodes: [{ p: { x: 0, y: 0 }, mode: "smooth" }, { p: { x: 1.5, y: 2 }, mode: "smooth" }, { p: { x: 3, y: 0 }, mode: "smooth" }], closed: false },
      { id: "d", type: "point", p: { x: 4.5, y: -1.5 }, size: 1.5 },
    ],
    ["c"],
  );
  // Both ends (bottom corners) and the top point (on the top edge's handle).
  await expect(page.getByTestId("grab-handle")).toHaveCount(3);
  await page.mouse.move(...(await at(page, 3, 0)));
  await page.mouse.down();
  await page.mouse.move(...(await at(page, 4.43, -1.45)), { steps: 8 });
  await page.mouse.up();
  const c = (await objs(page)).find((o: any) => o.id === "c");
  expect(c.nodes[2].p.x).toBeCloseTo(4.5, 9);
  expect(c.nodes[2].p.y).toBeCloseTo(-1.5, 9);
  expect(c.nodes[0].p).toEqual({ x: 0, y: 0 });
  expect(c.nodes[1].p).toEqual({ x: 1.5, y: 2 });
});

test("the trim tool shows no smart guides or snap dot", async ({ page }) => {
  await setup(page);
  await commit(page, [
    { id: "a", type: "path", pts: [{ x: -3, y: 0 }, { x: 3, y: 0 }], closed: false },
    { id: "b", type: "path", pts: [{ x: 0, y: -3 }, { x: 0, y: 3 }], closed: false },
    { id: "e", type: "path", pts: [{ x: 2, y: 2 }, { x: 4, y: 2 }], closed: false },
  ]);
  await page.keyboard.press("x");
  for (const [x, y] of [[2.02, 1], [0.01, 2], [3, 2.03]] as [number, number][]) {
    await page.mouse.move(...(await at(page, x, y)), { steps: 3 });
    const s = await st(page);
    expect(s.guides).toHaveLength(0);
    expect(s.snap).toBeNull();
  }
});

test("the ⌘K and settings buttons line up with New/Open/Save", async ({ page }) => {
  await setup(page);
  const save = (await page.getByRole("button", { name: "Save", exact: true }).boundingBox())!;
  const gear = (await page.getByTestId("open-settings").locator("svg").boundingBox())!;
  expect(Math.abs(gear.y + gear.height / 2 - (save.y + save.height / 2))).toBeLessThan(1.5);
});

test("a lighter fill strength makes hatching sparser", async ({ page }) => {
  await setup(page);
  await commit(page, [{ id: "r", type: "path", pts: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }], closed: true }], ["r"]);
  await page.getByTestId("pattern-north-east-lines").click();
  const tile = () => page.locator("svg.canvas pattern").first().getAttribute("width").then(Number);
  const dense = await tile();
  await page.getByRole("button", { name: "30%" }).click();
  expect((await objs(page))[0].style.fill).toBe("black!30");
  expect(await tile()).toBeGreaterThan(dense * 1.8);
  // The hatching keeps the full colour.
  await expect(page.locator("svg.canvas pattern line").first()).toHaveAttribute("stroke", "rgb(0,0,0)");
});

test("labels: the box fits the text, and a smart label sits close to its line", async ({ page }) => {
  await setup(page);
  await commit(page, [{ id: "a", type: "path", pts: [{ x: -2, y: -1 }, { x: 2, y: 1 }], closed: false }], ["a"]);
  await page.getByTestId("smart-label").click();
  await page.keyboard.type("z_2");
  await page.keyboard.press("Enter");
  await expect(page.locator("svg.canvas image")).toHaveCount(1, { timeout: 20_000 });
  await expect.poll(async () => (await objs(page)).find((o: any) => o.type === "label").attach).toBeUndefined();
  const lab = (await objs(page)).find((o: any) => o.type === "label");
  await page.evaluate((id) => (window as any).__store.set({ selection: [id] }), lab.id);
  const img = (await page.locator("svg.canvas image").boundingBox())!;
  const outline = (await page.locator("svg.canvas rect[stroke-width]").last().boundingBox())!;
  // TikZ's node (the image) has inner sep all round; the outline hugs the ink.
  expect(outline.width).toBeLessThan(img.width * 0.85);
  expect(outline.height).toBeLessThan(img.height * 0.85);
  // Clear of the line, and close to it: the line passes within ~3 mm of the box.
  const box = await page.evaluate(() => {
    const s = (window as any).__store.get();
    return (window as any).__labelBox(s.scene.objects.find((o: any) => o.type === "label"));
  });
  const d = (x: number, y: number) => Math.abs(x - 2 * y) / Math.sqrt(5); // distance to the line x = 2y
  const corners = [[box.minX, box.minY], [box.maxX, box.minY], [box.maxX, box.maxY], [box.minX, box.maxY]];
  const side = corners.map(([x, y]) => Math.sign(x - 2 * y));
  expect(new Set(side).size).toBe(1);
  expect(Math.min(...corners.map(([x, y]) => d(x, y)))).toBeLessThan(0.3);
});
