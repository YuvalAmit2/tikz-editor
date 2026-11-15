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

  async function libraryDir(): Promise<string> {
    const s = await getSettings();
    const dir = s.libraryDir ? expandHome(s.libraryDir) : path.join(platform.dataDir, "library");
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }
  /** File name for a library item: its name, made safe. */
  const itemFile = (name: string) =>
    name
      .trim()
      .replace(/[^\p{L}\p{N} _.-]+/gu, "-")
      .replace(/^\.+/, "")
      .slice(0, 80) + ".json";

  /** The library's order: file names, first to last. */
  const ORDER = ".order.json"; // item files never start with a dot
  async function readOrder(dir: string): Promise<string[]> {
    try {
      const v = JSON.parse(await fs.readFile(path.join(dir, ORDER), "utf8"));
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  const handlers: Record<string, (p: any) => Promise<unknown>> = {
    /** All library items (each a JSON file in the library folder), newest first. */
    async listLibrary() {
      const dir = await libraryDir();
      const out: unknown[] = [];
      for (const f of await fs.readdir(dir)) {
        if (!f.endsWith(".json") || f === ORDER) continue;
        try {
          const item = JSON.parse(await fs.readFile(path.join(dir, f), "utf8"));
          if (item && Array.isArray(item.objects)) out.push({ ...item, file: f });
        } catch {
          // ignore broken files
        }
      }
      // In the order you put them in (.order.json); new ones first, newest first.
      const order = await readOrder(dir);
      const rank = (f: string) => {
        const i = order.indexOf(f);
        return i < 0 ? -1 : i;
      };
      out.sort((a: any, b: any) => rank(a.file) - rank(b.file) || (b.created ?? 0) - (a.created ?? 0));
      return out;
    },
    /** Keep the library in this order (file names). */
    async setLibraryOrder(p: { files: string[] }) {
      const dir = await libraryDir();
      await fs.writeFile(path.join(dir, ORDER), JSON.stringify(p.files.map((f) => path.basename(f)), null, 1) + "\n");
      return true;
    },
    /** Give an item a new name (its file is renamed too; it keeps its place). */
    async renameLibraryItem(p: { file: string; name: string }) {
      const dir = await libraryDir();
      const old = path.basename(p.file);
      const file = itemFile(p.name);
      if (file === ".json") throw new Error("Give the figure a name");
      const item = JSON.parse(await fs.readFile(path.join(dir, old), "utf8"));
      if (file !== old && (await fs.stat(path.join(dir, file)).catch(() => null))) throw new Error(`There's already one called “${p.name}”`);
      await fs.writeFile(path.join(dir, file), JSON.stringify({ ...item, name: p.name.trim() }, null, 1) + "\n");
      if (file !== old) {
        await fs.rm(path.join(dir, old), { force: true });
        const order = await readOrder(dir);
        if (order.includes(old)) await fs.writeFile(path.join(dir, ORDER), JSON.stringify(order.map((f) => (f === old ? file : f)), null, 1) + "\n");
      }
      return file;
    },
    async saveLibraryItem(p: { item: { name: string } }) {
      const dir = await libraryDir();
      const file = itemFile(p.item.name);
      if (file === ".json") throw new Error("Give the figure a name");
      await fs.writeFile(path.join(dir, file), JSON.stringify(p.item, null, 1) + "\n");
      return file;
    },
    async deleteLibraryItem(p: { file: string }) {
      const dir = await libraryDir();
      const f = path.basename(p.file);
      await fs.rm(path.join(dir, f), { force: true });
      return true;
    },
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
