// Reading VS Code snippet files (JSON with comments and trailing commas).

export interface Snippet {
  name: string;
  prefix: string;
  body: string;
  description: string;
}

/** JSON with // and /* comments and trailing commas (VS Code's format). */
export function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[\]}])/g, "$1"));
}

export function snippetsFromJson(json: unknown): Snippet[] {
  const out: Snippet[] = [];
  if (!json || typeof json !== "object") return out;
  for (const [name, v] of Object.entries(json as Record<string, any>)) {
    if (!v || typeof v !== "object") continue;
    const body = Array.isArray(v.body) ? v.body.join("\n") : String(v.body ?? "");
    const prefixes = Array.isArray(v.prefix) ? v.prefix : [v.prefix];
    if (/\\begin\{/.test(body)) continue;
    for (const p of prefixes) if (typeof p === "string" && p) out.push({ name, prefix: p, body, description: String(v.description ?? name) });
  }
  return out;
}

