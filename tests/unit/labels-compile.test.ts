// The label compiler must isolate errors: a broken label never takes the
// others down, and nothing a label contains can break out of its node.
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LabelCompiler } from "../../server/tex";
import { labelBody } from "../../src/labels/mode";

const spec = { documentClass: "\\documentclass[11pt]{article}", preamble: "\\usepackage{amssymb}" };

describe("label compiler", () => {
  it("compiles good labels next to hostile ones", async () => {
    const c = new LabelCompiler(mkdtempSync(path.join(os.tmpdir(), "lab-")));
    const texts = ["x}", "{x", "50%", "\\end{document}", "a $ b", "\\undefined", "\\par", "}{", "\\verb|x|", "\\csname", "x^", "ok \\alpha"];
    const jobs = texts.map((t, i) => ({ key: "k" + i, body: labelBody(t, false), opts: "" }));
    jobs.push({ key: "good1", body: labelBody("\\mathbb{Z}_p", false), opts: "" });
    jobs.push({ key: "good2", body: labelBody("Consider $x$", false), opts: "font=\\small,text=red" });
    const r = await c.compile(spec, jobs);
    expect(r.pages.good1).toBeTruthy();
    expect(r.pages.good2).toBeTruthy();
    expect(r.errors.good1).toBeUndefined();
    expect(r.pages.k11).toBeTruthy(); // "ok \alpha" is fine
    // Every job gets an answer
    for (const j of jobs) expect(Boolean(r.pages[j.key]) || Boolean(r.errors[j.key])).toBe(true);
  }, 60_000);
});
