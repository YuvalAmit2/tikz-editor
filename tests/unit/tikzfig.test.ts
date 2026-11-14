// Compiles exported figures with tikzfig.sty and checks the sizes TeX reports.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sceneToTikz, tikzToScene } from "../../src/tikz/export";
import { DEFAULT_STYLE, type Scene } from "../../src/model/types";

const CM = 72.27 / 2.54; // pt per cm

function measure(figs: Record<string, Scene>, calls: string[]): number[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tikzfig-"));
  mkdirSync(path.join(dir, "graphics"));
  copyFileSync(path.join(__dirname, "../../tex/tikzfig.sty"), path.join(dir, "tikzfig.sty"));
  for (const [name, scene] of Object.entries(figs)) writeFileSync(path.join(dir, "graphics", name + ".tikz"), sceneToTikz(scene));
  const body = calls.map((c, i) => `\\sbox0{${c}}\\typeout{TFW${i}=\\the\\wd0}`).join("\n");
  writeFileSync(
    path.join(dir, "t.tex"),
    `\\documentclass{article}\\usepackage{tikzfig}\\begin{document}\n${body}\n\\end{document}\n`,
  );
  execFileSync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", "t.tex"], { cwd: dir });
  const log = readFileSync(path.join(dir, "t.log"), "utf8");
  return calls.map((_, i) => parseFloat(log.match(new RegExp(`TFW${i}=([\\d.]+)pt`))![1]));
}

const thin = { ...DEFAULT_STYLE }; // 0.4pt line: adds 0.4pt to the box width

const rect: Scene = {
  version: 1,
  objects: [
    {
      id: "r",
      type: "path",
      closed: true,
      style: thin,
      pts: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 2 },
        { x: 0, y: 2 },
      ],
    },
  ],
};

const ell: Scene = {
  version: 1,
  objects: [{ id: "e", type: "ellipse", style: thin, c: { x: 1, y: 1 }, rx: 2, ry: 1, rot: 0 }],
};

describe("tikzfig.sty", () => {
  it("scales the drawing to the requested size, keeping line widths", () => {
    const w = measure({ rect, ell }, [
      "\\tikzfig{rect}",
      "\\tikzfig[5cm]{rect}",
      "\\tikzfig[width=5cm]{rect}",
      "\\tikzfig[0.5]{rect}",
      "\\tikzfig[height=1cm]{rect}",
      "\\tikzfig[scale=1.5]{rect}",
      "\\tikzfig[8cm]{ell}",
      "\\tikzfig[width=6cm,height=1cm]{rect}",
    ]);
    const lw = 0.4;
    expect(w[0]).toBeCloseTo(4 * CM + lw, 0);
    expect(w[1]).toBeCloseTo(5 * CM + lw, 0);
    expect(w[2]).toBeCloseTo(5 * CM + lw, 0);
    expect(w[3]).toBeCloseTo(0.5 * 345 + lw, 0); // article \linewidth = 345pt
    expect(w[4]).toBeCloseTo(2 * CM + lw, 0); // height 1cm -> scale 0.5
    expect(w[5]).toBeCloseTo(6 * CM + lw, 0);
    expect(w[6]).toBeCloseTo(8 * CM + lw, 0); // ellipse radii scale too
    expect(w[7]).toBeCloseTo(2 * CM + lw, 0); // fits inside both
  });

  it("round-trips the scene through the .tikz file", () => {
    expect(tikzToScene(sceneToTikz(rect))).toEqual(rect);
  });

  it("exports curves as explicit Béziers that compile and scale", () => {
    const circle: Scene = {
      version: 1,
      objects: [
        {
          id: "c",
          type: "curve",
          style: thin,
          closed: true,
          nodes: [
            { p: { x: 1, y: 0 }, mode: "smooth" },
            { p: { x: 0, y: 1 }, mode: "smooth" },
            { p: { x: -1, y: 0 }, mode: "smooth" },
            { p: { x: 0, y: -1 }, mode: "smooth" },
          ],
        },
      ],
    };
    const wave: Scene = {
      version: 1,
      objects: [
        {
          id: "w",
          type: "curve",
          style: { ...thin, arrowEnd: true },
          closed: false,
          nodes: [
            { p: { x: 0, y: 0 }, mode: "smooth" },
            { p: { x: 1, y: 1 }, mode: "corner" },
            { p: { x: 2, y: 0 }, mode: "manual", hin: { x: -0.3, y: 0.3 }, hout: { x: 0.5, y: 0 } },
            { p: { x: 3, y: 1 }, mode: "smooth" },
          ],
        },
      ],
    };
    const tikz = sceneToTikz(circle);
    expect(tikz).toMatch(/\.\. controls .* \.\. cycle;/);
    const w = measure({ circle, wave }, ["\\tikzfig{circle}", "\\tikzfig[4cm]{circle}", "\\tikzfig{wave}"]);
    expect(w[0]).toBeCloseTo(2 * CM + 0.4, 0);
    expect(w[1]).toBeCloseTo(4 * CM + 0.4, 0);
    expect(w[2]).toBeGreaterThan(3 * CM);
    expect(tikzToScene(sceneToTikz(wave))).toEqual(wave);
  });

  it("centres a figure on its own line, captions it, and stays inline in text", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tikzfig-"));
    mkdirSync(path.join(dir, "graphics"));
    copyFileSync(path.join(__dirname, "../../tex/tikzfig.sty"), path.join(dir, "tikzfig.sty"));
    writeFileSync(path.join(dir, "graphics", "rect.tikz"), sceneToTikz(rect));
    // One figure per page; Ghostscript's bbox device reports where the ink is.
    const pages = [
      "\\tikzfig{rect}",
      "\\centerline{\\rule{4cm}{2cm}}",
      "Text \\tikzfig{rect}",
      "\\tikzfig[inline]{rect}",
      "\\tikzfig[caption={A rectangle}, label=fig:r, place=h]{rect} See Figure~\\ref{fig:r}.",
    ];
    writeFileSync(
      path.join(dir, "t.tex"),
      `\\documentclass{article}\\usepackage{tikzfig}\\pagestyle{empty}\\begin{document}\n${pages.join("\n\\clearpage\n")}\n\\end{document}\n`,
    );
    for (let i = 0; i < 2; i++) execFileSync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", "t.tex"], { cwd: dir });
    const log = readFileSync(path.join(dir, "t.log"), "utf8");
    expect(log).not.toMatch(/undefined references/);
    // The bbox device writes to stderr.
    const r = spawnSync("gs", ["-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=bbox", "t.pdf"], { cwd: dir, encoding: "utf8" });
    const gs = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    const boxes = [...(gs + "").matchAll(/%%HiResBoundingBox: ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)/g)].map((m) => m.slice(1).map(Number));
    if (boxes.length === 0) return; // no Ghostscript: compiling is all we can check
    const mid = (b: number[]) => (b[0] + b[2]) / 2;
    expect(Math.abs(mid(boxes[0]) - mid(boxes[1]))).toBeLessThan(1); // centred like \centerline
    expect(boxes[2][0]).toBeLessThan(boxes[0][0] - 20); // in text: not centred
    expect(boxes[3][0]).toBeLessThan(boxes[0][0] - 20); // inline: not centred
  });
});
