// Compiled labels: requests are batched into one LaTeX run, the resulting
// PDF is opened with pdf.js, and each page (= label) is rasterised at the
// current zoom level so labels stay sharp when zooming.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { call } from "../api/client";
import type { Box } from "../model/geometry";
import type { Anchor, LabelObj } from "../model/types";
import { labelBody, labelNodeOpts } from "./mode";
import { store } from "../store";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const BP_TO_CM = 2.54 / 72;

interface Entry {
  status: "pending" | "ok" | "error";
  error?: string;
  page?: pdfjs.PDFPageProxy;
  w?: number; // cm
  h?: number; // cm
  /** Rendered images by pixels-per-cm bucket. */
  images: Map<number, string>;
  rendering: Set<number>;
}

const cache = new Map<string, Entry>();
let pending = new Map<string, { body: string; opts: string }>();
let timer: ReturnType<typeof setTimeout> | null = null;
let firstPending = 0;
let version = 0;
const listeners = new Set<() => void>();

export function labelKey(o: Pick<LabelObj, "text" | "textMode" | "font" | "style">): string {
  return labelNodeOpts(o) + "\u0000" + labelBody(o.text, o.textMode);
}

function changed() {
  version++;
  listeners.forEach((l) => l());
}

export const labelStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  version: () => version,
};

/** Forget everything (after the preamble changes). */
export function clearLabelCache() {
  cache.clear();
  changed();
}

function request(key: string, body: string, opts: string) {
  cache.set(key, { status: "pending", images: new Map(), rendering: new Set() });
  pending.set(key, { body, opts });
  // Short trailing debounce: wait for a pause in typing (max 250 ms).
  if (timer) clearTimeout(timer);
  if (!firstPending) firstPending = Date.now();
  const wait = Date.now() - firstPending > 250 ? 0 : 60;
  timer = setTimeout(() => {
    firstPending = 0;
    flush();
  }, wait);
}

async function flush() {
  timer = null;
  const batch = pending;
  pending = new Map();
  // Skip texts that are no longer on the canvas (intermediate states while
  // typing); they'll be requested again if they come back.
  const live = new Set(store.get().scene.objects.filter((o) => o.type === "label").map((o) => labelKey(o as LabelObj)));
  for (const key of batch.keys()) if (!live.has(key)) cache.delete(key);
  const labels = [...batch].filter(([key]) => live.has(key)).map(([key, j]) => ({ key, body: j.body, opts: j.opts }));
  if (labels.length === 0) return;
  try {
    const r = await call<{ pdf: string | null; pages: Record<string, number>; errors: Record<string, string> }>("compileLabels", { labels });
    let doc: pdfjs.PDFDocumentProxy | null = null;
    if (r.pdf) {
      const bytes = Uint8Array.from(atob(r.pdf), (c) => c.charCodeAt(0));
      doc = await pdfjs.getDocument({ data: bytes }).promise;
    }
    for (const { key } of labels) {
      const e = cache.get(key);
      if (!e) continue;
      if (r.errors[key]) {
        e.status = "error";
        e.error = r.errors[key];
      } else if (doc && r.pages[key]) {
        const page = await doc.getPage(r.pages[key]);
        const vp = page.getViewport({ scale: 1 });
        e.page = page;
        e.w = vp.width * BP_TO_CM;
        e.h = vp.height * BP_TO_CM;
        e.status = "ok";
      } else {
        e.status = "error";
        e.error = "No output";
      }
    }
  } catch (err) {
    for (const { key } of labels) {
      const e = cache.get(key);
      if (e) {
        e.status = "error";
        e.error = String((err as Error).message ?? err);
      }
    }
  }
  changed();
}

/** Look up (and request if needed) the compiled label. */
export function getLabel(o: LabelObj): Entry | null {
  const body = labelBody(o.text, o.textMode);
  if (!body) return null;
  const key = labelKey(o);
  let e = cache.get(key);
  if (!e) {
    request(key, body, labelNodeOpts(o));
    e = cache.get(key)!;
  }
  return e;
}

/** Zoom buckets so we don't re-render on every tiny zoom change. */
function bucket(pxPerCm: number): number {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(pxPerCm, 4)) * 2) / 2);
}

/** An image URL of the label rendered for this zoom (may be a lower-res one
 *  while the sharp one renders). */
export function labelImage(e: Entry, pxPerCm: number): string | null {
  if (e.status !== "ok" || !e.page) return null;
  const dpr = window.devicePixelRatio || 1;
  const b = bucket(pxPerCm * dpr);
  const img = e.images.get(b);
  if (img) return img;
  if (!e.rendering.has(b)) {
    e.rendering.add(b);
    const scale = b * BP_TO_CM; // canvas px per bp
    const vp = e.page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(vp.width));
    canvas.height = Math.max(1, Math.ceil(vp.height));
    e.page
      .render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp, background: "rgba(0,0,0,0)" } as any)
      .promise.then(() => {
        e.images.set(b, canvas.toDataURL("image/png"));
        e.rendering.delete(b);
        changed();
      })
      .catch(() => e.rendering.delete(b));
  }
  // Meanwhile, the closest existing render
  let best: string | null = null;
  let bd = Infinity;
  for (const [k, url] of e.images) {
    const d = Math.abs(Math.log(k / b));
    if (d < bd) {
      bd = d;
      best = url;
    }
  }
  return best;
}

/** Fraction of the box width/height from the box's lower-left corner to the anchor. */
export function anchorFrac(a: Anchor): { fx: number; fy: number } {
  const fx = a.includes("west") ? 0 : a.includes("east") ? 1 : 0.5;
  const fy = a.includes("south") ? 0 : a.includes("north") ? 1 : 0.5;
  return { fx, fy };
}

/** Box of a label in world coordinates (cm), if it has been compiled. */
export function labelBox(o: LabelObj): Box | null {
  const e = getLabel(o);
  if (!e || e.status !== "ok") {
    // Placeholder box while compiling / on error
    const s = 0.25;
    return { minX: o.p.x - s, minY: o.p.y - s, maxX: o.p.x + s, maxY: o.p.y + s };
  }
  const { fx, fy } = anchorFrac(o.anchor);
  const minX = o.p.x - fx * e.w!;
  const minY = o.p.y - fy * e.h!;
  return { minX, minY, maxX: minX + e.w!, maxY: minY + e.h! };
}
