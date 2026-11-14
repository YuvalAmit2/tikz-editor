import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tikzApi", {
  call: (method: string, params: unknown) => ipcRenderer.invoke("api", method, params),
  hide: () => ipcRenderer.send("hide"),
  onOpenFile: (cb: (path: string) => void) => {
    ipcRenderer.on("open-file", (_e, p: string) => cb(p));
  },
});
