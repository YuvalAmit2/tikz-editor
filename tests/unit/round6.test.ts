// Sixth feedback round: hatch density from the fill strength.
import { describe, expect, it } from "vitest";
import { patternOpts } from "../../src/tikz/export";
import { patternLook } from "../../src/model/xcolor";

describe("hatched fills", () => {
  it("full strength keeps TikZ's named pattern", () => {
    expect(patternOpts("north east lines", "black")).toEqual(["pattern=north east lines"]);
    expect(patternOpts("dots", "blue")).toEqual(["pattern=dots", "pattern color=blue"]);
  });

  it("lighter strengths space the hatching out, in the full colour", () => {
    expect(patternOpts("north east lines", "blue!30")).toEqual(["pattern={Lines[angle=45,distance=4.596pt]}", "pattern color=blue"]);
    expect(patternOpts("horizontal lines", "black!60")).toEqual(["pattern={Lines[angle=0,distance=4.5pt]}"]);
    expect(patternOpts("crosshatch", "red!15")).toEqual(["pattern={Hatch[distance=9pt]}", "pattern color=red"]);
    expect(patternOpts("dots", "green!60!black")).toEqual(["pattern=dots", "pattern color=green!60!black"]);
  });

  it("sparser as the strength drops", () => {
    const gaps = [100, 60, 30, 15].map((t) => patternLook(`blue!${t}`).gap);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
  });
});
