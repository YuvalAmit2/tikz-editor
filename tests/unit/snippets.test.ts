import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseJsonc, snippetsFromJson } from "../../src/labels/snippetFile";

describe("snippet file", () => {
  it("parses comments and trailing commas, skips environment snippets", () => {
    const json = parseJsonc(`{
      // comment with "quotes"
      "Frac": { "prefix": "FRAC", "body": ["\\\\frac{\${1:$TM_SELECTED_TEXT}}{$2}$0"], }, /* block */
      "Thm": { "prefix": "THM", "body": ["\\\\begin{thm}", "$1", "\\\\end{thm}"] },
      "Two": { "prefix": ["AA", "BB"], "body": "x // not a comment" },
    }`);
    const s = snippetsFromJson(json);
    expect(s.map((x) => x.prefix)).toEqual(["FRAC", "AA", "BB"]);
    expect(s[0].body).toBe("\\frac{${1:$TM_SELECTED_TEXT}}{$2}$0");
    expect(s[1].body).toBe("x // not a comment");
  });
  const real = path.join(os.homedir(), "latex/yalatex/vscode/latex.json");
  it.skipIf(!existsSync(real))("reads yalatex's latex.json", () => {
    const s = snippetsFromJson(parseJsonc(readFileSync(real, "utf8")));
    const prefixes = s.map((x) => x.prefix);
    expect(prefixes).toContain("FRAC");
    expect(prefixes).not.toContain("THM");
  });
});
