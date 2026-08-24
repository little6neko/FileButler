import { describe, expect, it, vi } from "vitest";
import type { TextDocument } from "./api/types";
import { createTextEditorManager, type TextEditorHolder } from "./textEditorManager";
import type { EditorDocumentAdapter, TextEditorSession } from "./textEditorSession";
import { textFileDescriptor } from "./textFiles";

describe("TextEditorManager", () => {
  it("reuses rootId and relativePath while keeping different roots independent", () => {
    let nextId = 1;
    const manager = createTextEditorManager(() => `text-${nextId++}`);
    const first = manager.acquire(input("data", "src/main.go"), desktop("window-1"));
    const reused = manager.acquire(input("data", "src/main.go"), compact("dialog"));
    const otherRoot = manager.acquire(input("backup", "src/main.go"), desktop("window-2"));

    expect(first.created).toBe(true);
    expect(reused).toMatchObject({ created: false, borrowed: true });
    expect(reused.session).toBe(first.session);
    expect(otherRoot.session).not.toBe(first.session);
    expect(manager.findByPath("data", "src/main.go")).toBe(first.session);
    expect(manager.getSnapshot()).toMatchObject({ sessionCount: 2, dirtyCount: 0 });
  });

  it("allows borrowed compact views to close without deleting desktop state", () => {
    const manager = createTextEditorManager(() => "text-1");
    const acquired = manager.acquire(input("data", "notes.txt"), desktop("window"));
    manager.acquire(input("data", "notes.txt"), compact("dialog"));
    makeDirty(acquired.session);

    expect(manager.release(acquired.session.id, compact("dialog"))).toEqual({ released: true, removed: false, blocked: false });
    expect(manager.get(acquired.session.id)).toBe(acquired.session);
    expect(acquired.session.currentContent()).toBe("changed");
    expect(manager.hasHolder(acquired.session.id, desktop("window"))).toBe(true);
  });

  it("shares language selection between holders and resets it after the final release", () => {
    let nextId = 1;
    const manager = createTextEditorManager(() => `text-${nextId++}`);
    const first = manager.acquire(input("data", "main.go"), desktop("window"));
    first.session.applyLoadedDocument(document());
    first.session.selectLanguage("python");

    const borrowed = manager.acquire(input("data", "main.go"), compact("dialog"));
    expect(borrowed.session).toBe(first.session);
    expect(borrowed.session.getSnapshot()).toMatchObject({
      languageSelection: "python",
      requestedLanguage: "python",
    });

    manager.release(first.session.id, compact("dialog"));
    manager.release(first.session.id, desktop("window"));
    const reopened = manager.acquire(input("data", "main.go"), desktop("reopened"));
    expect(reopened.session).not.toBe(first.session);
    expect(reopened.session.getSnapshot()).toMatchObject({
      languageSelection: "auto",
      languageRequestGeneration: 0,
    });
  });

  it("removes the last clean holder and cleans subscriptions and runtime", () => {
    const manager = createTextEditorManager(() => "text-1");
    const acquired = manager.acquire(input("data", "notes.txt"), compact("dialog"));
    const dispose = vi.fn();
    acquired.session.applyLoadedDocument(document());
    acquired.session.initializeRuntime({ ...fakeAdapter, dispose });

    expect(manager.release(acquired.session.id, compact("dialog"))).toEqual({ released: true, removed: true, blocked: false });
    expect(manager.get(acquired.session.id)).toBeNull();
    expect(manager.findByPath("data", "notes.txt")).toBeNull();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot()).toMatchObject({ sessionCount: 0, dirtyCount: 0 });
  });

  it("blocks releasing the last dirty holder until discard is explicitly allowed", () => {
    const manager = createTextEditorManager(() => "text-1");
    const holder = compact("dialog");
    const acquired = manager.acquire(input("data", "notes.txt"), holder);
    makeDirty(acquired.session);

    expect(manager.release(acquired.session.id, holder)).toEqual({ released: false, removed: false, blocked: true });
    expect(manager.hasHolder(acquired.session.id, holder)).toBe(true);
    expect(manager.release(acquired.session.id, holder, { discardDirty: true })).toEqual({ released: true, removed: true, blocked: false });
  });

  it("maintains a stable dirty summary and only notifies on aggregate changes", () => {
    const manager = createTextEditorManager(() => "text-1");
    const listener = vi.fn();
    manager.subscribe(listener);
    const acquired = manager.acquire(input("data", "notes.txt"), desktop("window"));
    const afterCreate = manager.getSnapshot();
    expect(afterCreate).toMatchObject({ sessionCount: 1, dirtyCount: 0, dirtyInstanceIds: [] });
    const callsAfterCreate = listener.mock.calls.length;

    makeReady(acquired.session);
    expect(manager.getSnapshot()).toBe(afterCreate);
    expect(listener).toHaveBeenCalledTimes(callsAfterCreate);

    const runtime = acquired.session.getRuntime() as FakeRuntime;
    acquired.session.setRuntime({ ...runtime, document: { text: "changed" } });
    const dirty = manager.getSnapshot();
    expect(dirty).toMatchObject({ dirtyCount: 1, dirtyInstanceIds: ["text-1"] });
    acquired.session.setRuntime({ ...runtime, document: { text: "changed again" } });
    expect(manager.getSnapshot()).toBe(dirty);

    acquired.session.setRuntime(runtime);
    expect(manager.getSnapshot()).toMatchObject({ dirtyCount: 0, dirtyInstanceIds: [] });
  });

  it("disposes all sessions when the manager is disposed", () => {
    let nextId = 1;
    const manager = createTextEditorManager(() => `text-${nextId++}`);
    const first = manager.acquire(input("data", "a.txt"), desktop("a")).session;
    const second = manager.acquire(input("data", "b.txt"), desktop("b")).session;
    makeReady(first);
    makeReady(second);

    manager.dispose();
    expect(first.isDisposed()).toBe(true);
    expect(second.isDisposed()).toBe(true);
    expect(manager.getSnapshot()).toMatchObject({ sessionCount: 0, dirtyCount: 0 });
  });
});

function input(rootId: string, path: string) {
  return {
    rootId,
    path,
    fileName: path.slice(path.lastIndexOf("/") + 1),
    text: textFileDescriptor(path)!,
  };
}

function desktop(id: string): TextEditorHolder {
  return { kind: "desktop", id };
}

function compact(id: string): TextEditorHolder {
  return { kind: "compact", id };
}

function makeReady(session: TextEditorSession) {
  session.applyLoadedDocument(document());
  session.initializeRuntime(fakeAdapter);
}

function makeDirty(session: TextEditorSession) {
  makeReady(session);
  const runtime = session.getRuntime() as FakeRuntime;
  session.setRuntime({ ...runtime, document: { text: "changed" } });
}

function document(): TextDocument {
  return {
    content: "initial",
    encoding: "utf-8",
    lineEnding: "none",
    preferredLineEnding: "lf",
    byteSize: 7,
    revision: `sha256:${"a".repeat(64)}`,
  };
}

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
