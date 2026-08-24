import type { TextDocument, TextSaveRequest, TextSaveResult } from "./api/types";
import type {
  TextDocumentCapture,
  TextEditorIssue,
  TextEditorSession,
  TextSaveOperation,
} from "./textEditorSession";

export type TextEditorTransport = {
  read(rootId: string, path: string): Promise<TextDocument>;
  save(request: TextSaveRequest): Promise<TextSaveResult>;
};

export type TextEditorActionResult =
  | { kind: "saved" }
  | { kind: "conflict" }
  | { kind: "reloaded" }
  | { kind: "failed"; issue: TextEditorIssue }
  | { kind: "busy" }
  | { kind: "ignored" };

export class TextEditorController {
  private readonly transport: TextEditorTransport;
  private readonly saveRequests = new WeakMap<TextEditorSession, Promise<TextEditorActionResult>>();
  private readonly reloadRequests = new WeakMap<TextEditorSession, Promise<TextEditorActionResult>>();
  private readonly conflictCaptures = new WeakMap<TextEditorSession, TextDocumentCapture>();

  constructor(transport: TextEditorTransport) {
    this.transport = transport;
  }

  save(session: TextEditorSession): Promise<TextEditorActionResult> {
    const existing = this.saveRequests.get(session);
    if (existing) return existing;
    if (this.reloadRequests.has(session)) return Promise.resolve({ kind: "busy" });
    if (session.getSnapshot().status === "conflict") return Promise.resolve({ kind: "ignored" });
    return this.startSave(session, false);
  }

  forceSave(session: TextEditorSession): Promise<TextEditorActionResult> {
    const existing = this.saveRequests.get(session);
    if (existing) return existing;
    if (this.reloadRequests.has(session)) return Promise.resolve({ kind: "busy" });
    const capture = this.conflictCaptures.get(session);
    if (!capture) return Promise.resolve({ kind: "ignored" });
    return this.startSave(session, true, capture);
  }

  reload(session: TextEditorSession): Promise<TextEditorActionResult> {
    const existing = this.reloadRequests.get(session);
    if (existing) return existing;
    if (this.saveRequests.has(session)) return Promise.resolve({ kind: "busy" });
    if (!this.conflictCaptures.has(session) || !session.beginReloading()) {
      return Promise.resolve({ kind: "ignored" });
    }

    const request = (async (): Promise<TextEditorActionResult> => {
      try {
        const document = await this.transport.read(session.rootId, session.path);
        if (session.isDisposed()) return { kind: "ignored" };
        session.applyLoadedDocument(document);
        this.conflictCaptures.delete(session);
        return { kind: "reloaded" };
      } catch (error) {
        const issue = textEditorIssue(error);
        return session.failReloading(issue) ? { kind: "failed", issue } : { kind: "ignored" };
      }
    })();
    this.reloadRequests.set(session, request);
    void request.finally(() => {
      if (this.reloadRequests.get(session) === request) this.reloadRequests.delete(session);
    });
    return request;
  }

  hasConflict(session: TextEditorSession) {
    return this.conflictCaptures.has(session);
  }

  dismissConflict(session: TextEditorSession) {
    this.conflictCaptures.delete(session);
    session.dismissConflict();
  }

  private startSave(
    session: TextEditorSession,
    force: boolean,
    capture?: TextDocumentCapture,
  ): Promise<TextEditorActionResult> {
    const snapshot = session.getSnapshot();
    if (!snapshot.encoding || !snapshot.saveLineEnding || !snapshot.revision) {
      return Promise.resolve({ kind: "ignored" });
    }
    const operation = session.startSaving(capture);
    if (!operation) return Promise.resolve({ kind: "ignored" });
    const payload: TextSaveRequest = {
      rootId: session.rootId,
      path: session.path,
      content: operation.capture.content,
      encoding: snapshot.encoding,
      lineEnding: snapshot.saveLineEnding,
      revision: snapshot.revision,
      force,
    };

    const request = this.performSave(session, operation, payload, force);
    this.saveRequests.set(session, request);
    void request.finally(() => {
      if (this.saveRequests.get(session) === request) this.saveRequests.delete(session);
    });
    return request;
  }

  private async performSave(
    session: TextEditorSession,
    operation: TextSaveOperation,
    payload: TextSaveRequest,
    force: boolean,
  ): Promise<TextEditorActionResult> {
    try {
      const result = await this.transport.save(payload);
      if (!session.finishSaving(operation, result)) return { kind: "ignored" };
      this.conflictCaptures.delete(session);
      return { kind: "saved" };
    } catch (error) {
      const issue = textEditorIssue(error);
      if (!force && issue.code === "revision_conflict") {
        if (!session.markConflict(operation, issue)) return { kind: "ignored" };
        this.conflictCaptures.set(session, operation.capture);
        return { kind: "conflict" };
      }
      return session.failSaving(operation, issue) ? { kind: "failed", issue } : { kind: "ignored" };
    }
  }
}

export function createTextEditorController(transport: TextEditorTransport) {
  return new TextEditorController(transport);
}

export function textEditorIssue(error: unknown): TextEditorIssue {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return {
      code: error.code,
      message: error instanceof Error ? error.message : error.code,
    };
  }
  return {
    code: "operation_failed",
    message: error instanceof Error ? error.message : "Unable to complete the text file operation",
  };
}
