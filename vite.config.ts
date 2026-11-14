import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { apiPlugin } from "./server/vite-plugin.ts";

export default defineConfig({
  base: "./",
  plugins: [react(), apiPlugin()],
  server: { port: 5173, strictPort: true },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    testTimeout: 60_000,
  },
} as any);
