// The fixed text panel at the bottom: edits the selected label.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { getLabel, labelStore } from "../labels/render";
import { hasMathDelimiters } from "../labels/mode";
import type { LabelObj, Scene } from "../model/types";
import { store, useStore } from "../store";
import { monaco } from "./monaco";
import { loadSnippets } from "./snippets";
import { saveAndHide } from "../actions";
import { DEFAULT_SNIPPET_FILE } from "../model/settings";

/** Scene before the current edit session (for one undo step per edit). */
let sessionBefore: Scene | null = null;
let sessionLabel: string | null = null;

export function commitLabelEdit() {
  const id = sessionLabel;
  const before = sessionBefore;
  sessionLabel = null;
  sessionBefore = null;
  const s = store.get();
  if (!id) return;
  const o = store.objById(id) as LabelObj | undefined;
  if (o && o.text.trim() === "") {
    // Empty labels are removed.
    store.commit({ ...s.scene, objects: s.scene.objects.filter((x) => x.id !== id) }, { selection: s.selection.filter((x) => x !== id) }, before ?? undefined);
  } else if (before && before !== s.scene) {
    store.commit(s.scene, {}, before);
  }
}

export function TextPanel() {
  const host = useRef<HTMLDivElement>(null);
  const ed = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const editingLabel = useStore((s) => s.editingLabel);
  const label = useStore((s) => (s.editingLabel ? (s.scene.objects.find((o) => o.id === s.editingLabel) as LabelObj | undefined) : undefined));
  useSyncExternalStore(labelStore.subscribe, labelStore.version);

  useEffect(() => {
    const editor = monaco.editor.create(host.current!, {
      value: "",
      language: "latex",
      theme: "vs",
      fontSize: 15,
      fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
      lineNumbers: "off",
      minimap: { enabled: false },
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 6,
      wordWrap: "on",
      scrollBeyondLastLine: false,
      renderLineHighlight: "none",
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      scrollbar: { vertical: "auto", horizontal: "hidden", useShadows: false },
      automaticLayout: true,
      padding: { top: 8, bottom: 8 },
      // Snippets: typing an all-caps prefix offers them; Tab/Enter inserts.
      quickSuggestions: { other: true, comments: false, strings: true },
      suggestOnTriggerCharacters: false,
      tabCompletion: "on",
      snippetSuggestions: "top",
      suggest: { showWords: false, showIcons: false, preview: true },
      wordBasedSuggestions: "off",
      contextmenu: false,
      fixedOverflowWidgets: true,
      readOnly: true,
    });
    ed.current = editor;

    const finish = () => {
      commitLabelEdit();
      store.set({ editingLabel: null });
      (document.activeElement as HTMLElement | null)?.blur?.();
    };
    // Enter commits (Shift+Enter = new line), unless the setting is off.
    editor.addCommand(monaco.KeyCode.Enter, () => {
      if (store.get().settings.enterCommitsLabel) finish();
      else editor.trigger("keyboard", "type", { text: "\n" });
    }, "!suggestWidgetVisible");
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {
      editor.trigger("keyboard", "type", { text: "\n" });
    }, "!suggestWidgetVisible");
    editor.addCommand(monaco.KeyCode.Escape, finish, "!suggestWidgetVisible && !inSnippetMode");
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyT, () => toggleTextMode());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      finish();
      void saveAndHide();
    });

    editor.onDidChangeModelContent(() => {
      const id = store.get().editingLabel;
      if (!id || editor.getOption(monaco.editor.EditorOption.readOnly)) return;
      const o = store.objById(id) as LabelObj | undefined;
      const text = editor.getValue();
      if (!o || o.text === text) return;
      store.preview(store.withReplaced([{ ...o, text }]));
      store.set({ dirty: true });
    });
    return () => editor.dispose();
  }, []);

  // Start an edit session when a label is chosen for editing.
  useEffect(() => {
    const editor = ed.current!;
    if (sessionLabel && sessionLabel !== editingLabel) commitLabelEdit();
    if (!editingLabel) {
      editor.updateOptions({ readOnly: true });
      editor.setValue("");
      return;
    }
    const o = store.objById(editingLabel) as LabelObj | undefined;
    if (!o) return;
    sessionLabel = editingLabel;
    sessionBefore = store.get().scene;
    void loadSnippets(store.get().settings.snippetFile || DEFAULT_SNIPPET_FILE);
    editor.updateOptions({ readOnly: false });
    if (editor.getValue() !== o.text) editor.setValue(o.text);
    const model = editor.getModel()!;
    const end = model.getFullModelRange().getEndPosition();
    editor.setPosition(end);
    editor.focus();
    // Again after the click that started the edit has finished.
    requestAnimationFrame(() => {
      if (store.get().editingLabel === editingLabel) editor.focus();
    });
  }, [editingLabel]);

  const entry = label ? getLabel(label) : null;
  const auto = label ? hasMathDelimiters(label.text) : false;
  const mode = !label ? null : label.textMode ? "text" : auto ? "text-auto" : "math";

  return (
    <div className={"textpanel" + (editingLabel ? " active" : "")} data-testid="text-panel">
      <div className="textpanel-head">
        <span className="title">Label</span>
        {label && (
          <button
            className={"mode-toggle" + (mode === "math" ? " math" : " text")}
            title="Toggle math / text (⌘T). Labels are math unless they contain $…$."
            data-testid="mode-toggle"
            onClick={toggleTextMode}
            disabled={mode === "text-auto"}
          >
            {mode === "math" ? "Math" : mode === "text" ? "Text" : "Text (has $…$)"}
          </button>
        )}
        {entry?.status === "pending" && <span className="muted small">compiling…</span>}
        {entry?.status === "error" && (
          <span className="error small" data-testid="label-error">
            {entry.error}
          </span>
        )}
        {!editingLabel && <span className="muted small">Press T and click to add a label, or double-click a label to edit it.</span>}
        {editingLabel && <span className="muted small grow-right">Enter: done · Shift+Enter: new line · Esc: done</span>}
      </div>
      <div className="monaco-host" ref={host} data-testid="label-editor" />
    </div>
  );
}

function toggleTextMode() {
  const id = store.get().editingLabel ?? store.get().selection[0];
  const o = id ? (store.objById(id) as LabelObj | undefined) : undefined;
  if (!o || o.type !== "label") return;
  const next = { ...o, textMode: !o.textMode };
  if (store.get().editingLabel === id) {
    store.preview(store.withReplaced([next]));
    store.set({ dirty: true });
  } else store.commit(store.withReplaced([next]));
}
