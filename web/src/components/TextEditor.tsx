import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Compartment, EditorState, Extension } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CodeMirrorCore, CodeMirrorLoader } from "../codeMirrorLoader";
import { codeMirrorLoader } from "../codeMirrorLoader";
import { formatBytes } from "../format";
import type { UIStrings } from "../i18n";
import { strings } from "../i18n";
import {
  textHighlightByteLimit,
  type EditorDocumentAdapter,
  type TextEditorDegradationReason,
  type TextEditorSession,
} from "../textEditorSession";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  session: TextEditorSession;
  labels?: UIStrings;
  loader?: CodeMirrorLoader;
  onSave?(): void;
};

type EditorInfo = {
  line: number;
  column: number;
  byteSize: number;
};

type CodeMirrorBridge = {
  runtime: CodeMirrorRuntime | null;
  session: TextEditorSession;
  view: EditorView | null;
  onSave(): void;
  onInfo(info: EditorInfo): void;
  languageCompartment: Compartment;
  languageEnabled: boolean;
  degradationScheduled: boolean;
};

type CodeMirrorRuntime = {
  kind: "filebutler-codemirror";
  state: EditorState;
  byteSize: number;
  bridge: CodeMirrorBridge;
};

const textEncoder = new TextEncoder();

export function TextEditor({
  session,
  labels = strings.en,
  loader = codeMirrorLoader,
  onSave,
}: Props) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const hostRef = useRef<HTMLDivElement>(null);
  const onSaveRef = useRef(onSave);
  const mountKey = `${session.id}:${snapshot.documentVersion}`;
  const [mountState, setMountState] = useState<{ key: string; loading: boolean; error: string | null }>({
    key: mountKey,
    loading: snapshot.hasDocument,
    error: null,
  });
  const [editorInfoState, setEditorInfoState] = useState<EditorInfo & { key: string }>({
    key: mountKey,
    line: 1,
    column: 1,
    byteSize: snapshot.byteSize,
  });
  const effectiveMountState = mountState.key === mountKey
    ? mountState
    : { key: mountKey, loading: snapshot.hasDocument, error: null };
  const editorInfo = editorInfoState.key === mountKey
    ? editorInfoState
    : { key: mountKey, line: 1, column: 1, byteSize: snapshot.byteSize };

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    if (!snapshot.hasDocument) return;
    const host = hostRef.current;
    if (!host) return;
    const parent: HTMLDivElement = host;
    let canceled = false;
    let mountedView: EditorView | null = null;

    async function mountEditor() {
      try {
        const existing = session.getRuntime();
        const shouldLoadLanguage = session.getSnapshot().highlightEnabled;
        const [core, languageResult] = await Promise.all([
          loader.loadCore(),
          existing === null && shouldLoadLanguage
            ? loader.loadLanguage(session.text, session.fileName)
            : Promise.resolve({ extension: null, degraded: false }),
        ]);
        if (canceled) return;
        if (languageResult.degraded) session.disableHighlight("language-load-failed");

        let runtime: CodeMirrorRuntime;
        if (existing !== null) {
          if (!isCodeMirrorRuntime(existing)) throw new Error("unsupported editor runtime");
          runtime = existing;
          runtime.bridge.session = session;
        } else {
          const adapter = createCodeMirrorAdapter(
            core,
            session,
            languageResult.extension,
            labels.textEditorLabel(session.fileName),
          );
          const initialized = session.initializeRuntime(adapter);
          if (!isCodeMirrorRuntime(initialized)) throw new Error("unable to initialize editor runtime");
          runtime = initialized;
        }

        runtime.bridge.onSave = () => onSaveRef.current?.();
        runtime.bridge.onInfo = (info) => setEditorInfoState({ key: mountKey, ...info });
        runtime.bridge.runtime = runtime;
        const view = new core.view.EditorView({ state: runtime.state, parent });
        runtime.bridge.view = view;
        mountedView = view;
        setEditorInfoState({ key: mountKey, ...editorInfoFor(runtime.state, runtime.byteSize) });
        setMountState({ key: mountKey, loading: false, error: null });
        view.focus();
      } catch {
        if (canceled) return;
        setMountState({ key: mountKey, loading: false, error: labels.editorUnavailable });
      }
    }

    void mountEditor();
    return () => {
      canceled = true;
      if (!mountedView) return;
      const runtime = session.getRuntime();
      if (isCodeMirrorRuntime(runtime) && runtime.bridge.view === mountedView) {
        runtime.bridge.view = null;
        runtime.bridge.onSave = noop;
        runtime.bridge.onInfo = noop;
      }
      mountedView.destroy();
      parent.replaceChildren();
    };
  }, [labels, loader, mountKey, session, snapshot.hasDocument]);

  const degradationMessage = degradationLabel(snapshot.degradationReason, labels);
  const issueMessage = snapshot.issue?.message ?? effectiveMountState.error;
  const saveStatus = snapshot.status === "saving"
    ? labels.editorSaving
    : snapshot.dirty
      ? labels.editorUnsaved
      : labels.editorSaved;

  return (
    <div className="text-editor-layout" data-editor-status={snapshot.status}>
      <div className="text-editor-toolbar">
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={labels.save}
          title={`${labels.save} (Ctrl+S)`}
          disabled={!snapshot.hasDocument || snapshot.status === "saving" || !onSave}
          onClick={() => onSave?.()}
        >
          <Save aria-hidden="true" />
          {labels.save}
        </Button>
        <span className="text-editor-save-state" aria-live="polite">{saveStatus}</span>
      </div>

      {degradationMessage ? <div className="text-editor-degradation" role="status">{degradationMessage}</div> : null}
      {issueMessage ? <div className="text-editor-error"><ErrorBanner message={issueMessage} /></div> : null}

      <div className="text-editor-region" data-loading={effectiveMountState.loading ? "true" : "false"}>
        {!snapshot.hasDocument && !snapshot.issue ? (
          <div className="text-editor-placeholder">{labels.editorLoading}</div>
        ) : null}
        {snapshot.hasDocument ? <div ref={hostRef} className="text-editor-host" /> : null}
        {snapshot.hasDocument && effectiveMountState.loading ? (
          <div className="text-editor-placeholder text-editor-placeholder-overlay">{labels.editorLoading}</div>
        ) : null}
      </div>

      {snapshot.hasDocument ? (
        <div className="text-editor-statusbar" aria-label={labels.status}>
          <span>{session.text.displayName}</span>
          <span>{encodingLabel(snapshot.encoding)}</span>
          <span>{lineEndingLabel(snapshot.lineEnding, snapshot.saveLineEnding, labels)}</span>
          <span>{labels.editorLineColumn(editorInfo.line, editorInfo.column)}</span>
          <span>{formatBytes(editorInfo.byteSize)}</span>
        </div>
      ) : null}
    </div>
  );
}

function createCodeMirrorAdapter(
  core: CodeMirrorCore,
  session: TextEditorSession,
  languageExtension: Extension | null,
  accessibleLabel: string,
): EditorDocumentAdapter {
  let createdRuntime: CodeMirrorRuntime | null = null;
  return {
    create(content) {
      const languageCompartment = new core.state.Compartment();
      const bridge: CodeMirrorBridge = {
        runtime: null,
        session,
        view: null,
        onSave: noop,
        onInfo: noop,
        languageCompartment,
        languageEnabled: languageExtension !== null,
        degradationScheduled: false,
      };
      const extensions: Extension[] = [
        core.view.lineNumbers(),
        core.view.highlightActiveLineGutter(),
        core.view.highlightSpecialChars(),
        core.commands.history(),
        core.language.foldGutter(),
        core.view.drawSelection(),
        core.view.dropCursor(),
        core.state.EditorState.allowMultipleSelections.of(true),
        core.language.indentOnInput(),
        core.language.syntaxHighlighting(core.language.defaultHighlightStyle, { fallback: true }),
        core.language.bracketMatching(),
        core.view.rectangularSelection(),
        core.view.crosshairCursor(),
        core.view.highlightActiveLine(),
        core.search.highlightSelectionMatches(),
        core.view.EditorView.contentAttributes.of({ "aria-label": accessibleLabel }),
        core.view.keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              bridge.onSave();
              return true;
            },
          },
          ...core.commands.defaultKeymap,
          ...core.search.searchKeymap,
          ...core.commands.historyKeymap,
          ...core.language.foldKeymap,
          core.commands.indentWithTab,
        ]),
        core.view.EditorView.updateListener.of((update) => handleEditorUpdate(bridge, update)),
        languageCompartment.of(languageExtension ?? []),
      ];
      const state = core.state.EditorState.create({ doc: content, extensions });
      const runtime: CodeMirrorRuntime = {
        kind: "filebutler-codemirror",
        state,
        byteSize: textEncoder.encode(content).length,
        bridge,
      };
      bridge.runtime = runtime;
      createdRuntime = runtime;
      return runtime;
    },
    content(runtime) {
      return asCodeMirrorRuntime(runtime).state.doc.toString();
    },
    document(runtime) {
      return asCodeMirrorRuntime(runtime).state.doc;
    },
    equals(left, right) {
      return (left as EditorState["doc"]).eq(right as EditorState["doc"]);
    },
    dispose(runtime) {
      const codeMirrorRuntime = asCodeMirrorRuntime(runtime);
      codeMirrorRuntime.bridge.onSave = noop;
      codeMirrorRuntime.bridge.onInfo = noop;
      codeMirrorRuntime.bridge.runtime = null;
      if (createdRuntime === codeMirrorRuntime) createdRuntime = null;
    },
  };
}

function handleEditorUpdate(bridge: CodeMirrorBridge, update: ViewUpdate) {
  const current = bridge.runtime;
  if (!current) return;
  const byteSize = update.docChanged ? changedByteSize(update, current.byteSize) : current.byteSize;
  const runtime: CodeMirrorRuntime = { ...current, state: update.state, byteSize };
  bridge.runtime = runtime;
  bridge.session.setRuntime(runtime);
  if (update.docChanged || update.selectionSet) bridge.onInfo(editorInfoFor(update.state, byteSize));

  if (
    byteSize > textHighlightByteLimit &&
    bridge.languageEnabled &&
    !bridge.degradationScheduled
  ) {
    bridge.degradationScheduled = true;
    queueMicrotask(() => {
      bridge.session.disableHighlight("document-too-large");
      bridge.languageEnabled = false;
      bridge.degradationScheduled = false;
      const view = bridge.view;
      if (view) view.dispatch({ effects: bridge.languageCompartment.reconfigure([]) });
    });
  }
}

function changedByteSize(update: ViewUpdate, previousByteSize: number) {
  let byteSize = previousByteSize;
  update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    byteSize -= textEncoder.encode(update.startState.sliceDoc(fromA, toA)).length;
    byteSize += textEncoder.encode(inserted.toString()).length;
  });
  return byteSize;
}

function editorInfoFor(state: EditorState, byteSize: number): EditorInfo {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return { line: line.number, column: head - line.from + 1, byteSize };
}

function isCodeMirrorRuntime(runtime: unknown): runtime is CodeMirrorRuntime {
  return Boolean(runtime && typeof runtime === "object" && "kind" in runtime && runtime.kind === "filebutler-codemirror");
}

function asCodeMirrorRuntime(runtime: unknown): CodeMirrorRuntime {
  if (!isCodeMirrorRuntime(runtime)) throw new Error("invalid CodeMirror runtime");
  return runtime;
}

function degradationLabel(reason: TextEditorDegradationReason | null, labels: UIStrings) {
  switch (reason) {
    case "large-file":
      return labels.editorLargeFile;
    case "document-too-large":
      return labels.editorDocumentTooLarge;
    case "language-load-failed":
      return labels.editorHighlightUnavailable;
    case null:
      return null;
  }
}

function encodingLabel(encoding: ReturnType<TextEditorSession["getSnapshot"]>["encoding"]) {
  return ({
    "utf-8": "UTF-8",
    "utf-8-bom": "UTF-8 BOM",
    "utf-16le-bom": "UTF-16 LE BOM",
    "utf-16be-bom": "UTF-16 BE BOM",
    "gb18030": "GB18030",
  } as const)[encoding ?? "utf-8"];
}

function lineEndingLabel(
  lineEnding: ReturnType<TextEditorSession["getSnapshot"]>["lineEnding"],
  saveLineEnding: ReturnType<TextEditorSession["getSnapshot"]>["saveLineEnding"],
  labels: UIStrings,
) {
  if (lineEnding === "mixed") return `${labels.editorMixedLineEnding} → ${(saveLineEnding ?? "lf").toUpperCase()}`;
  if (lineEnding === "none" || lineEnding === null) return labels.editorNoLineEnding;
  return lineEnding.toUpperCase();
}

function noop() {}
