// UI tests for the fourth feedback round.
import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, extra: Record<string, unknown> = {}) {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__store && (window as any).__ready);
  await page.evaluate(async (extra) => {
    const s = (window as any).__store;
    const settings = { ...s.get().settings, preamble: "\\usepackage{amssymb}", preambleFile: "", documentClass: "\\documentclass[11pt]{article}", presets: [], recognizeShapes: true, showGrid: true, snapToGrid: true, snapToObjects: true, returnToSelect: true, gridSize: 0.25, snippetFile: "", toolKeys: {}, customColors: [], ...extra };
    await fetch("/api", { method: "POST", body: JSON.stringify({ method: "saveSettings", params: { settings } }) });
    s.set({ settings, view: { cx: 0, cy: 0, zoom: 40 } });
  }, extra);
}
async function at(page: Page, x: number, y: number): Promise<[number, number]> {
  const b = (await page.getByTestId("canvas").boundingBox())!;
  return [b.x + b.width / 2 + x * 40, b.y + b.height / 2 - y * 40];
}
const objs = (page: Page) => page.evaluate(() => (window as any).__store.get().scene.objects);
const st = (page: Page) => page.evaluate(() => (window as any).__store.get());
async function line(page: Page, a: [number, number], b: [number, number]) {
  await page.keyboard.press("l");
  await page.mouse.click(...(await at(page, ...a)));
  await page.mouse.click(...(await at(page, ...b)));
}
async function circle(page: Page, c: [number, number], r: number) {
  await page.keyboard.press("e");
  await page.keyboard.down("Shift");
  await page.mouse.click(...(await at(page, ...c)));
  await page.mouse.click(...(await at(page, c[0] + r, c[1])));
  await page.keyboard.up("Shift");
}
async function curve(page: Page, pts: [number, number][]) {
  await page.keyboard.press("b");
  for (const p of pts) await page.mouse.click(...(await at(page, ...p)));
  await page.keyboard.press("Enter");
}

test("no circle tool; ⌘Z takes back a click while drawing a curve, ⌫ drops the whole draft; open curves get no fill", async ({ page }) => {
  await setup(page);
  await expect(page.getByTestId("tool-circle")).toHaveCount(0);
  await page.evaluate(() => (window as any).__store.set({ style: { ...(window as any).__store.get().style, fill: "red!15" } }));
  await page.keyboard.press("b");
  for (const p of [[-2, 0], [0, 1], [2, 0]] as [number, number][]) await page.mouse.click(...(await at(page, ...p)));
  await page.keyboard.press("Meta+z");
  expect((await st(page)).preview[0].nodes.length).toBe(3); // two placed + the one under the mouse
  await page.keyboard.press("Enter");
  const c = (await objs(page))[0];
  expect(c.nodes).toHaveLength(2);
  expect(c.style.fill).toBeNull();
  await page.keyboard.press("b");
  await page.mouse.click(...(await at(page, 0, 3)));
  await page.mouse.click(...(await at(page, 1, 3)));
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  expect(await objs(page)).toHaveLength(1);
});

test("paint bucket: the half of a circle above a line gets a filled shape behind them", async ({ page }) => {
  await setup(page);
  await circle(page, [0, 0], 2);
  await line(page, [-3, 0], [3, 0]);
  await page.keyboard.press("f");
  await page.mouse.click(...(await at(page, 0.3, 1)));
  const os = await objs(page);
  expect(os).toHaveLength(3);
  const f = os[0];
  expect(f.style.stroke).toBeNull();
  expect(f.style.fill).toBeTruthy();
  expect(f.closed).toBe(true);
  // Inside a lone circle: its own fill is set
  await circle(page, [6, 0], 1);
  await page.keyboard.press("f");
  await page.mouse.click(...(await at(page, 6.2, 0.1)));
  const os2 = await objs(page);
  expect(os2).toHaveLength(4);
  expect(os2[3].style.fill).toBeTruthy();
});

test("right-click menu sends to back", async ({ page }) => {
  await setup(page);
  await line(page, [0, 0], [2, 0]);
  await line(page, [0, 1], [2, 1]);
  const top = (await objs(page))[1].id;
  await page.mouse.click(...(await at(page, 1, 1)), { button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();
  await page.getByTestId("menu-back").click();
  expect((await objs(page))[0].id).toBe(top);
  await expect(page.getByTestId("context-menu")).toHaveCount(0);
});

test("a label made with the Label button moves with its dot", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("d");
  await page.mouse.click(...(await at(page, 0, 0)));
  await page.getByTestId("smart-label").click();
  await page.keyboard.type("P");
  await page.keyboard.press("Enter");
  await expect(page.locator("svg.canvas image")).toHaveCount(1, { timeout: 20_000 });
  await expect.poll(async () => (await objs(page)).find((o: any) => o.type === "label").attach).toBeUndefined();
  const before = (await objs(page)).find((o: any) => o.type === "label");
  // Close to the dot
  expect(Math.hypot(before.p.x, before.p.y)).toBeLessThan(0.3);
  // Turn off "keep clear" so it just moves along, then drag the dot by (2, 1)
  // (click the middle of its text: its anchor point is outside the text's box)
  const lb = await page.evaluate((o) => (window as any).__labelBox(o), before);
  await page.mouse.click(...(await at(page, (lb.minX + lb.maxX) / 2, (lb.minY + lb.maxY) / 2)));
  await page.getByTestId("label-avoid").uncheck();
  await page.mouse.click(...(await at(page, 0, 0)));
  await page.mouse.move(...(await at(page, 0, 0)));
  await page.mouse.down();
  await page.mouse.move(...(await at(page, 2, 1)), { steps: 5 });
  await page.mouse.up();
  const after = (await objs(page)).find((o: any) => o.type === "label");
  expect(after.p.x - before.p.x).toBeCloseTo(2, 6);
  expect(after.p.y - before.p.y).toBeCloseTo(1, 6);
});

test("colour picker: a hex colour becomes the stroke and is kept as a swatch", async ({ page }) => {
  await setup(page);
  await line(page, [0, 0], [2, 0]);
  await page.getByTestId("stroke-swatches-more").click();
  await page.getByTestId("hex-input").fill("#8a2be2");
  await page.getByTestId("picker-ok").click();
  expect((await objs(page))[0].style.stroke).toBe("{rgb,255:red,138;green,43;blue,226}");
  expect((await st(page)).settings.customColors[0]).toBe("{rgb,255:red,138;green,43;blue,226}");
  await expect(page.getByTestId("stroke-swatches").locator("button[title=white]")).toHaveCount(1);
  await expect(page.getByTestId("stroke-swatches").locator("button[title=brown]")).toHaveCount(1);
});

test("a styled piece keeps its look after the line that cut it is deleted", async ({ page }) => {
  await setup(page);
  await circle(page, [0, 0], 2);
  await line(page, [-3, 0], [3, 0]);
  await page.mouse.click(...(await at(page, 0, 2)));
  await page.getByTestId("pieces-toggle").click();
  await page.getByTestId("piece").first().click();
  await page.getByTestId("stroke-swatches").locator("button[title=red]").click();
  await page.mouse.click(...(await at(page, 2.6, 0)));
  await page.keyboard.press("Backspace");
  const c = (await objs(page))[0];
  expect(c.parts).toHaveLength(1);
  await page.mouse.click(...(await at(page, 0, 2)));
  await expect(page.getByTestId("pieces-toggle")).toContainText("2 pieces");
});

test("text along a curve: written along it, exported with text along path", async ({ page }) => {
  await setup(page);
  await curve(page, [[-2, 0], [0, 1], [2, 0]]);
  await page.getByTestId("curve-text").fill("hello there");
  await page.getByTestId("curve-text").press("Enter");
  expect((await objs(page))[0].text).toBe("hello there");
  await expect(page.locator("svg.canvas textPath")).toHaveText("hello there");
  await page.evaluate(() => {
    (navigator.clipboard as any).writeText = async (t: string) => void ((window as any).__copied = t);
  });
  await page.getByTestId("copy-tikz").click();
  await expect.poll(() => page.evaluate(() => (window as any).__copied ?? "")).toContain("decoration={text along path,text={hello there}");
});

test("arrow keys move less when zoomed in; Math and Text are two buttons", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("d");
  await page.mouse.click(...(await at(page, 0, 0)));
  await page.keyboard.press("ArrowRight");
  expect((await objs(page))[0].p.x).toBeCloseTo(0.25, 9);
  await page.evaluate(() => (window as any).__store.set({ view: { cx: 0, cy: 0, zoom: 400 } }));
  await page.keyboard.press("ArrowRight");
  expect((await objs(page))[0].p.x).toBeCloseTo(0.25 + 0.03125, 9);
  await page.keyboard.press("t");
  await page.mouse.click(...(await at(page, 0, -0.5)));
  await expect(page.getByTestId("mode-math")).toHaveClass(/active/);
  await page.getByTestId("mode-text").click();
  await expect(page.getByTestId("mode-text")).toHaveClass(/active/);
});

test("snippets inside snippets (as in VS Code)", async ({ page }) => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = mkdtempSync(path.join(os.tmpdir(), "snip-"));
  const file = path.join(dir, "latex.json");
  writeFileSync(file, JSON.stringify({ Par: { prefix: "PAR", body: "\\left( $1 \\right)$0" }, Frac: { prefix: "FRAC", body: "\\frac{$1}{$2}$0" } }));
  await setup(page, { snippetFile: file });
  await page.keyboard.press("t");
  await page.mouse.click(...(await at(page, 0, 0)));
  // The snippet file is read again when the edit starts (yalatex's has a PAR too).
  await page.waitForTimeout(400);
  await page.keyboard.type("par");
  await expect(page.locator(".suggest-widget")).toContainText("PAR");
  await page.keyboard.press("Enter");
  await page.keyboard.type("fra");
  await expect(page.locator(".suggest-widget")).toContainText("FRAC");
  await page.keyboard.press("Enter");
  await page.keyboard.type("1");
  await page.keyboard.press("Tab");
  await page.keyboard.type("2");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  expect((await objs(page))[0].text).toBe("\\left( \\frac{1}{2} \\right)");
});

test("settings can hide the keys on buttons", async ({ page }) => {
  await setup(page);
  await expect(page.getByTestId("tool-line").locator(".key")).toHaveCount(1);
  await page.evaluate(() => {
    const s = (window as any).__store;
    s.set({ settings: { ...s.get().settings, showToolbarKeys: false } });
  });
  await expect(page.getByTestId("tool-line").locator(".key")).toHaveCount(0);
  await line(page, [0, 0], [1, 0]);
  await expect(page.getByTestId("style-panel").locator(".pkey").first()).toBeVisible();
});
