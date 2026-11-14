// Monaco setup: only the editor core plus what the text panel needs.
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/editor/contrib/snippet/browser/snippetController2.js";
import "monaco-editor/editor/contrib/suggest/browser/suggestController.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";

(self as any).MonacoEnvironment = { getWorker: () => new EditorWorker() };

// A small LaTeX highlighter.
monaco.languages.register({ id: "latex" });
monaco.languages.setMonarchTokensProvider("latex", {
  tokenizer: {
    root: [
      [/%.*$/, "comment"],
      [/\\[a-zA-Z@]+\*?/, "keyword"],
      [/\\./, "keyword"],
      [/\$\$?/, "string"],
      [/[{}]/, "delimiter.bracket"],
      [/[_^&]/, "operator"],
    ],
  },
});
monaco.languages.setLanguageConfiguration("latex", {
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "$", close: "$" },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "$", close: "$" },
  ],
});

export { monaco };
