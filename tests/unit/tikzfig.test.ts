// Compiles exported figures with tikzfig.sty and checks the sizes TeX reports.
import { execFileSync } from "node:child_process";
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
});
