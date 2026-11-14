// The backend API. The same handlers serve Electron (over IPC) and the
// browser dev mode (over HTTP via the Vite plugin).

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withDefaults, type Settings } from "../src/model/settings.ts";
import { extractPreamble, LabelCompiler, type LabelJob, type PreambleSpec } from "./tex.ts";

export interface Platform {
  /** Folder for settings.json and caches. */
  dataDir: string;
  /** Native file dialogs (Electron only). */
  showSaveDialog?: (defaultPath: string) => Promise<string | null>;
  showOpenDialog?: () => Promise<string | null>;
  /** File given on the command line, if any. */
  startupFile?: string | null;
}

export function defaultDataDir(): string {
  if (process.env.TIKZ_EDITOR_HOME) return process.env.TIKZ_EDITOR_HOME;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "tikz-editor");
  return path.join(os.homedir(), ".config", "tikz-editor");
}

export function createApi(platform: Platform) {
  const compiler = new LabelCompiler(path.join(platform.dataDir, "cache"));
  const settingsPath = path.join(platform.dataDir, "settings.json");

  async function getSettings(): Promise<Settings> {
    try {
      return withDefaults(JSON.parse(await fs.readFile(settingsPath, "utf8")));
    } catch {
      return withDefaults(undefined);
    }
  }

  async function preambleSpec(s: Settings): Promise<PreambleSpec> {
    if (s.preambleFile) {
      const tex = await fs.readFile(expandHome(s.preambleFile), "utf8");
      return extractPreamble(tex);
    }
    return { documentClass: s.documentClass, preamble: s.preamble };
  }

  const handlers: Record<string, (p: any) => Promise<unknown>> = {
    async getSettings() {
      return getSettings();
    },
    async saveSettings(p: { settings: Settings }) {
      await fs.mkdir(platform.dataDir, { recursive: true });
      await fs.writeFile(settingsPath, JSON.stringify(p.settings, null, 2) + "\n");
      return true;
    },
    async compileLabels(p: { labels: LabelJob[] }) {
      const spec = await preambleSpec(await getSettings());
      return compiler.compile(spec, p.labels);
    },
    async readFile(p: { path: string }) {
      return fs.readFile(expandHome(p.path), "utf8");
    },
    async writeFile(p: { path: string; content: string }) {
      const f = expandHome(p.path);
      await fs.mkdir(path.dirname(f), { recursive: true });
      await fs.writeFile(f, p.content);
      return true;
    },
    async fileExists(p: { path: string }) {
      return fs.access(expandHome(p.path)).then(
        () => true,
        () => false,
      );
    },
    async startupFile() {
      return platform.startupFile ?? null;
    },
    async showSaveDialog(p: { defaultPath: string }) {
      return platform.showSaveDialog ? platform.showSaveDialog(p.defaultPath) : undefined;
    },
    async showOpenDialog() {
      return platform.showOpenDialog ? platform.showOpenDialog() : undefined;
    },
  };

  return async function handle(method: string, params: unknown): Promise<unknown> {
    const h = handlers[method];
    if (!h) throw new Error(`Unknown API method: ${method}`);
    return h(params ?? {});
  };
}

function expandHome(p: string): string {
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}
