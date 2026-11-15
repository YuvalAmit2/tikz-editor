import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tikzApi", {
  call: (method: string, params: unknown) => ipcRenderer.invoke("api", method, params),
  hide: () => ipcRenderer.send("hide"),
  onOpenFile: (cb: (path: string) => void) => {
    ipcRenderer.on("open-file", (_e, p: string) => cb(p));
  },
  /** The app's menu and close button (new tab, close tab, close window...). */
  onMenu: (cb: (what: string) => void) => {
    ipcRenderer.on("menu", (_e, what: string) => cb(what));
  },
  /** Every tab has been saved or let go: close the window now. */
  closeWindow: () => ipcRenderer.send("close-window"),
});
