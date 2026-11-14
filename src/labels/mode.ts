// Math by default: a label with no unescaped $ (and no \( or \[) is typeset
// in math mode; a label that contains math delimiters is typeset as text.
// `textMode` forces text for labels like "torus".

/** Does the text contain an unescaped $, or \( / \[ ? */
export function hasMathDelimiters(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === "(" || next === "[") return true;
      i++; // skip the escaped character (handles \$ and \\)
      continue;
    }
    if (ch === "$") return true;
  }
  return false;
}

/** LaTeX that goes inside the TikZ node. */
export function labelBody(text: string, textMode: boolean): string {
  const t = text.trim();
  if (t === "") return "";
  if (textMode || hasMathDelimiters(t)) return t;
  // Multi-line math (with \\): one math formula per line.
  if (/\\\\/.test(t)) return t.split(/\\\\/).map((l) => `$${l.trim()}$`).join("\\\\");
  return `$${t}$`;
}

/** Node options that change how a label looks (font size, colour). Used both
 *  when compiling the label for the canvas and when exporting TikZ. */
export function labelNodeOpts(o: { font: string; style: { stroke: string | null } }): string {
  const opts: string[] = [];
  if (o.font) opts.push(`font=${o.font}`);
  if (o.style.stroke && o.style.stroke !== "black") opts.push(`text=${o.style.stroke}`);
  return opts.join(",");
}
