import { describe, expect, it, vi } from "vitest";
import { APIError } from "./api/client";
import type { TextDocument, TextSaveResult } from "./api/types";
import { createTextEditorController } from "./textEditorController";
import { TextEditorSession, type EditorDocumentAdapter } from "./textEditorSession";
import { textFileDescriptor } from "./textFiles";

describe("TextEditorController", () => {
  it("deduplicates an in-flight save and advances the saved baseline once", async () => {
    let resolveSave!: (result: TextSaveResult) => void;
    const save = vi.fn().mockReturnValue(new Promise<TextSaveResult>((resolve) => {
      resolveSave = resolve;
    }));
    const controller = createTextEditorController({ read: vi.fn(), save });
    const session = dirtySession("local text");

    const first = controller.save(session);
    const duplicate = controller.save(session);

    expect(duplicate).toBe(first);
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith({
      rootId: "data",
      path: "notes.txt",
      content: "local text",
      encoding: "utf-8",
      lineEnding: "lf",
      revision: revision("a"),
      force: false,
    });
    resolveSave({ byteSize: 10, revision: revision("b") });

    await expect(first).resolves.toEqual({ kind: "saved" });
    await expect(duplicate).resolves.toEqual({ kind: "saved" });
    expect(session.getSnapshot()).toMatchObject({
      status: "ready",
      dirty: false,
      byteSize: 10,
      revision: revision("b"),
    });
  });

  it("retains the failed capture and force-saves that same content after a conflict", async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new APIError("revision_conflict", "changed elsewhere", 409))
      .mockResolvedValueOnce({ byteSize: 10, revision: revision("c") });
    const controller = createTextEditorController({ read: vi.fn(), save });
    const session = dirtySession("local text");

    await expect(controller.save(session)).resolves.toEqual({ kind: "conflict" });
    expect(session.getSnapshot()).toMatchObject({ status: "conflict", dirty: true });
    expect(controller.hasConflict(session)).toBe(true);
    edit(session, "typed after conflict");

    await expect(controller.forceSave(session)).resolves.toEqual({ kind: "saved" });
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({
      content: "local text",
      force: true,
    }));
    expect(session.currentContent()).toBe("typed after conflict");
    expect(session.getSnapshot()).toMatchObject({ status: "ready", dirty: true, revision: revision("c") });
    expect(controller.hasConflict(session)).toBe(false);
  });

  it("keeps local content dirty for size and ordinary save failures", async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new APIError("file_too_large", "too large", 413))
      .mockRejectedValueOnce(new Error("network unavailable"));
    const controller = createTextEditorController({ read: vi.fn(), save });
    const session = dirtySession("local text");

    await expect(controller.save(session)).resolves.toMatchObject({ kind: "failed", issue: { code: "file_too_large" } });
    expect(session.currentContent()).toBe("local text");
    expect(session.getSnapshot()).toMatchObject({ status: "error", dirty: true });
    await expect(controller.save(session)).resolves.toMatchObject({ kind: "failed", issue: { code: "operation_failed" } });
    expect(session.currentContent()).toBe("local text");
    expect(session.getSnapshot().dirty).toBe(true);
  });

  it("reloads the latest disk document after a conflict and replaces the baseline", async () => {
    const save = vi.fn().mockRejectedValue(new APIError("revision_conflict", "changed elsewhere", 409));
    const read = vi.fn().mockResolvedValue(document({ content: "disk text", revision: revision("d"), byteSize: 9 }));
    const controller = createTextEditorController({ read, save });
    const session = dirtySession("local text");
    await controller.save(session);

    await expect(controller.reload(session)).resolves.toEqual({ kind: "reloaded" });

    expect(read).toHaveBeenCalledWith("data", "notes.txt");
    expect(session.currentContent()).toBe("disk text");
    expect(session.getSnapshot()).toMatchObject({ status: "ready", dirty: false, revision: revision("d") });
    expect(controller.hasConflict(session)).toBe(false);
  });

  it("ignores a save response after its session is disposed", async () => {
    let resolveSave!: (result: TextSaveResult) => void;
    const save = vi.fn().mockReturnValue(new Promise<TextSaveResult>((resolve) => {
      resolveSave = resolve;
    }));
    const controller = createTextEditorController({ read: vi.fn(), save });
    const session = dirtySession("local text");
    const request = controller.save(session);

    session.dispose();
    resolveSave({ byteSize: 10, revision: revision("z") });

    await expect(request).resolves.toEqual({ kind: "ignored" });
    expect(session.getSnapshot().revision).toBe(revision("a"));
  });
});

type FakeRuntime = { document: { text: string } };

const adapter: EditorDocumentAdapter = {
  create(content) {
    return { document: { text: content } } satisfies FakeRuntime;
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

function dirtySession(content: string) {
  const session = new TextEditorSession({
    id: "text-1",
    rootId: "data",
    path: "notes.txt",
    fileName: "notes.txt",
    text: textFileDescriptor("notes.txt")!,
  });
  session.applyLoadedDocument(document());
  session.initializeRuntime(adapter);
  edit(session, content);
  return session;
}

function edit(session: TextEditorSession, content: string) {
  session.setRuntime({ document: { text: content } } satisfies FakeRuntime);
}

function document(overrides: Partial<TextDocument> = {}): TextDocument {
  return {
    content: "initial",
    encoding: "utf-8",
    lineEnding: "lf",
    preferredLineEnding: "lf",
    byteSize: 7,
    revision: revision("a"),
    ...overrides,
  };
}

function revision(character: string) {
  return `sha256:${character.repeat(64)}`;
}
