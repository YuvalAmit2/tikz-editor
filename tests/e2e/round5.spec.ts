// UI tests for the fifth feedback round.
import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.SHOTS_DIR;

async function setup(page: Page, extra: Record<string, unknown> = {}) {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__store && (window as any).__ready);
  await page.evaluate(async (extra) => {
    const s = (window as any).__store;
    const kinds = { points: true, midpoints: true, centres: true, intersections: true, onObjects: true, guides: true };
    const clean = { ...s.get().settings, preamble: "\\usepackage{amssymb}", preambleFile: "", documentClass: "\\documentclass[11pt]{article}", presets: [], recognizeShapes: true, showGrid: true, snapToGrid: true, snapToObjects: true, snapKinds: kinds, returnToSelect: true, gridSize: 0.25, snippetFile: "", toolKeys: {}, customColors: [] };
    // Saved as the other test files expect (grid snapping on); these tests
    // turn the grid off without saving it.
    await fetch("/api", { method: "POST", body: JSON.stringify({ method: "saveSettings", params: { settings: clean } }) });
    s.set({ settings: { ...clean, snapToGrid: false, ...extra }, view: { cx: 0, cy: 0, zoom: 40 } });
  }, extra);
}
// The snapping menu saves what it changes: put the settings file back.
test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    const s = (window as any).__store;
    const kinds = { points: true, midpoints: true, centres: true, intersections: true, onObjects: true, guides: true };
    await fetch("/api", { method: "POST", body: JSON.stringify({ method: "saveSettings", params: { settings: { ...s.get().settings, snapToGrid: true, snapKinds: kinds } } }) });
  });
});

async function at(page: Page, x: number, y: number): Promise<[number, number]> {
  const b = (await page.getByTestId("canvas").boundingBox())!;
  return [b.x + b.width / 2 + x * 40, b.y + b.height / 2 - y * 40];
}
const objs = (page: Page) => page.evaluate(() => (window as any).__store.get().scene.objects);
const st = (page: Page) => page.evaluate(() => (window as any).__store.get());
async function squares(page: Page, list: [string, number, number][]) {
  await page.evaluate((list) => {
    const s = (window as any).__store;
    const style = { ...s.get().style };
    const sq = ([id, x, y]: [string, number, number]) => ({ id, type: "path", style, pts: [{ x, y }, { x: x + 2, y }, { x: x + 2, y: y + 2 }, { x, y: y + 2 }], closed: true });
    s.commit({ version: 1, objects: list.map(sq) });
  }, list);
}
async function drag(page: Page, from: [number, number], to: [number, number], shot?: string) {
  await page.mouse.move(...(await at(page, ...from)));
  await page.mouse.down();
  await page.mouse.move(...(await at(page, ...to)), { steps: 8 });
  if (shot && SHOTS) await page.screenshot({ path: `${SHOTS}/${shot}.png` });
  await page.mouse.up();
}

test("smart guides: equal spacing and alignment when moving a box", async ({ page }) => {
  await setup(page);
  await squares(page, [["a", -6, 0], ["b", -2, 0], ["c", 4, 1]]);
  // c (its right edge) to just about one gap (2 cm) right of b, nearly level with them
  await drag(page, [6, 2], [4.07, 1.04], "guides-spacing");
  const c = (await objs(page))[2];
  expect(c.pts[0].x).toBeCloseTo(2, 9);
  expect(c.pts[0].y).toBeCloseTo(0, 9);
  expect((await st(page)).guides).toHaveLength(0); // gone after letting go
});

test("smart guides: a point snaps to the mirror image of another", async ({ page }) => {
  await setup(page);
  await squares(page, [["a", -1, -1]]);
  await page.keyboard.press("d");
  await page.mouse.click(...(await at(page, -0.6, 2.37)));
  // Mirror of that about the square's centre line x = 0
  await page.keyboard.press("d");
  await page.mouse.move(...(await at(page, 0.63, 2.4)));
  await expect.poll(async () => (await st(page)).guides.some((g: any) => g.kind === "symmetry")).toBe(true);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/guides-symmetry.png` });
  await page.mouse.click(...(await at(page, 0.63, 2.4)));
  const p = (await objs(page))[2].p;
  expect(p.x).toBeCloseTo(0.6, 2);
  expect(p.y).toBeCloseTo(2.37, 2);
});

test("snapping menu turns kinds of snapping off", async ({ page }) => {
  await setup(page);
  await page.getByTestId("snap-menu").click();
  await expect(page.getByTestId("snap-menu-list")).toBeVisible();
  await page.getByTestId("snap-guides").uncheck();
  expect((await st(page)).settings.snapKinds.guides).toBe(false);
  await page.getByTestId("snap-grid").check();
  expect((await st(page)).settings.snapToGrid).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("snap-menu-list")).toHaveCount(0);
});

test("hide, group, hatch", async ({ page }) => {
  await setup(page);
  await squares(page, [["a", 0, 0], ["b", 3, 0]]);
  await page.mouse.click(...(await at(page, 2, 1)));
  await page.keyboard.press("Meta+Shift+h");
  expect((await objs(page))[0].hidden).toBe(true);
  await expect(page.getByTestId("hide-toggle")).toBeChecked();
  // Grouped: clicking one selects both, and they move together
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+g");
  await page.keyboard.press("Escape");
  await page.mouse.click(...(await at(page, 5, 1)));
  expect((await st(page)).selection).toHaveLength(2);
  await page.keyboard.press("Meta+Shift+g");
  await page.keyboard.press("Escape");
  await page.mouse.click(...(await at(page, 5, 1)));
  expect((await st(page)).selection).toEqual(["b"]);
  await page.getByTestId("pattern-north-east-lines").click();
  const b = (await objs(page))[1];
  expect(b.style.pattern).toBe("north east lines");
  await page.evaluate(() => {
    (navigator.clipboard as any).writeText = async (t: string) => void ((window as any).__copied = t);
  });
  await page.getByTestId("copy-tikz").click();
  await expect.poll(() => page.evaluate(() => (window as any).__copied ?? "")).toContain("pattern=north east lines");
  const out: string = await page.evaluate(() => (window as any).__copied);
  expect(out).toContain("\\usetikzlibrary{patterns}");
  expect(out.match(/\\path/g)).toHaveLength(1); // the hidden square isn't there
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/hide-hatch.png` });
});

test("text along a curve keeps its line; hiding hides just the line", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("b");
  for (const p of [[-2, 0], [0, 1], [2, 0]] as [number, number][]) await page.mouse.click(...(await at(page, ...p)));
  await page.keyboard.press("Enter");
  await page.getByTestId("curve-text").fill("hello");
  await page.getByTestId("curve-text").press("Enter");
  await page.evaluate(() => {
    (navigator.clipboard as any).writeText = async (t: string) => void ((window as any).__copied = t);
  });
  await page.getByTestId("copy-tikz").click();
  await expect.poll(() => page.evaluate(() => ((window as any).__copied ?? "").match(/\\path/g)?.length ?? 0)).toBe(2);
  await page.getByTestId("hide-toggle").check();
  await page.evaluate(() => ((window as any).__copied = ""));
  await page.getByTestId("copy-tikz").click();
  await expect.poll(() => page.evaluate(() => (window as any).__copied ?? "")).toContain("text along path");
  expect(await page.evaluate(() => (window as any).__copied.match(/\\path/g).length)).toBe(1);
});

test("labels: drawing through one moves it; dragging its dot doesn't make it jump about", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("d");
  await page.mouse.click(...(await at(page, 0, 0)));
  await page.getByTestId("smart-label").click();
  await page.keyboard.type("P");
  await page.keyboard.press("Enter");
  await expect(page.locator("svg.canvas image")).toHaveCount(1, { timeout: 20_000 });
  await expect.poll(async () => (await objs(page)).find((o: any) => o.type === "label").attach).toBeUndefined();
  const lab = () => objs(page).then((os: any[]) => os.find((o) => o.type === "label"));
  const before = await lab();
  // Drag the dot: during the drag the label keeps its place next to it.
  await page.mouse.move(...(await at(page, 0, 0)));
  await page.mouse.down();
  const offs: number[][] = [];
  for (let k = 1; k <= 6; k++) {
    await page.mouse.move(...(await at(page, k * 0.3, k * 0.13)));
    const [d, l] = await page.evaluate(() => {
      const os = (window as any).__store.get().scene.objects;
      return [os.find((o: any) => o.type === "point").p, os.find((o: any) => o.type === "label").p];
    });
    offs.push([l.x - d.x, l.y - d.y]);
  }
  await page.mouse.up();
  for (const o of offs) {
    expect(o[0]).toBeCloseTo(offs[0][0], 6);
    expect(o[1]).toBeCloseTo(offs[0][1], 6);
  }
  // A line drawn right through the label pushes it to a clear spot.
  const l = await lab();
  const lb = await page.evaluate((o) => (window as any).__labelBox(o), l);
  const mid = { x: (lb.minX + lb.maxX) / 2, y: (lb.minY + lb.maxY) / 2 };
  await page.keyboard.press("l");
  await page.keyboard.down("Alt");
  await page.mouse.click(...(await at(page, mid.x - 2, mid.y)));
  await page.mouse.click(...(await at(page, mid.x + 2, mid.y)));
  await page.keyboard.up("Alt");
  const after = await lab();
  // Its text is now clear of the line (its anchor point alone may hardly move).
  const ab = await page.evaluate((o) => (window as any).__labelBox(o), after);
  expect(ab.minY > mid.y || ab.maxY < mid.y).toBe(true);
  expect(before.follow.avoid).toBe(true);
});
