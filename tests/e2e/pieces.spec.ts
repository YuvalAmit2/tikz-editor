// Styling pieces of an object (the stretches between crossings).
import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__store && (window as any).__ready);
  await page.evaluate(() => {
    const s = (window as any).__store;
    const st = s.get().style;
    s.set({
      view: { cx: 0, cy: 0, zoom: 40 },
      scene: {
        version: 1,
        objects: [
          { id: "s", type: "ellipse", style: st, c: { x: 0, y: 0 }, rx: 3, ry: 3, rot: 0 },
          { id: "e", type: "ellipse", style: st, c: { x: 0, y: 0 }, rx: 3, ry: 0.6, rot: 0 },
        ],
      },
    });
  });
}
async function at(page: Page, x: number, y: number): Promise<[number, number]> {
  const b = (await page.getByTestId("canvas").boundingBox())!;
  return [b.x + b.width / 2 + x * 40, b.y + b.height / 2 - y * 40];
}
const equator = (page: Page) => page.evaluate(() => (window as any).__store.get().scene.objects[1]);

test("the upper half of a sphere's equator, dashed, from the Pieces list", async ({ page }) => {
  await setup(page);
  await page.mouse.click(...(await at(page, 0, 0.6)));
  await expect(page.getByTestId("pieces-toggle")).toContainText("2 pieces");
  // Collapsed until opened
  await expect(page.getByTestId("piece")).toHaveCount(0);
  await page.getByTestId("pieces-toggle").click();
  // Each piece is drawn: the whole ellipse with that piece picked out. Piece 1 is the top.
  await expect(page.getByTestId("piece")).toHaveText(["1", "2"]);
  await expect(page.getByTestId("piece").first().locator("svg path")).toHaveCount(2);
  await page.getByTestId("piece").first().hover();
  await expect(page.getByTestId("piece-highlight")).toHaveCount(1);
  await page.getByTestId("piece").first().click();
  await expect(page.getByTestId("style-panel")).toContainText("Ellipse · piece 1");
  await page.keyboard.press("-");
  const e = await equator(page);
  expect(e.parts).toHaveLength(1);
  expect(e.parts[0].style).toEqual({ dash: "dashed" });
  // The dashed piece is the upper half
  expect(e.parts[0].at % 4).toBeGreaterThan(0);
  expect(e.parts[0].at % 4).toBeLessThan(2);
  expect(e.style.dash).toBe("solid");
  // Pressing - again on the dashed piece makes it solid (and the part goes)
  await page.keyboard.press("-");
  expect((await equator(page)).parts).toBeUndefined();
  await page.keyboard.press("-");
  // Red too: colour applies to the piece only
  await page.getByTestId("stroke-swatches").locator("button[title=red]").click();
  expect((await equator(page)).parts[0].style).toEqual({ dash: "dashed", stroke: "red" });
  // "whole" goes back to styling the whole ellipse
  await page.getByText("whole").click();
  await page.getByTestId("stroke-swatches").locator("button[title=blue]").click();
  const w = await equator(page);
  expect(w.style.stroke).toBe("blue");
  expect(w.parts[0].style.stroke).toBe("red");
  // Export: the fill-less ellipse becomes two paths, one dashed and red
  await page.evaluate(() => {
    (navigator.clipboard as any).writeText = async (t: string) => void ((window as any).__copied = t);
  });
  await page.getByTestId("copy-tikz").click();
  const tikz: string = await page.evaluate(() => (window as any).__copied);
  expect(tikz).toMatch(/\\path\[draw=red,dashed\] \(-?3,0\) \.\. controls/);
  expect(tikz).toMatch(/\\path\[draw=blue\] \(-?3,0\) \.\. controls/);
});
