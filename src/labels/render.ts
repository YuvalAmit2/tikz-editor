// Compiled labels: requests are batched into one LaTeX run, the resulting
// PDF is opened with pdf.js, and each page (= label) is rasterised at the
// current zoom level so labels stay sharp when zooming.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { call } from "../api/client";
import type { Box } from "../model/geometry";
import type { Anchor, LabelObj, Vec } from "../model/types";
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
  /** The visible ink (plus a hair of padding), in cm from the node box's
   *  lower-left corner. The node box itself has TikZ's inner sep around TeX's
   *  box, which is much larger than the text and often lopsided ($z_2$,
   *  $\cdots$); the editor shows, picks and places labels by their ink. */
  ink?: Box;
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
        e.ink = await measureInk(page, e.w, e.h).catch(() => undefined);
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

/** Padding around the ink: 1pt, so the outline hugs the text without touching it. */
const INK_PAD = 2.54 / 72.27;

/** Where the ink is on a label's page: rendered once, small, and scanned. */
async function measureInk(page: pdfjs.PDFPageProxy, wCm: number, hCm: number): Promise<Box> {
  const whole: Box = { minX: 0, minY: 0, maxX: wCm, maxY: hCm };
  const maxBp = Math.max(wCm, hCm) / BP_TO_CM;
  const scale = Math.min(8, 1600 / Math.max(maxBp, 1)); // px per bp
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const W = (canvas.width = Math.max(1, Math.ceil(vp.width)));
  const H = (canvas.height = Math.max(1, Math.ceil(vp.height)));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  await page.render({ canvas, canvasContext: ctx, viewport: vp, background: "rgba(0,0,0,0)" } as any).promise;
  const a = ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (a[(y * W + x) * 4 + 3] > 40) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return whole;
  const cm = BP_TO_CM / scale; // cm per px
  // Pixel rows count from the top; the box's y goes up.
  return {
    minX: Math.max(0, x0 * cm - INK_PAD),
    maxX: Math.min(wCm, (x1 + 1) * cm + INK_PAD),
    minY: Math.max(0, hCm - (y1 + 1) * cm - INK_PAD),
    maxY: Math.min(hCm, hCm - y0 * cm + INK_PAD),
  };
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

/** The box around a label's visible text, in world coordinates (cm): what is
 *  outlined when selected, clicked, lined up and kept clear of lines. Before
 *  the label is compiled, a placeholder box. */
export function labelBox(o: LabelObj): Box | null {
  const b = labelNodeBox(o);
  const e = getLabel(o);
  if (!b || !e?.ink) return b;
  return { minX: b.minX + e.ink.minX, minY: b.minY + e.ink.minY, maxX: b.minX + e.ink.maxX, maxY: b.minY + e.ink.maxY };
}

/** The size of a label's ink box, once compiled. */
export function labelInkSize(o: LabelObj): { w: number; h: number } | null {
  const e = getLabel(o);
  if (!e || e.status !== "ok") return null;
  const k = e.ink ?? { minX: 0, minY: 0, maxX: e.w!, maxY: e.h! };
  return { w: k.maxX - k.minX, h: k.maxY - k.minY };
}

/** The node position that puts a label's ink box at `p` with this anchor
 *  (placement works with the ink box; TikZ anchors the whole node). */
export function nodePointForInk(o: LabelObj, p: Vec, anchor: Anchor): Vec {
  const e = getLabel(o);
  if (!e || e.status !== "ok" || !e.ink) return p;
  const { fx, fy } = anchorFrac(anchor);
  const k = e.ink;
  return {
    x: p.x - fx * (k.maxX - k.minX) - k.minX + fx * e.w!,
    y: p.y - fy * (k.maxY - k.minY) - k.minY + fy * e.h!,
  };
}

/** The whole TikZ node's box (inner sep included), where the compiled image
 *  is drawn. */
export function labelNodeBox(o: LabelObj): Box | null {
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
