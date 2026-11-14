// Browser dev mode: serve the backend API at POST /api on the Vite dev server.
import type { Plugin } from "vite";
import { createApi, defaultDataDir } from "./api.ts";

export function apiPlugin(): Plugin {
  return {
    name: "tikz-editor-api",
    configureServer(server) {
      const handle = createApi({
        dataDir: defaultDataDir(),
        startupFile: process.env.TIKZ_EDITOR_FILE ?? null,
      });
      server.middlewares.use("/api", (req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", async () => {
          res.setHeader("Content-Type", "application/json");
          try {
            const { method, params } = JSON.parse(body || "{}");
            const result = await handle(method, params);
            res.end(JSON.stringify({ ok: true, result: result ?? null }));
          } catch (e) {
            res.end(JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }));
          }
        });
      });
    },
  };
}
