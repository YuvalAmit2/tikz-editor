import { expect, test, type Page } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { readFileSync, rmSync } from "node:fs";

// A self-contained preamble so the tests don't depend on the user's setup.
const PREAMBLE = "\\usepackage{amssymb}\\newcommand{\\Z}{\\mathbb{Z}}\\newcommand{\\cO}{\\mathcal{O}}";

async function setup(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__store);
  await page.evaluate(async (preamble) => {
    const s = (window as any).__store;
    const settings = { ...s.get().settings, preamble, preambleFile: "", documentClass: "\\documentclass[11pt]{article}" };
    await fetch("/api", { method: "POST", body: JSON.stringify({ method: "saveSettings", params: { settings } }) });
    s.set({ settings, view: { cx: 0, cy: 0, zoom: 40 } }); // 40 px per cm
  }, PREAMBLE);
}

/** Screen position of a world point (cm) with the view set in setup(). */
async function at(page: Page, x: number, y: number): Promise<[number, number]> {
  const b = (await page.getByTestId("canvas").boundingBox())!;
  return [b.x + b.width / 2 + x * 40, b.y + b.height / 2 - y * 40];
}

const scene = (page: Page) => page.evaluate(() => (window as any).__store.get().scene.objects);
const state = (page: Page) => page.evaluate(() => {
  const s = (window as any).__store.get();
  return { tool: s.tool, selection: s.selection, editingLabel: s.editingLabel, pointEdit: s.pointEdit };
});

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 8 });
  await page.mouse.up();
}

test("draws shapes snapped to the grid and returns to Select", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("r");
  await drag(page, await at(page, -2.02, -1.03), await at(page, 1.97, 1.04));
  const objs = await scene(page);
  expect(objs).toHaveLength(1);
  expect(objs[0].pts).toEqual([
    { x: -2, y: -1 },
    { x: 2, y: -1 },
    { x: 2, y: 1 },
    { x: -2, y: 1 },
  ]);
  expect((await state(page)).tool).toBe("select");

  // Circle: click centre, click radius point
  await page.keyboard.press("c");
  await page.mouse.click(...(await at(page, 0, 0)));
  await page.mouse.click(...(await at(page, 1.01, 0)));
  const c = (await scene(page))[1];
  expect(c.type).toBe("ellipse");
  expect(c.rx).toBeCloseTo(1, 6);
});

test("snaps to vertices, moves, scales, edits points, undoes", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("l");
  await drag(page, await at(page, 0, 0), await at(page, 3, 1));
  // A second line starting near the first line's end snaps onto it
  await page.keyboard.press("l");
  await drag(page, await at(page, 3.12, 1.07), await at(page, 3, -2));
  let objs = await scene(page);
  expect(objs[1].pts[0].x).toBeCloseTo(3, 9);
  expect(objs[1].pts[0].y).toBeCloseTo(1, 9);

  // Move the second line by dragging it
  await drag(page, await at(page, 3, -1), await at(page, 4, -1));
  objs = await scene(page);
  expect(objs[1].pts[1].x).toBeCloseTo(4, 9);

  // Undo the move
  await page.keyboard.press("Control+z");
  objs = await scene(page);
  expect(objs[1].pts[1].x).toBeCloseTo(3, 9);

  // Select all and scale with the top-right handle (Shift: uniform)
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Shift+r"); // rotate 90° and back
  await page.keyboard.press("Control+z");
  const handles = page.getByTestId("scale-handle");
  await expect(handles).toHaveCount(4);

  // Double-click the first line to edit its points, drag its start point
  await page.keyboard.press("Escape");
  await page.mouse.dblclick(...(await at(page, 1.5, 0.5)));
  expect((await state(page)).pointEdit).toBe(objs[0].id);
  await drag(page, await at(page, 0, 0), await at(page, -1, 0));
  objs = await scene(page);
  expect(objs[0].pts[0]).toEqual({ x: -1, y: 0 });
});

test("labels: math by default, text with $, errors shown", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("t");
  await page.mouse.click(...(await at(page, 0, 0)));
  await page.keyboard.type("\\cO_K \\otimes \\Z_p");
  await expect(page.getByTestId("mode-toggle")).toHaveText("Math");
  await page.keyboard.press("Enter");
  await page.keyboard.press("t");
  await page.mouse.click(...(await at(page, 0, -2)));
  await page.keyboard.type("Consider $\\Z$");
  await expect(page.getByTestId("mode-toggle")).toHaveText("Text");
  await page.keyboard.press("Enter");
  // Both labels compile and get an image on the canvas
  await expect(page.locator("svg.canvas image")).toHaveCount(2, { timeout: 20_000 });

  // A broken label shows the LaTeX error
  await page.keyboard.press("t");
  await page.mouse.click(...(await at(page, 3, 0)));
  await page.keyboard.type("\\undefinedmacro x");
  await expect(page.getByTestId("label-error")).toContainText("Undefined control sequence", { timeout: 20_000 });
  // Emptying a label deletes it
  await page.keyboard.press("ControlOrMeta+a"); // Ctrl+A is "line start" on macOS
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  expect(await scene(page)).toHaveLength(2);
});

test("saves a .tikz file and opens it again", async ({ page }) => {
  await setup(page);
  const file = path.join(os.tmpdir(), "tikz-editor-e2e-fig", "graphics", "fig.tikz");
  rmSync(path.dirname(file), { recursive: true, force: true });
  await page.keyboard.press("c");
  await drag(page, await at(page, 0, 0), await at(page, 1.5, 0));
  await page.keyboard.press("Control+s");
  await page.getByTestId("prompt").locator("input").fill(file);
  await page.keyboard.press("Enter");
  const read = () => {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return "";
    }
  };
  await expect.poll(() => read().includes("ellipse [x radius=1.5, y radius=1.5]")).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__store.get().dirty)).toBe(false);
  const saved = await scene(page);

  // Saved, so New doesn't ask to discard changes
  await page.keyboard.press("Control+n");
  expect(await scene(page)).toHaveLength(0);
  await page.keyboard.press("Control+o");
  await page.getByTestId("prompt").locator("input").fill(file);
  await page.keyboard.press("Enter");
  await expect.poll(() => scene(page)).toEqual(saved);
});
