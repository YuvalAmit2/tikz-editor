// Front-end side of the backend API: Electron IPC when running in the app,
// HTTP to the Vite dev server when running in a browser.

declare global {
  interface Window {
    tikzApi?: { call(method: string, params: unknown): Promise<unknown> };
  }
}

export const isElectron = typeof window !== "undefined" && !!window.tikzApi;

export async function call<T = unknown>(method: string, params: unknown = {}): Promise<T> {
  if (window.tikzApi) return (await window.tikzApi.call(method, params)) as T;
  const r = await fetch("/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error);
  return j.result as T;
}
