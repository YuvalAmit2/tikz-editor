import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

// UI tests run against the browser dev mode (same front end as the app).
// Set CHROME_PATH to use an installed Chrome instead of Playwright's Chromium.
const home = path.join(os.tmpdir(), "tikz-editor-e2e");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5174",
    viewport: { width: 1280, height: 820 },
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ["--no-sandbox"] } : {},
  },
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 5174 --strictPort",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
    env: { TIKZ_EDITOR_HOME: home },
  },
});
