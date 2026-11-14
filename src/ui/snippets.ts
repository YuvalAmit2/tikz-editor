// VS Code snippets (yalatex's vscode/latex.json) in the label editor.
//
// The file is read again each time a label edit starts, so new snippets show
// up without restarting. Snippets for environments (\begin{...}) are left
// out: they don't make sense inside a label.
import { call } from "../api/client";
import { monaco } from "./monaco";

import { parseJsonc, snippetsFromJson, type Snippet } from "../labels/snippetFile";

let snippets: Snippet[] = [];
let lastText = "";
let lastPath = "";
let registered = false;

export const currentSnippets = () => snippets;

/** (Re)load the snippet file. Errors leave the previous snippets in place. */
let loads = 0;

export async function loadSnippets(path: string): Promise<void> {
  register();
  const me = ++loads;
  if (!path) {
    snippets = [];
    return;
  }
  try {
    const text = await call<string>("readFile", { path });
    // A newer load (e.g. the snippet file was changed) wins.
    if (me !== loads) return;
    if (text === lastText && path === lastPath) return;
    snippets = snippetsFromJson(parseJsonc(text));
    lastText = text;
    lastPath = path;
  } catch {
    if (me === loads && path !== lastPath) snippets = [];
  }
}

function register() {
  if (registered) return;
  registered = true;
  monaco.languages.registerCompletionItemProvider("latex", {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      // Any case matches (as in VS Code), but not a command name after a
      // backslash, and a lowercase word needs two letters so a one-letter
      // label finished with Enter isn't turned into a snippet.
      const w = word.word;
      if (!w || !/^[A-Za-z]/.test(w)) return { suggestions: [] };
      if (/[a-z]/.test(w[0]) && w.length < 2) return { suggestions: [] };
      const before = model.getLineContent(position.lineNumber).charAt(word.startColumn - 2);
      if (before === "\\") return { suggestions: [] };
      const lw = w.toLowerCase();
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const suggestions = snippets
        .filter((s) => s.prefix.toLowerCase().startsWith(lw))
        .map((s) => ({
          label: { label: s.prefix, description: s.description },
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: s.body,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          sortText: s.prefix.toLowerCase() === lw ? "0" : "1" + s.prefix,
        }));
      return { suggestions };
    },
  });
}
