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
export async function loadSnippets(path: string): Promise<void> {
  register();
  if (!path) {
    snippets = [];
    return;
  }
  try {
    const text = await call<string>("readFile", { path });
    if (text === lastText && path === lastPath) return;
    snippets = snippetsFromJson(parseJsonc(text));
    lastText = text;
    lastPath = path;
  } catch {
    if (path !== lastPath) snippets = [];
  }
}

function register() {
  if (registered) return;
  registered = true;
  monaco.languages.registerCompletionItemProvider("latex", {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      // Prefixes are all caps: only offer snippets for an uppercase word.
      if (!word.word || !/^[A-Z]/.test(word.word)) return { suggestions: [] };
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const suggestions = snippets
        .filter((s) => s.prefix.startsWith(word.word))
        .map((s) => ({
          label: { label: s.prefix, description: s.description },
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: s.body,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          sortText: s.prefix === word.word ? "0" : "1" + s.prefix,
        }));
      return { suggestions };
    },
  });
}
