import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "../..");
const electronBin = path.join(root, "node_modules/.bin/electron");

let app: ElectronApplication;
let page: Page;
let home: string;
let work: string;

test.beforeAll(async () => {
  home = mkdtempSync(path.join(os.tmpdir(), "tikz-app-home-"));
  work = mkdtempSync(path.join(os.tmpdir(), "tikz-app-work-"));
  app = await electron.launch({ args: [root, path.join(work, "graphics/first.tikz")], env: { ...process.env, TIKZ_EDITOR_HOME: home } as Record<string, string> });
  page = await app.firstWindow();
  await page.waitForFunction(() => (window as any).__store?.get().filePath);
  await page.evaluate(() => (window as any).__store.set({ view: { cx: 0, cy: 0, zoom: 40 } }));
});

test.afterAll(async () => {
  await app?.close();
});

const st = <T>(f: string) => page.evaluate(`(() => { const s = window.__store.get(); return ${f}; })()`) as Promise<T>;
async function at(x: number, y: number): Promise<[number, number]> {
  const b = (await page.getByTestId("canvas").boundingBox())!;
  return [b.x + b.width / 2 + x * 40, b.y + b.height / 2 - y * 40];
}

test("opens the figure given on the command line, draws, saves with ⌘S", async () => {
  expect(await st<string>("s.filePath")).toBe(path.join(work, "graphics/first.tikz"));
  await page.keyboard.press("b");
  for (const [x, y] of [[-2, 0], [0, 1.5], [2, 0]] as const) await page.mouse.click(...(await at(x, y)));
  await page.keyboard.press("Enter");
  expect(await st<string[]>("s.scene.objects.map(o => o.type)")).toEqual(["curve"]);
  await page.keyboard.press("Meta+s");
  await expect.poll(() => existsSync(path.join(work, "graphics/first.tikz"))).toBe(true);
  expect(readFileSync(path.join(work, "graphics/first.tikz"), "utf8")).toContain(".. controls");
});

test("labels compile in the app", async () => {
  await page.evaluate(() =>
    fetch === fetch && (window as any).__store.set({ settings: { ...(window as any).__store.get().settings, preamble: "\\usepackage{amssymb}", preambleFile: "" } }),
  );
  await page.keyboard.press("t");
  await page.mouse.click(...(await at(0, -2)));
  await page.keyboard.type("\\mathbb{Z}_p");
  await page.keyboard.press("Enter");
  await expect(page.locator("svg.canvas image")).toHaveCount(1, { timeout: 30_000 });
});

test("the library works in the app (in-app name prompt)", async () => {
  await page.keyboard.press("Meta+a");
  await page.getByText("Add to library").click();
  await page.getByTestId("prompt").locator("input").fill("arc");
  await page.keyboard.press("Enter");
  await expect.poll(() => existsSync(path.join(home, "library/arc.json"))).toBe(true);
  await page.getByTestId("tab-library").click();
  await expect(page.getByTestId("library-item")).toHaveCount(1);
});

test("a second launch opens its figure in the running window (saving the current one)", async () => {
  await page.keyboard.press("Escape");
  await page.keyboard.press("l");
  await page.mouse.click(...(await at(-1, -1)));
  await page.mouse.click(...(await at(1, -1)));
  expect(await st<boolean>("s.dirty")).toBe(true);
  const second = path.join(work, "graphics/second.tikz");
  const p = spawn(electronBin, [root, second], { env: { ...process.env, TIKZ_EDITOR_HOME: home }, stdio: "ignore" });
  await new Promise((r) => p.on("exit", r));
  await expect.poll(() => st<string>("s.filePath"), { timeout: 15_000 }).toBe(second);
  // The first figure was saved before switching
  const first = readFileSync(path.join(work, "graphics/first.tikz"), "utf8");
  expect(first).toMatch(/\\path\[draw\] \(-1,-1\) -- \(1,-1\);/);
});

test("⌘Enter saves and hides the window", async () => {
  await page.keyboard.press("d");
  await page.mouse.click(...(await at(0, 0)));
  await page.keyboard.press("Meta+Enter");
  await expect.poll(() => existsSync(path.join(work, "graphics/second.tikz"))).toBe(true);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
});
