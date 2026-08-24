import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TextDocument } from "../api/types";
import { createCodeMirrorLoader } from "../codeMirrorLoader";
import { strings } from "../i18n";
import { TextEditorSession } from "../textEditorSession";
import { textFileDescriptor } from "../textFiles";
import { TextEditor } from "./TextEditor";
import { TextEditorDialog } from "./TextEditorDialog";

describe("TextEditor", () => {
  it("shows a loading state before the file document is available", () => {
    render(<TextEditor session={session("notes.txt")} labels={strings.en} />);
    expect(screen.getByText("Loading editor…")).toBeInTheDocument();
  });

  it("mounts CodeMirror with line numbers, status metadata, and a visible save action", async () => {
    const onSave = vi.fn();
    const editorSession = readySession("main.go", "package main\n");
    const { container } = render(<TextEditor session={editorSession} labels={strings.en} onSave={onSave} />);

    await waitFor(() => expect(container.querySelector(".cm-editor")).toBeInTheDocument());
    expect(container.querySelector(".cm-gutters")).toBeInTheDocument();
    expect(container.querySelector(".cm-content")).toHaveAttribute("aria-label", "Edit main.go");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
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
    expect(editorSession.getSnapshot()).toMatchObject({
      highlightEnabled: false,
      degradationReason: "language-load-failed",
    });
    expect(screen.getByText("Syntax highlighting is unavailable; editing continues as plain text.")).toBeInTheDocument();
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
  state: { doc: { length: number } };
  bridge: {
    view: { dispatch(spec: unknown): void } | null;
  };
};
