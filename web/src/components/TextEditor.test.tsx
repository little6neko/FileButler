import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { undoDepth } from "@codemirror/commands";
import { Facet, type EditorState, type Extension } from "@codemirror/state";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TextDocument } from "../api/types";
import { createCodeMirrorLoader } from "../codeMirrorLoader";
import { strings } from "../i18n";
import { TextEditorSession, textHighlightByteLimit } from "../textEditorSession";
import { textFileDescriptor } from "../textFiles";
import { TextEditor } from "./TextEditor";
import { TextEditorDialog } from "./TextEditorDialog";

describe("TextEditor", () => {
  it("mounts before the language arrives and hot-switches without losing editor state", async () => {
    const syntax = Facet.define<string, string>({ combine: (values) => values.at(-1) ?? "plain" });
    const go = deferred<Extension>();
    const python = deferred<Extension>();
    const loadGo = vi.fn(() => go.promise as never);
    const loadPython = vi.fn(() => python.promise as never);
    const loader = createCodeMirrorLoader({
      loadLanguageData: async () => [
        { name: "Go", alias: ["go"], extensions: ["go"], load: loadGo },
        { name: "Python", alias: ["python"], extensions: ["py"], load: loadPython },
      ] as never,
    });
    const editorSession = readySession("main.go", "package main\n");
    const onSave = vi.fn();
    const { container } = render(
      <TextEditor session={editorSession} labels={strings.en} loader={loader} onSave={onSave} />,
    );

    await waitFor(() => expect(container.querySelector(".cm-editor")).toBeInTheDocument());
    expect(editorSession.getSnapshot()).toMatchObject({ languageLoading: true, appliedLanguage: "plain" });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    const loadingRuntime = exposedRuntime(editorSession);
    loadingRuntime.bridge.view?.dispatch({
      changes: { from: loadingRuntime.state.doc.length, insert: "// editable while loading\n" },
    });
    expect(editorSession.currentContent()).toContain("editable while loading");

    go.resolve(syntax.of("go"));
    await waitFor(() => expect(editorSession.getSnapshot()).toMatchObject({
      languageLoading: false,
      appliedLanguage: "go",
    }));
    const goRuntime = exposedRuntime(editorSession);
    expect(goRuntime.state.facet(syntax)).toBe("go");
    goRuntime.bridge.view?.dispatch({ selection: { anchor: 3 } });
    const historyBeforeSwitch = undoDepth(exposedRuntime(editorSession).state);
    const bridgeBeforeSwitch = goRuntime.bridge;

    editorSession.selectLanguage("python");
    await waitFor(() => expect(loadPython).toHaveBeenCalledTimes(1));
    expect(exposedRuntime(editorSession).state.facet(syntax)).toBe("go");
    python.resolve(syntax.of("python"));

    await waitFor(() => expect(editorSession.getSnapshot()).toMatchObject({
      languageLoading: false,
      appliedLanguage: "python",
    }));
    const pythonRuntime = exposedRuntime(editorSession);
    expect(pythonRuntime.bridge).toBe(bridgeBeforeSwitch);
    expect(pythonRuntime.state.facet(syntax)).toBe("python");
    expect(pythonRuntime.state.selection.main.head).toBe(3);
    expect(undoDepth(pythonRuntime.state)).toBe(historyBeforeSwitch);
    expect(editorSession.currentContent()).toContain("editable while loading");
    expect(editorSession.getSnapshot().dirty).toBe(true);

    editorSession.selectLanguage("plain");
    await waitFor(() => expect(exposedRuntime(editorSession).state.facet(syntax)).toBe("plain"));
    expect(editorSession.getSnapshot()).toMatchObject({ appliedLanguage: "plain", dirty: true });
  });

  it("ignores a stale language result when a newer selection is loading", async () => {
    const syntax = Facet.define<string, string>({ combine: (values) => values.at(-1) ?? "plain" });
    const go = deferred<Extension>();
    const python = deferred<Extension>();
    const loader = createCodeMirrorLoader({
      loadLanguageData: async () => [
        { name: "Go", alias: ["go"], extensions: ["go"], load: () => go.promise as never },
        { name: "Python", alias: ["python"], extensions: ["py"], load: () => python.promise as never },
      ] as never,
    });
    const editorSession = readySession("main.go", "package main\n");
    const { container } = render(<TextEditor session={editorSession} labels={strings.en} loader={loader} />);
    await waitFor(() => expect(container.querySelector(".cm-editor")).toBeInTheDocument());

    editorSession.selectLanguage("python");
    go.resolve(syntax.of("go"));
    await Promise.resolve();
    await Promise.resolve();
    expect(editorSession.getSnapshot()).toMatchObject({
      requestedLanguage: "python",
      appliedLanguage: "plain",
      languageLoading: true,
    });
    expect(exposedRuntime(editorSession).state.facet(syntax)).toBe("plain");

    python.resolve(syntax.of("python"));
    await waitFor(() => expect(exposedRuntime(editorSession).state.facet(syntax)).toBe("python"));
    expect(editorSession.getSnapshot().appliedLanguage).toBe("python");
  });

  it("resumes the selected language after the visible view is unmounted during loading", async () => {
    const syntax = Facet.define<string, string>({ combine: (values) => values.at(-1) ?? "plain" });
    const go = deferred<Extension>();
    const loader = createCodeMirrorLoader({
      loadLanguageData: async () => [{
        name: "Go",
        alias: ["go"],
        extensions: ["go"],
        load: () => go.promise as never,
      }] as never,
    });
    const editorSession = readySession("main.go", "package main\n");
    const first = render(<TextEditor session={editorSession} labels={strings.en} loader={loader} />);
    await waitFor(() => expect(first.container.querySelector(".cm-editor")).toBeInTheDocument());
    first.unmount();
    go.resolve(syntax.of("go"));
    await Promise.resolve();
    expect(editorSession.getSnapshot()).toMatchObject({ languageLoading: true, appliedLanguage: "plain" });

    const second = render(<TextEditor session={editorSession} labels={strings.en} loader={loader} />);
    await waitFor(() => expect(second.container.querySelector(".cm-editor")).toBeInTheDocument());
    await waitFor(() => expect(exposedRuntime(editorSession).state.facet(syntax)).toBe("go"));
    expect(editorSession.getSnapshot()).toMatchObject({ languageLoading: false, appliedLanguage: "go" });
  });

  it("locks and removes highlighting when an edit first crosses the byte limit", async () => {
    const editorSession = readySession("notes.txt", "short");
    const { container } = render(<TextEditor session={editorSession} labels={strings.en} />);
    await waitFor(() => expect(container.querySelector(".cm-editor")).toBeInTheDocument());
    const runtime = exposedRuntime(editorSession);
    runtime.byteSize = textHighlightByteLimit;
    runtime.bridge.view?.dispatch({ changes: { from: runtime.state.doc.length, insert: "x" } });

    await waitFor(() => expect(editorSession.getSnapshot()).toMatchObject({
      largeFileHighlightLocked: true,
      requestedLanguage: "plain",
      appliedLanguage: "plain",
      degradationReason: "document-too-large",
    }));
    expect(screen.getByRole("combobox", { name: "Syntax highlighting" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Syntax highlighting" })).toHaveTextContent("Plain Text (large file)");
  });

  it("allows exactly 2 MiB but keeps a 2 MiB plus one byte document in forced plain text", async () => {
    const exactLoad = vi.fn(async () => [] as never);
    const exactLoader = createCodeMirrorLoader({
      loadLanguageData: async () => [{ name: "Go", alias: ["go"], extensions: ["go"], load: exactLoad }] as never,
    });
    const exactSession = session("main.go");
    exactSession.applyLoadedDocument({ ...document("short"), byteSize: textHighlightByteLimit });
    const exact = render(<TextEditor session={exactSession} labels={strings.en} loader={exactLoader} />);
    await waitFor(() => expect(exact.container.querySelector(".cm-editor")).toBeInTheDocument());
    await waitFor(() => expect(exactSession.getSnapshot().languageLoading).toBe(false));
    expect(exactLoad).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("combobox", { name: "Syntax highlighting" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Syntax highlighting" })).toHaveTextContent("Auto (Go)");
    exact.unmount();

    const oversizedLoadData = vi.fn(async () => [] as never);
    const oversizedSession = session("main.go");
    oversizedSession.applyLoadedDocument({ ...document("short"), byteSize: textHighlightByteLimit + 1 });
    const oversized = render(
      <TextEditor
        session={oversizedSession}
        labels={strings.en}
        loader={createCodeMirrorLoader({ loadLanguageData: oversizedLoadData })}
      />,
    );
    await waitFor(() => expect(oversized.container.querySelector(".cm-editor")).toBeInTheDocument());
    expect(oversizedLoadData).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Syntax highlighting" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Syntax highlighting" })).toHaveTextContent("Plain Text (large file)");
    expect(screen.getByLabelText("Status").firstElementChild).toHaveTextContent("Plain Text");
  });

  it("shows a loading state before the file document is available", () => {
    render(<TextEditor session={session("notes.txt")} labels={strings.en} />);
    expect(screen.getByText("Loading editor…")).toBeInTheDocument();
  });

  it("mounts CodeMirror with line numbers, status metadata, and a visible save action", async () => {
    const onSave = vi.fn();
    const editorSession = readySession("main.go", "package main\n");
    const { container } = render(<TextEditor session={editorSession} labels={strings.en} onSave={onSave} />);

    await waitFor(() => expect(container.querySelector(".cm-editor")).toBeInTheDocument());
    await waitFor(() => expect(editorSession.getSnapshot().languageLoading).toBe(false));
    expect(container.querySelector(".cm-gutters")).toBeInTheDocument();
    expect(container.querySelector(".cm-content")).toHaveAttribute("aria-label", "Edit main.go");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Syntax highlighting" })).toHaveTextContent("Auto (Go)");
    expect(screen.getByText("Go")).toBeInTheDocument();
    expect(screen.getByText("UTF-8")).toBeInTheDocument();
    expect(screen.getByText("LF")).toBeInTheDocument();
    expect(screen.getByText("Line 1, column 1")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    onSave.mockClear();
    fireEvent.keyDown(container.querySelector(".cm-content")!, { key: "s", code: "KeyS", ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("changes syntax from the toolbar without saving or marking the document dirty", async () => {
    const onSave = vi.fn();
    const editorSession = readySession("main.go", "package main\n");
    const { container } = render(<TextEditor session={editorSession} labels={strings.en} onSave={onSave} />);
    await waitFor(() => expect(container.querySelector(".cm-editor")).toBeInTheDocument());
    await waitFor(() => expect(editorSession.getSnapshot().languageLoading).toBe(false));

    await userEvent.click(screen.getByRole("combobox", { name: "Syntax highlighting" }));
    await userEvent.click(await screen.findByRole("option", { name: "Python" }));
    await waitFor(() => expect(editorSession.getSnapshot()).toMatchObject({
      languageSelection: "python",
      appliedLanguage: "python",
      dirty: false,
    }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Syntax highlighting" })).toHaveTextContent("Python");
    expect(screen.getByLabelText("Status").firstElementChild).toHaveTextContent("Python");
  });

  it("keeps editing available when a language chunk fails", async () => {
    const editorSession = readySession("main.go", "package main\n");
    const loader = createCodeMirrorLoader({
      loadLanguageData: async () => [{
        name: "Go",
        alias: ["go"],
        extensions: ["go"],
        load: async () => { throw new Error("offline"); },
      }] as never,
    });
    const { container } = render(<TextEditor session={editorSession} labels={strings.en} loader={loader} />);

    await waitFor(() => expect(container.querySelector(".cm-editor")).toBeInTheDocument());
    await waitFor(() => expect(editorSession.getSnapshot()).toMatchObject({
      highlightEnabled: false,
      degradationReason: "language-load-failed",
    }));
    expect(screen.getByText("Syntax highlighting is unavailable; editing continues as plain text.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Syntax highlighting" })).toBeEnabled();
    expect(screen.getByLabelText("Status").firstElementChild).toHaveTextContent("Plain Text");
  });

  it("restores the document and undo history after the visible view is remounted", async () => {
    const editorSession = readySession("notes.txt", "first");
    const firstRender = render(<TextEditor session={editorSession} labels={strings.en} />);
    await waitFor(() => expect(firstRender.container.querySelector(".cm-editor")).toBeInTheDocument());
    const firstRuntime = editorSession.getRuntime() as ExposedCodeMirrorRuntime;
    firstRuntime.bridge.view?.dispatch({ changes: { from: 0, to: firstRuntime.state.doc.length, insert: "second" } });
    expect(editorSession.currentContent()).toBe("second");

    firstRender.unmount();
    const secondRender = render(<TextEditor session={editorSession} labels={strings.en} />);
    await waitFor(() => expect(secondRender.container.querySelector(".cm-editor")).toBeInTheDocument());
    expect(editorSession.currentContent()).toBe("second");
    fireEvent.keyDown(secondRender.container.querySelector(".cm-content")!, {
      key: "z",
      code: "KeyZ",
      ctrlKey: true,
    });
    await waitFor(() => expect(editorSession.currentContent()).toBe("first"));
  });

  it("renders load errors without creating an editor", () => {
    const editorSession = session("missing.txt");
    editorSession.failLoading({ code: "not_found", message: "File not found" });
    const { container } = render(<TextEditor session={editorSession} labels={strings.en} />);

    expect(screen.getByRole("alert")).toHaveTextContent("File not found");
    expect(container.querySelector(".cm-editor")).not.toBeInTheDocument();
  });
});

describe("TextEditorDialog", () => {
  it("wraps the shared editor in a page dialog and closes through the dialog", async () => {
    const onClose = vi.fn();
    const editorSession = readySession("notes.txt", "hello");
    render(<TextEditorDialog session={editorSession} labels={strings.en} onClose={onClose} />);

    expect(screen.getByRole("dialog")).toHaveTextContent("notes.txt");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes through its backdrop without treating dialog content as a backdrop click", async () => {
    const onClose = vi.fn();
    const editorSession = readySession("notes.txt", "hello");
    render(<TextEditorDialog session={editorSession} labels={strings.en} onClose={onClose} />);

    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();

    const overlay = globalThis.document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]');
    expect(overlay).not.toBeNull();
    await userEvent.click(overlay!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

function session(fileName: string) {
  return new TextEditorSession({
    id: `text-${fileName}`,
    rootId: "data",
    path: fileName,
    fileName,
    text: textFileDescriptor(fileName)!,
  });
}

function readySession(fileName: string, content: string) {
  const editorSession = session(fileName);
  editorSession.applyLoadedDocument(document(content));
  return editorSession;
}

function document(content: string): TextDocument {
  return {
    content,
    encoding: "utf-8",
    lineEnding: content.includes("\n") ? "lf" : "none",
    preferredLineEnding: "lf",
    byteSize: new TextEncoder().encode(content).length,
    revision: `sha256:${"a".repeat(64)}`,
  };
}

type ExposedCodeMirrorRuntime = {
  state: EditorState;
  byteSize: number;
  bridge: {
    view: { dispatch(spec: unknown): void } | null;
  };
};

function exposedRuntime(editorSession: TextEditorSession) {
  return editorSession.getRuntime() as ExposedCodeMirrorRuntime;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
