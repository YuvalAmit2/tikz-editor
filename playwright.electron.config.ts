import { defineConfig } from "@playwright/test";

// Tests of the desktop app itself (Electron). Run `npm run build` first.
export default defineConfig({
  testDir: "tests/electron",
  timeout: 60_000,
  workers: 1,
});
