// Compiles text labels with the user's preamble.
//
// The preamble is compiled once into a pdfTeX format file (mylatexformat), so
// each label compile only typesets the label itself (~0.2 s instead of ~1 s
// for a full yalatex preamble). The format is rebuilt when the preamble text
// or any file it read (recorded with -recorder) changes.
//
// Many labels are compiled in one run: a standalone document with the `tikz`
// option makes every tikzpicture its own page, so page i is label i.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface LabelJob {
  key: string;
  /** LaTeX that goes inside the node, e.g. "$\\cO_K$". */
  body: string;
  /** Extra node options, e.g. "font=\\small,text=red" (may be empty). */
  opts: string;
}

export interface CompileResult {
  /** base64 PDF; page `pages[key]` (1-based) is that label. */
  pdf: string | null;
  pages: Record<string, number>;
  errors: Record<string, string>;
}

export interface PreambleSpec {
  documentClass: string;
  preamble: string;
}

const FMT = "labelfmt";

function run(cmd: string, args: string[], cwd: string, timeoutMs: number) {
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    const p = spawn(cmd, args, { cwd, env: process.env });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("error", (e) => {
      clearTimeout(t);
      resolve({ code: -1, out: String(e) });
    });
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, out });
    });
  });
}

/** \documentclass[11pt,twoside]{article} -> standalone with class=article,11pt. */
export function standaloneClassLine(documentClass: string): string {
  const m = documentClass.match(/\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/);
  const cls = m?.[2]?.trim() || "article";
  const opts = (m?.[1] ?? "").split(",").map((s) => s.trim());
  const size = opts.find((o) => /^\d+(\.\d+)?pt$/.test(o));
  const parts = ["tikz", `class=${cls === "beamer" ? "article" : cls}`, "border=0pt"];
  if (size) parts.push(size);
  return `\\documentclass[${parts.join(",")}]{standalone}`;
}

/** The part of a .tex file between \documentclass and \begin{document}. */
export function extractPreamble(tex: string): { documentClass: string; preamble: string } {
  const begin = tex.indexOf("\\begin{document}");
  const head = begin >= 0 ? tex.slice(0, begin) : tex;
  const m = head.match(/\\documentclass\s*(\[[^\]]*\])?\s*\{[^}]*\}/);
  if (!m || m.index === undefined) return { documentClass: "\\documentclass{article}", preamble: head };
  return { documentClass: m[0], preamble: head.slice(m.index + m[0].length) };
}

export class LabelCompiler {
  private dir: string;
  private fmtReady: Promise<void> | null = null;
  private fmtKey = "";
  private queue: Promise<unknown> = Promise.resolve();
  private jobCounter = 0;
  lastFormatLog = "";

  constructor(cacheDir: string) {
    this.dir = path.join(cacheDir, "tex");
  }

  private async formatIsCurrent(key: string): Promise<boolean> {
    try {
      const info = JSON.parse(await fs.readFile(path.join(this.dir, `${FMT}.json`), "utf8"));
      if (info.key !== key) return false;
      await fs.access(path.join(this.dir, `${FMT}.fmt`));
      for (const [f, mtime] of Object.entries(info.files as Record<string, number>)) {
        const st = await fs.stat(f).catch(() => null);
        if (!st || st.mtimeMs !== mtime) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private async buildFormat(spec: PreambleSpec, key: string) {
    await fs.mkdir(this.dir, { recursive: true });
    const pre = [
      standaloneClassLine(spec.documentClass),
      spec.preamble,
      "\\usepackage{tikz}",
      "\\endofdump",
      "\\begin{document}",
      "\\end{document}",
      "",
    ].join("\n");
    await fs.writeFile(path.join(this.dir, "pre.tex"), pre);
    const r = await run(
      "pdflatex",
      ["-ini", "-interaction=nonstopmode", "-halt-on-error", "-recorder", `-jobname=${FMT}`, "&pdflatex", "mylatexformat.ltx", "pre.tex"],
      this.dir,
      120_000,
    );
    this.lastFormatLog = r.out;
    try {
      await fs.access(path.join(this.dir, `${FMT}.fmt`));
    } catch {
      throw new Error("Could not compile the preamble:\n" + firstErrors(r.out));
    }
    // Record every file the preamble read, so edits to the user's .sty files
    // trigger a rebuild.
    const fls = await fs.readFile(path.join(this.dir, `${FMT}.fls`), "utf8").catch(() => "");
    const files: Record<string, number> = {};
    for (const line of fls.split("\n")) {
      if (!line.startsWith("INPUT ")) continue;
      let f = line.slice(6).trim();
      if (!path.isAbsolute(f)) f = path.join(this.dir, f);
      if (f.endsWith(".fmt") || f.includes(`${path.sep}${FMT}.`)) continue;
      if (files[f] !== undefined) continue;
      const st = await fs.stat(f).catch(() => null);
      if (st) files[f] = st.mtimeMs;
    }
    await fs.writeFile(path.join(this.dir, `${FMT}.json`), JSON.stringify({ key, files }));
  }

  /** Make sure a current format exists for this preamble. */
  async ensureFormat(spec: PreambleSpec): Promise<void> {
    const key = createHash("sha256").update(spec.documentClass + "\n" + spec.preamble).digest("hex");
    if (this.fmtReady && this.fmtKey === key) {
      // Cheap staleness check (stat of the recorded files) before reuse.
      await this.fmtReady.catch(() => {});
      if (await this.formatIsCurrent(key)) return this.fmtReady;
    }
    this.fmtKey = key;
    this.fmtReady = (async () => {
      if (await this.formatIsCurrent(key)) return;
      await this.buildFormat(spec, key);
    })();
    return this.fmtReady;
  }

  private async compileOnce(jobs: LabelJob[]): Promise<{ pdf: Buffer | null; log: string; pages: number; errors: (string | null)[] }> {
    const name = `job${this.jobCounter++ % 4}`;
    // A marker before each label lets us tell which label an error belongs to.
    const body = jobs
      .map((j, i) => {
        const opts = j.opts ? `,${j.opts}` : "";
        return `\\typeout{TELABEL:${i}}\\begin{tikzpicture}\\node[outer sep=0pt,align=center${opts}]{${j.body}};\\end{tikzpicture}`;
      })
      .join("\n");
    const tex = `\\endofdump\n\\begin{document}\n${body}\n\\typeout{TELABEL:end}\n\\end{document}\n`;
    await fs.writeFile(path.join(this.dir, `${name}.tex`), tex);
    await fs.rm(path.join(this.dir, `${name}.pdf`), { force: true });
    const r = await run(
      "pdflatex",
      [`-fmt=${FMT}`, "-interaction=nonstopmode", "-no-shell-escape", `-jobname=${name}`, `${name}.tex`],
      this.dir,
      15_000,
    );
    const log = await fs.readFile(path.join(this.dir, `${name}.log`), "utf8").catch(() => r.out);
    const pdf = await fs.readFile(path.join(this.dir, `${name}.pdf`)).catch(() => null);
    const pages = parseInt(log.match(/Output written on .*?\((\d+) pages?/s)?.[1] ?? "0");
    // Split the log at the markers; "! " lines in a part are that label's errors.
    const errors: (string | null)[] = jobs.map(() => null);
    const parts = log.split(/^TELABEL:/m);
    let reachedEnd = false;
    for (const part of parts.slice(1)) {
      const m = part.match(/^(\d+|end)/);
      if (!m) continue;
      if (m[1] === "end") {
        reachedEnd = true;
        continue;
      }
      const i = parseInt(m[1]);
      if (/^! /m.test(part)) errors[i] = firstErrors(part);
    }
    if (!reachedEnd) for (let i = 0; i < jobs.length; i++) if (!errors[i] && !log.includes(`TELABEL:${i + 1}`) ) errors[i] = errors[i] ?? firstErrors(log);
    return { pdf, log, pages, errors };
  }

  /** Compile labels. Serialised: only one TeX run at a time. */
  compile(spec: PreambleSpec, jobs: LabelJob[]): Promise<CompileResult> {
    const task = this.queue.then(() => this.compileNow(spec, jobs));
    this.queue = task.catch(() => {});
    return task;
  }

  private async compileNow(spec: PreambleSpec, jobs: LabelJob[]): Promise<CompileResult> {
    const result: CompileResult = { pdf: null, pages: {}, errors: {} };
    if (jobs.length === 0) return result;
    try {
      await this.ensureFormat(spec);
    } catch (e) {
      for (const j of jobs) result.errors[j.key] = String((e as Error).message);
      return result;
    }
    const all = await this.compileOnce(jobs);
    if (all.pdf && all.pages === jobs.length) {
      // Normal case (also with errors: TeX recovers and still makes one page
      // per label; labels with errors are reported, not shown).
      result.pdf = all.pdf.toString("base64");
      jobs.forEach((j, i) => {
        if (all.errors[i]) result.errors[j.key] = all.errors[i]!;
        else result.pages[j.key] = i + 1;
      });
      return result;
    }
    // Page count doesn't match (a bad label swallowed or added pages): drop
    // the labels with errors and compile the rest again.
    const good = jobs.filter((_, i) => !all.errors[i]);
    jobs.forEach((j, i) => {
      if (all.errors[i]) result.errors[j.key] = all.errors[i]!;
    });
    if (good.length === jobs.length || good.length === 0) {
      for (const j of jobs) result.errors[j.key] ??= firstErrors(all.log);
      return result;
    }
    const again = await this.compileOnce(good);
    if (again.pdf && again.pages === good.length) {
      result.pdf = again.pdf.toString("base64");
      good.forEach((j, i) => {
        if (again.errors[i]) result.errors[j.key] = again.errors[i]!;
        else result.pages[j.key] = i + 1;
      });
    } else for (const j of good) result.errors[j.key] = firstErrors(again.log);
    return result;
  }
}

/** The first few "! ..." error messages of a TeX log, with their context line. */
export function firstErrors(log: string): string {
  const lines = log.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length && out.length < 6; i++) {
    if (lines[i].startsWith("! ")) {
      out.push(lines[i].slice(2));
      const ctx = lines.slice(i + 1, i + 4).find((l) => /^l\.\d+/.test(l));
      if (ctx) out.push("  at: " + ctx.replace(/^l\.\d+\s*/, "").replace(/^.*?\\node\[[^\]]*\]\{/, "").replace(/^\.\.\./, ""));
    }
  }
  return out.length ? out.join("\n") : "LaTeX failed (no error message found)";
}
