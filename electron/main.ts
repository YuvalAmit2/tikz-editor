// Electron main process: one window, the backend API over IPC.
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { execFile } from "node:child_process";
import { createApi } from "../server/api.ts";

const devUrl = process.env.VITE_DEV_SERVER_URL;
app.setName("TikZ Editor");
// Tests (and anyone who wants a separate profile) can choose the data folder.
if (process.env.TIKZ_EDITOR_HOME) app.setPath("userData", process.env.TIKZ_EDITOR_HOME);

/** A .tikz path passed on the command line (`tikz-editor graphics/torus.tikz`). */
function fileFromArgv(argv: string[], cwd: string): string | null {
  const f = argv.slice(1).find((a) => a.endsWith(".tikz"));
  return f ? path.resolve(cwd, f) : null;
}

/** The app that opened the figure (bundle id, from the launcher): ⌘Enter goes back to it. */
function returnFromArgv(argv: string[]): string | null {
  const a = argv.find((x) => x.startsWith("--return-to="));
  return a ? a.slice("--return-to=".length) : null;
}
let returnTo: string | null = returnFromArgv(process.argv);

let win: BrowserWindow | null = null;

async function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "TikZ Editor",
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (devUrl) await win.loadURL(devUrl);
  else await win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv, cwd) => {
    const f = fileFromArgv(argv, cwd);
    returnTo = returnFromArgv(argv) ?? returnTo;
    if (win) {
      if (win.isMinimized()) win.restore();
      app.show?.();
      win.show();
      win.focus();
      if (f) win.webContents.send("open-file", f);
    }
  });

  app.whenReady().then(async () => {
    const handle = createApi({
      dataDir: app.getPath("userData"),
      startupFile: fileFromArgv(process.argv, process.cwd()),
      async showSaveDialog(defaultPath) {
        const r = await dialog.showSaveDialog(win!, {
          defaultPath,
          filters: [{ name: "TikZ figure", extensions: ["tikz"] }],
        });
        return r.canceled ? null : (r.filePath ?? null);
      },
      async showOpenDialog() {
        const r = await dialog.showOpenDialog(win!, {
          properties: ["openFile"],
          filters: [{ name: "TikZ figure", extensions: ["tikz"] }],
        });
        return r.canceled ? null : r.filePaths[0];
      },
    });
    ipcMain.handle("api", (_e, method: string, params: unknown) => handle(method, params));
    // "Save and go back": hide the app (macOS returns focus to the previous
    // app, e.g. VS Code) but keep it running, so the next figure opens instantly.
    ipcMain.on("hide", () => {
      if (process.platform === "darwin") {
        app.hide();
        // Hiding alone gives focus to whichever app macOS picks; go back to
        // the one that opened the figure.
        if (returnTo) execFile("open", ["-b", returnTo], () => {});
      }
      else win?.minimize();
    });
    await createWindow();
  });

  app.on("window-all-closed", () => app.quit());
}
