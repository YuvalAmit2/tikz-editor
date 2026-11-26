// UI tests for the tenth round: dashes, regular polygons, styled sides,
// paste at the mouse, labels that come back, the label grid, hidden lines.
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

const square = { id: "sq", type: "path", closed: true, pts: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }] };

test("the Point tool's menu: a dash across the line, diagonal at a corner", async ({ page }) => {
  await setup(page);
  await commit(page, [square]);
  await page.getByTestId("point-looks").click();
  await page.getByTestId("point-look-normal").click();
  await page.mouse.click(...(await at(page, 2, 2)));
  const t = (await objs(page)).find((o: any) => o.type === "point");
  expect(t.look).toBe("tick");
  expect(((t.angle % 180) + 180) % 180).toBeCloseTo(45, 5);
  await page.getByTestId("point-looks").click();
  await page.getByTestId("point-look-vtick").click();
  await page.mouse.click(...(await at(page, 1, 0)));
  expect((await objs(page)).filter((o: any) => o.type === "point")[1].angle).toBe(90);
  await page.getByTestId("point-looks").click();
  await page.getByTestId("point-look-dot").click();
});

test("regular polygons: drag from the middle; the number of sides changes it", async ({ page }) => {
  await setup(page);
  await page.getByTestId("tool-ngon").click();
  await expect(page.getByTestId("sides")).toHaveText("6");
  await page.mouse.move(...(await at(page, 0, 0)));
  await page.mouse.down();
  await page.mouse.move(...(await at(page, 1, 0.5)), { steps: 4 });
  await page.mouse.move(...(await at(page, 2, 0)), { steps: 4 });
  await page.mouse.up();
  const [h] = await objs(page);
  expect(h).toMatchObject({ type: "path", closed: true, regular: true });
  expect(h.pts.length).toBe(6);
  await page.getByTestId("sides-5").click();
  expect((await objs(page))[0].pts.length).toBe(5);
  await page.getByTestId("sides-more").click();
  expect((await objs(page))[0].pts.length).toBe(6);
  await page.evaluate(() => (window as any).__store.set({ ngonSides: 6 }));
});

test("double-clicking a side picks it out: its own colour and arrow, and it still moves with the rest", async ({ page }) => {
  await setup(page);
  await commit(page, [square]);
  await page.mouse.dblclick(...(await at(page, 1, 2)));
  expect((await st(page)).pieceSel?.id).toBe("sq");
  await page.getByTestId("mid-1").click();
  const o = (await objs(page))[0];
  expect(o.style.mid).toBeUndefined();
  expect(o.parts).toEqual([{ at: 2.5, style: { mid: 1 } }]);
  // Click away: the whole object again.
  await page.mouse.click(...(await at(page, 5, 5)));
  expect((await st(page)).pieceSel).toBeNull();
  await page.mouse.click(...(await at(page, 0, 1)));
  await page.keyboard.press("ArrowRight");
  const moved = (await objs(page))[0];
  expect(moved.pts[0].x).toBeGreaterThan(0);
  expect(moved.parts).toEqual(o.parts);
});

test("paste goes where the mouse is", async ({ page }) => {
  await setup(page);
  await commit(page, [square], ["sq"]);
  await page.keyboard.press("Meta+c");
  await page.mouse.move(...(await at(page, 5, 3)));
  await page.keyboard.press("Meta+v");
  const copy = (await objs(page))[1];
  const cx = copy.pts.reduce((a: number, p: any) => a + p.x, 0) / 4;
  const cy = copy.pts.reduce((a: number, p: any) => a + p.y, 0) / 4;
  expect(cx).toBeCloseTo(5, 5);
  expect(cy).toBeCloseTo(3, 5);
});

/** A label for the selection (⇧T), typed and compiled. */
async function label(page: Page, text: string) {
  await page.keyboard.press("Shift+T");
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => {
    const s = (window as any).__store.get();
    const l = s.scene.objects.find((o: any) => o.type === "label");
    return l && !l.attach;
  });
  return (await objs(page)).find((o: any) => o.type === "label");
}

test("a label pushed aside by a copy comes back when the copy moves away", async ({ page }) => {
  await setup(page);
  await commit(page, [square], ["sq"]);
  const l0 = await label(page, "A");
  // A line through where the label is: it moves out of the way.
  await commit(page, [...(await objs(page)), { id: "x", type: "path", closed: false, pts: [{ x: l0.p.x - 1, y: l0.p.y - 1 }, { x: l0.p.x + 1, y: l0.p.y + 1 }] }]);
  const l1 = (await objs(page)).find((o: any) => o.type === "label");
  expect(Math.hypot(l1.p.x - l0.p.x, l1.p.y - l0.p.y)).toBeGreaterThan(0.05);
  // The line goes: the label is back.
  await commit(page, (await objs(page)).filter((o: any) => o.id !== "x"));
  const l2 = (await objs(page)).find((o: any) => o.type === "label");
  expect(l2.p.x).toBeCloseTo(l0.p.x, 5);
  expect(l2.p.y).toBeCloseTo(l0.p.y, 5);
});

test("a label moved by hand stays put; the grid puts it beside its object", async ({ page }) => {
  await setup(page);
  await commit(page, [square], ["sq"]);
  const l0 = await label(page, "B");
  await page.evaluate((id) => (window as any).__store.set({ selection: [id] }), l0.id);
  await page.getByTestId("label-pos-south").click();
  let l = (await objs(page)).find((o: any) => o.type === "label");
  expect(l.follow.at).toBe("south");
  expect(l.anchor).toBe("north");
  // The square moves: it stays below it.
  await commit(page, (await objs(page)).map((o: any) => (o.id === "sq" ? { ...o, pts: o.pts.map((p: any) => ({ x: p.x + 1, y: p.y })) } : o)));
  l = (await objs(page)).find((o: any) => o.type === "label");
  expect(l.anchor).toBe("north");
  // Moved by hand: placed by hand from then on, even when lines come near.
  await page.evaluate((id) => (window as any).__store.set({ selection: [id] }), l.id);
  await page.keyboard.press("ArrowUp");
  l = (await objs(page)).find((o: any) => o.type === "label");
  expect(l.follow.custom).toBe(true);
  expect(l.follow.at).toBeUndefined();
  await expect(page.getByTestId("label-pos")).toBeVisible();
  await page.getByTestId("label-pos-auto").click();
  expect((await objs(page)).find((o: any) => o.type === "label").follow.custom).toBeUndefined();
});

test("hiding the line of text along a curve hides it", async ({ page }) => {
  await setup(page);
  await commit(page, [{ id: "k", type: "curve", closed: false, text: "Hi", hidden: true, nodes: [{ p: { x: -2, y: 0 }, mode: "smooth" }, { p: { x: 0, y: 1 }, mode: "smooth" }, { p: { x: 2, y: 0 }, mode: "smooth" }] }]);
  await expect(page.locator('[data-id="k"] path[stroke]:not([stroke="none"])')).toHaveCount(0);
  await expect(page.locator('[data-id="k"] text')).toHaveCount(1);
  // Selected: faintly, to edit it.
  await page.evaluate(() => (window as any).__store.set({ selection: ["k"] }));
  await expect(page.locator('[data-id="k"] [data-hidden="1"]')).toHaveCount(1);
});
