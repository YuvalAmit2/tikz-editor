// UI tests for curves, sketching, snippets, the library, the palette, presets.
import { expect, test, type Page } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";

const PREAMBLE = "\\usepackage{amssymb}\\newcommand{\\Z}{\\mathbb{Z}}";

async function setup(page: Page, extra: Record<string, unknown> = {}) {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__store && (window as any).__ready);
  await page.evaluate(
    async ({ preamble, extra }) => {
      const s = (window as any).__store;
      const settings = { ...s.get().settings, preamble, preambleFile: "", documentClass: "\\documentclass[11pt]{article}", presets: [], recognizeShapes: true, sketchSmoothing: 4, showGrid: true, snapToGrid: true, snapToObjects: true, returnToSelect: true, gridSize: 0.25, snippetFile: "", toolKeys: {}, ...extra };
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
const st = (page: Page) => page.evaluate(() => {
  const s = (window as any).__store.get();
  return { tool: s.tool, selection: s.selection, pointEdit: s.pointEdit, activeNode: s.activeNode, style: s.style, palette: s.palette };
});

async function clickAll(page: Page, pts: [number, number][]) {
  for (const [x, y] of pts) await page.mouse.click(...(await at(page, x, y)));
}

test("curve tool: place, edit handles, toggle corner, insert and delete anchors", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("b");
  await clickAll(page, [[-4, 0], [-2, 2], [0, 0], [2, 2]]);
  await page.keyboard.press("Enter");
  let o = (await objs(page))[0];
  expect(o.type).toBe("curve");
  expect(o.nodes.map((n: any) => [n.p.x, n.p.y])).toEqual([[-4, 0], [-2, 2], [0, 0], [2, 2]]);
  expect((await st(page)).tool).toBe("select");

  // Point editing
  await page.mouse.dblclick(...(await at(page, 0, 0)));
  expect((await st(page)).pointEdit).toBe(o.id);
  await expect(page.getByTestId("control-handle").first()).toBeVisible();

  // Drag the first control handle of anchor 2 (its incoming one)
  const handles = await page.evaluate(() => {
    const s = (window as any).__store.get();
    return s;
  });
  void handles;
  const box = (await page.getByTestId("control-handle").nth(2).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 30, box.y - 30, { steps: 5 });
  await page.mouse.up();
  o = (await objs(page))[0];
  expect(o.nodes.some((n: any) => n.mode === "manual")).toBe(true);

  // The dragged handle belonged to anchor 1, which is now manual; double-click
  // resets a manual anchor to smooth, and a smooth one to a corner.
  expect(o.nodes[1].mode).toBe("manual");
  await page.mouse.dblclick(...(await at(page, -2, 2)));
  expect((await objs(page))[0].nodes[1].mode).toBe("smooth");
  await page.mouse.dblclick(...(await at(page, -2, 2)));
  o = (await objs(page))[0];
  expect(o.nodes[1].mode).toBe("corner");

  // Double-click on the line between anchors: insert one
  const before = o.nodes.length;
  const mid = await page.evaluate(() => {
    const o = (window as any).__store.get().scene.objects[0];
    return o.nodes[0].p;
  });
  void mid;
  // a point on the straight-ish first piece (corner makes it straight): halfway from (-4,0) to (-2,2)
  await page.mouse.move(...(await at(page, -3, 1)), { steps: 2 });
  await page.keyboard.press("Enter");
  o = (await objs(page))[0];
  expect(o.nodes.length).toBe(before + 1);
  expect((await st(page)).activeNode).toBe(1);
  await page.keyboard.press("Backspace");
  expect((await objs(page))[0].nodes.length).toBe(before);
  await page.keyboard.press("Escape");
  expect((await st(page)).pointEdit).toBeNull();

  // Undo goes back step by step
  await page.keyboard.press("Control+z");
  expect((await objs(page))[0].nodes.length).toBe(before + 1);
});

test("curve tool: clicking the first point closes the curve; drag sets a handle", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("b");
  await clickAll(page, [[0, 0], [2, 0]]);
  // pen-style drag on the third anchor
  const p = await at(page, 2, 2);
  await page.mouse.move(...p);
  await page.mouse.down();
  await page.mouse.move(p[0] - 40, p[1], { steps: 4 });
  await page.mouse.up();
  await clickAll(page, [[0, 0]]);
  const o = (await objs(page))[0];
  expect(o.closed).toBe(true);
  expect(o.nodes).toHaveLength(3);
  expect(o.nodes[2].mode).toBe("manual");
  expect(o.nodes[2].hout.x).toBeCloseTo(-1, 1);
});

async function stroke(page: Page, pts: { x: number; y: number }[]) {
  await page.mouse.move(...(await at(page, pts[0].x, pts[0].y)));
  await page.mouse.down();
  for (const q of pts.slice(1)) await page.mouse.move(...(await at(page, q.x, q.y)));
  await page.mouse.up();
}

test("sketch tool: a wobbly circle becomes a circle; undo gives the freehand curve", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("s");
  await expect(page.getByTestId("sketch-options")).toBeVisible();
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const pts = [];
  for (let i = 0; i <= 90; i++) {
    const a = (i / 90) * 2 * Math.PI * 1.03;
    pts.push({ x: 2 * Math.cos(a) + rnd() * 0.06, y: 2 * Math.sin(a) + rnd() * 0.06 });
  }
  await stroke(page, pts);
  const o = (await objs(page))[0];
  expect(o.type).toBe("ellipse");
  expect(o.rx).toBeCloseTo(o.ry, 6);
  expect(Math.abs(o.rx - 2)).toBeLessThan(0.2);
  await page.keyboard.press("Control+z");
  expect((await objs(page))[0].type).toBe("curve");
});

test("sketch tool: with recognition off, a wobbly line stays a curve", async ({ page }) => {
  await setup(page, { recognizeShapes: false });
  await page.keyboard.press("s");
  const pts = [];
  for (let i = 0; i <= 40; i++) pts.push({ x: -3 + i * 0.15, y: Math.sin(i / 6) * 0.8 });
  await stroke(page, pts);
  const o = (await objs(page))[0];
  expect(o.type).toBe("curve");
  expect(o.nodes.length).toBeLessThan(8);
});

test("snippets from the snippet file work in the label editor", async ({ page }) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "snip-"));
  const file = path.join(dir, "latex.json");
  writeFileSync(file, `{ // test
    "Frac": { "prefix": "FRAC", "body": ["\\\\frac{\${1:$TM_SELECTED_TEXT}}{$2}$0"], },
    "Thm": { "prefix": "THM", "body": ["\\\\begin{thm}", "$1", "\\\\end{thm}"] },
  }`);
  await setup(page, { snippetFile: file });
  await page.keyboard.press("t");
  await page.mouse.click(...(await at(page, 0, 0)));
  await page.keyboard.type("x = FRA");
  await expect(page.locator(".suggest-widget")).toContainText("FRAC");
  await page.keyboard.press("Tab");
  await page.keyboard.type("1");
  await page.keyboard.press("Tab");
  await page.keyboard.type("2");
  await page.keyboard.press("Enter");
  expect((await objs(page))[0].text).toBe("x = \\frac{1}{2}");
  // Environment snippets are not offered
  await page.keyboard.press("t");
  await page.mouse.click(...(await at(page, 3, 0)));
  await page.keyboard.type("TH");
  await page.waitForTimeout(400);
  await expect(page.locator(".suggest-widget.visible")).toHaveCount(0);
});

test("command palette runs commands and finds tools", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.keyboard.type("rectangle");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await st(page)).tool).toBe("rect");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("hide grid");
  await page.keyboard.press("Enter");
  await expect.poll(async () => page.evaluate(() => (window as any).__store.get().settings.showGrid)).toBe(false);
  await page.keyboard.press("Control+k");
  await page.keyboard.press("Escape");
  expect((await st(page)).palette).toBe(false);
});

test("library: add a selection, insert it, delete it", async ({ page }) => {
  await setup(page);
  page.on("dialog", (d) => d.accept());
  await page.keyboard.press("e"); // ellipse with ⇧: a circle
  await page.keyboard.down("Shift");
  await page.mouse.move(...(await at(page, 0, 0)));
  await page.mouse.down();
  await page.mouse.move(...(await at(page, 1, 0)), { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await page.getByText("Add to library").click();
  await page.getByTestId("prompt").locator("input").fill("unit circle");
  await page.keyboard.press("Enter");
  await page.getByTestId("tab-library").click();
  await expect(page.getByTestId("library-item")).toHaveCount(1);
  await expect(page.getByTestId("library-item")).toContainText("unit circle");
  await page.getByTestId("library-item").click();
  expect(await objs(page)).toHaveLength(2);
  await page.getByTestId("library-item").hover();
  await page.getByTestId("library-item").locator(".remove").click();
  await expect(page.getByTestId("library-item")).toHaveCount(0);
});

test("restyling a selection also sets the new-object style; presets apply with ⌥1", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("l");
  await page.mouse.click(...(await at(page, 0, 0)));
  await page.mouse.click(...(await at(page, 2, 0)));
  // selected after placing: make it red and thick
  await page.getByTestId("stroke-swatches").locator('button[title="red"]').click();
  await page.keyboard.press("5");
  const o = (await objs(page))[0];
  expect(o.style.stroke).toBe("red");
  expect(o.style.width).toBe(0.8);
  expect((await st(page)).style.stroke).toBe("red");
  expect((await st(page)).style.width).toBe(0.8);
  // Save the red style as a preset, then apply it to a new line with ⌥1
  await page.getByTestId("preset-add").click();
  await page.getByTestId("prompt").locator("input").fill("red thick");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  // Nothing selected: back to black for new objects
  await page.getByTestId("stroke-swatches").locator('button[title="black"]').click();
  await page.keyboard.press("3");
  await page.keyboard.press("l");
  await page.mouse.click(...(await at(page, 0, 1)));
  await page.mouse.click(...(await at(page, 2, 1)));
  expect((await objs(page))[1].style.stroke).toBe("black");
  await page.keyboard.press("Alt+Digit1");
  expect((await objs(page))[1].style.stroke).toBe("red");
  expect((await objs(page))[1].style.width).toBe(0.8);
});

test("z-order and align", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("r");
  await page.mouse.move(...(await at(page, 0, 0)));
  await page.mouse.down();
  await page.mouse.move(...(await at(page, 2, 2)), { steps: 3 });
  await page.mouse.up();
  await page.keyboard.press("e"); // ellipse with ⇧: a circle
  await page.keyboard.down("Shift");
  await page.mouse.move(...(await at(page, 5, 3)));
  await page.mouse.down();
  await page.mouse.move(...(await at(page, 6, 3)), { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  // circle is selected and on top: send it back
  await page.keyboard.press("Control+BracketLeft");
  expect((await objs(page)).map((o: any) => o.type)).toEqual(["ellipse", "path"]);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("align left");
  await page.keyboard.press("Enter");
  await expect.poll(async () => {
    const [e, r] = await objs(page);
    return Math.abs(e.c.x - e.rx - r.pts[0].x) < 1e-6;
  }).toBe(true);
});

test("save and reopen a figure with curves through the in-app prompt", async ({ page }) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fig-"));
  const file = path.join(dir, "graphics", "wave.tikz");
  await setup(page);
  await page.keyboard.press("b");
  await clickAll(page, [[0, 0], [1, 1], [2, 0]]);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+s");
  await page.getByTestId("prompt").locator("input").fill(file);
  await page.keyboard.press("Enter");
  await expect.poll(() => { try { return readFileSync(file, "utf8"); } catch { return ""; } }).toContain(".. controls");
  await expect.poll(() => page.evaluate(() => (window as any).__store.get().dirty)).toBe(false);
  await page.keyboard.press("Control+n");
  expect(await objs(page)).toHaveLength(0);
  await page.keyboard.press("Control+o");
  await page.getByTestId("prompt").locator("input").fill(file);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await objs(page)).length).toBe(1);
  expect((await objs(page))[0].type).toBe("curve");
});
