import { describe, expect, it, vi } from "vitest";
import type { TextDocument } from "./api/types";
import {
  TextEditorSession,
  type EditorDocumentAdapter,
  type TextEditorIssue,
} from "./textEditorSession";
import { textFileDescriptor } from "./textFiles";

describe("TextEditorSession", () => {
  it("moves from loading to ready and only notifies on visible dirty changes while typing", () => {
    const session = createSession();
    const listener = vi.fn();
    session.subscribe(listener);
    expect(session.getSnapshot()).toMatchObject({ status: "loading", dirty: false, hasDocument: false });

    session.applyLoadedDocument(document({ content: "one" }));
    expect(session.getSnapshot()).toMatchObject({ status: "ready", dirty: false, hasDocument: true });
    const loadedNotifications = listener.mock.calls.length;
    const runtime = session.initializeRuntime(fakeAdapter) as FakeRuntime;
    expect(runtime.document.text).toBe("one");
    expect(listener).toHaveBeenCalledTimes(loadedNotifications);

    session.setRuntime(editRuntime(runtime, "two"));
    expect(session.getSnapshot().dirty).toBe(true);
    expect(listener).toHaveBeenCalledTimes(loadedNotifications + 1);
    session.setRuntime(editRuntime(session.getRuntime() as FakeRuntime, "three"));
    expect(listener).toHaveBeenCalledTimes(loadedNotifications + 1);

    session.setRuntime(editRuntime(session.getRuntime() as FakeRuntime, "one"));
    expect(session.getSnapshot().dirty).toBe(false);
    expect(listener).toHaveBeenCalledTimes(loadedNotifications + 2);
  });

  it("keeps edits made during a save dirty after the saved baseline advances", () => {
    const session = createReadySession("initial");
    const runtime = session.getRuntime() as FakeRuntime;
    session.setRuntime(editRuntime(runtime, "sent"));

    const operation = session.startSaving();
    expect(operation?.capture.content).toBe("sent");
    expect(session.getSnapshot().status).toBe("saving");
    expect(session.startSaving()).toBeNull();

    session.setRuntime(editRuntime(session.getRuntime() as FakeRuntime, "typed later"));
    session.finishSaving(operation!, { byteSize: 4, revision: revision("b") });
    expect(session.getSnapshot()).toMatchObject({ status: "ready", dirty: true, byteSize: 4, revision: revision("b") });

    session.setRuntime(editRuntime(session.getRuntime() as FakeRuntime, "sent"));
    expect(session.getSnapshot().dirty).toBe(false);
  });

  it("exposes conflict and error states without losing the current document", () => {
    const session = createReadySession("initial");
    session.setRuntime(editRuntime(session.getRuntime() as FakeRuntime, "local"));
    const operation = session.startSaving()!;
    const conflict = issue("revision_conflict", "changed elsewhere");

    session.markConflict(operation, conflict);
    expect(session.getSnapshot()).toMatchObject({ status: "conflict", dirty: true, issue: conflict });
    expect(session.currentContent()).toBe("local");
    session.dismissConflict();
    expect(session.getSnapshot()).toMatchObject({ status: "ready", dirty: true, issue: null });

    const retry = session.startSaving()!;
    const failure = issue("operation_failed", "network failed");
    session.failSaving(retry, failure);
    expect(session.getSnapshot()).toMatchObject({ status: "error", dirty: true, issue: failure });
    expect(session.currentContent()).toBe("local");
  });

  it("reports load failures and ignores stale save completions", () => {
    const session = createSession();
    session.failLoading(issue("not_found", "missing"));
    expect(session.getSnapshot()).toMatchObject({ status: "error", hasDocument: false });

    session.applyLoadedDocument(document({ content: "loaded" }));
    session.initializeRuntime(fakeAdapter);
    const first = session.startSaving()!;
    session.failSaving(first, issue("operation_failed", "failed"));
    const second = session.startSaving()!;
    session.finishSaving(first, { byteSize: 99, revision: revision("x") });
    expect(session.getSnapshot()).toMatchObject({ status: "saving", revision: revision("a") });
    session.finishSaving(second, { byteSize: 6, revision: revision("c") });
    expect(session.getSnapshot()).toMatchObject({ status: "ready", revision: revision("c") });
  });

  it("retains selection and undo history while no editor view is mounted", () => {
    const session = createReadySession("first");
    const edited: FakeRuntime = {
      document: { text: "second" },
      selection: 5,
      history: ["first"],
    };
    session.setRuntime(edited);

    expect(session.getRuntime()).toBe(edited);
    expect(session.getRuntime()).toMatchObject({ selection: 5, history: ["first"] });
  });

  it("degrades highlighting for large files and disposes runtime resources", () => {
    const dispose = vi.fn();
    const adapter = { ...fakeAdapter, dispose } satisfies EditorDocumentAdapter;
    const session = createSession();
    session.applyLoadedDocument(document({ byteSize: 2 * 1024 * 1024 + 1 }));
    session.initializeRuntime(adapter);
    expect(session.getSnapshot()).toMatchObject({ highlightEnabled: false, degradationReason: "large-file" });

    session.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(session.isDisposed()).toBe(true);
  });
});

type FakeRuntime = {
  document: { text: string };
  selection: number;
  history: string[];
};

const fakeAdapter: EditorDocumentAdapter = {
  create(content) {
    return { document: { text: content }, selection: 0, history: [] } satisfies FakeRuntime;
  },
  content(runtime) {
    return (runtime as FakeRuntime).document.text;
  },
  document(runtime) {
    return (runtime as FakeRuntime).document;
  },
  equals(left, right) {
    return (left as FakeRuntime["document"]).text === (right as FakeRuntime["document"]).text;
  },
};

function editRuntime(runtime: FakeRuntime, content: string): FakeRuntime {
  return {
    document: { text: content },
    selection: content.length,
    history: [...runtime.history, runtime.document.text],
  };
}

function createSession() {
  return new TextEditorSession({
    id: "text-1",
    rootId: "data",
    path: "notes.txt",
    fileName: "notes.txt",
    text: textFileDescriptor("notes.txt")!,
  });
}

function createReadySession(content: string) {
  const session = createSession();
  session.applyLoadedDocument(document({ content, byteSize: content.length }));
  session.initializeRuntime(fakeAdapter);
  return session;
}

function document(overrides: Partial<TextDocument> = {}): TextDocument {
  return {
    content: "initial",
    encoding: "utf-8",
    lineEnding: "none",
    preferredLineEnding: "lf",
    byteSize: 7,
    revision: revision("a"),
    ...overrides,
  };
}

function revision(character: string) {
  return `sha256:${character.repeat(64)}`;
}

function issue(code: string, message: string): TextEditorIssue {
  return { code, message };
}
