import type {
  TextDocument,
  TextEncoding,
  TextLineEnding,
  TextSaveResult,
  TextWritableLineEnding,
} from "./api/types";
import type { TextFileDescriptor } from "./textFiles";

export const textHighlightByteLimit = 2 * 1024 * 1024;

export type TextEditorStatus = "loading" | "ready" | "saving" | "conflict" | "error";
export type TextEditorDegradationReason = "large-file" | "document-too-large" | "language-load-failed";

export type TextEditorIssue = {
  code: string;
  message: string;
};

export type EditorDocumentAdapter = {
  create(content: string): unknown;
  content(runtime: unknown): string;
  document(runtime: unknown): unknown;
  equals(left: unknown, right: unknown): boolean;
  dispose?(runtime: unknown): void;
};

export type TextEditorSessionIdentity = {
  id: string;
  rootId: string;
  path: string;
  fileName: string;
  text: TextFileDescriptor;
};

export type TextEditorSessionSnapshot = TextEditorSessionIdentity & {
  status: TextEditorStatus;
  documentVersion: number;
  hasDocument: boolean;
  dirty: boolean;
  encoding: TextEncoding | null;
  lineEnding: TextLineEnding | null;
  saveLineEnding: TextWritableLineEnding | null;
  byteSize: number;
  revision: string | null;
  highlightEnabled: boolean;
  degradationReason: TextEditorDegradationReason | null;
  issue: TextEditorIssue | null;
};

export type TextDocumentCapture = {
  content: string;
  document: unknown;
  adapter: EditorDocumentAdapter | null;
};

export type TextSaveOperation = {
  token: number;
  capture: TextDocumentCapture;
};

type Listener = () => void;

export class TextEditorSession {
  readonly id: string;
  readonly rootId: string;
  readonly path: string;
  readonly fileName: string;
  readonly text: TextFileDescriptor;

  private snapshot: TextEditorSessionSnapshot;
  private readonly listeners = new Set<Listener>();
  private sourceContent = "";
  private baselineContent = "";
  private adapter: EditorDocumentAdapter | null = null;
  private runtime: unknown | null = null;
  private baselineDocument: unknown | null = null;
  private baselineAdapter: EditorDocumentAdapter | null = null;
  private nextOperationToken = 1;
  private activeSaveToken: number | null = null;
  private disposed = false;

  constructor(identity: TextEditorSessionIdentity) {
    this.id = identity.id;
    this.rootId = identity.rootId;
    this.path = identity.path;
    this.fileName = identity.fileName;
    this.text = identity.text;
    this.snapshot = {
      ...identity,
      status: "loading",
      documentVersion: 0,
      hasDocument: false,
      dirty: false,
      encoding: null,
      lineEnding: null,
      saveLineEnding: null,
      byteSize: 0,
      revision: null,
      highlightEnabled: false,
      degradationReason: null,
      issue: null,
    };
  }

  subscribe = (listener: Listener) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  applyLoadedDocument(document: TextDocument) {
    if (this.disposed) return;
    this.releaseRuntime();
    this.sourceContent = document.content;
    this.baselineContent = document.content;
    this.activeSaveToken = null;
    const shouldHighlight = this.text.highlight && document.byteSize <= textHighlightByteLimit;
    this.commit({
      status: "ready",
      documentVersion: this.snapshot.documentVersion + 1,
      hasDocument: true,
      dirty: false,
      encoding: document.encoding,
      lineEnding: document.lineEnding,
      saveLineEnding: document.preferredLineEnding,
      byteSize: document.byteSize,
      revision: document.revision,
      highlightEnabled: shouldHighlight,
      degradationReason: document.byteSize > textHighlightByteLimit ? "large-file" : null,
      issue: null,
    });
  }

  failLoading(issue: TextEditorIssue) {
    if (this.disposed) return;
    this.activeSaveToken = null;
    this.commit({ status: "error", hasDocument: false, issue });
  }

  initializeRuntime(adapter: EditorDocumentAdapter): unknown | null {
    if (this.disposed || !this.snapshot.hasDocument) return null;
    if (this.runtime !== null) return this.runtime;
    const runtime = adapter.create(this.sourceContent);
    this.adapter = adapter;
    this.runtime = runtime;
    this.baselineDocument = adapter.document(runtime);
    this.baselineAdapter = adapter;
    return runtime;
  }

  getRuntime(): unknown | null {
    return this.runtime;
  }

  setRuntime(runtime: unknown) {
    if (this.disposed || !this.adapter || !this.snapshot.hasDocument) return;
    this.runtime = runtime;
    const dirty = this.calculateDirty();
    if (dirty !== this.snapshot.dirty) this.commit({ dirty });
  }

  currentContent(): string {
    if (this.runtime !== null && this.adapter) return this.adapter.content(this.runtime);
    return this.sourceContent;
  }

  captureDocument(): TextDocumentCapture | null {
    if (!this.snapshot.hasDocument) return null;
    if (this.runtime !== null && this.adapter) {
      return {
        content: this.adapter.content(this.runtime),
        document: this.adapter.document(this.runtime),
        adapter: this.adapter,
      };
    }
    return { content: this.sourceContent, document: this.sourceContent, adapter: null };
  }

  startSaving(): TextSaveOperation | null {
    if (this.disposed || !this.snapshot.hasDocument || this.activeSaveToken !== null) return null;
    const capture = this.captureDocument();
    if (!capture) return null;
    const token = this.nextOperationToken++;
    this.activeSaveToken = token;
    this.commit({ status: "saving", issue: null });
    return { token, capture };
  }

  finishSaving(operation: TextSaveOperation, result: TextSaveResult) {
    if (!this.accepts(operation)) return;
    this.activeSaveToken = null;
    this.baselineContent = operation.capture.content;
    this.baselineDocument = operation.capture.document;
    this.baselineAdapter = operation.capture.adapter;
    this.commit({
      status: "ready",
      dirty: this.calculateDirty(),
      byteSize: result.byteSize,
      revision: result.revision,
      issue: null,
    });
  }

  failSaving(operation: TextSaveOperation, issue: TextEditorIssue) {
    if (!this.accepts(operation)) return;
    this.activeSaveToken = null;
    this.commit({ status: "error", issue });
  }

  markConflict(operation: TextSaveOperation, issue: TextEditorIssue) {
    if (!this.accepts(operation)) return;
    this.activeSaveToken = null;
    this.commit({ status: "conflict", issue });
  }

  dismissConflict() {
    if (this.disposed || this.snapshot.status !== "conflict") return;
    this.commit({ status: "ready", issue: null });
  }

  disableHighlight(reason: TextEditorDegradationReason) {
    if (this.disposed || (!this.snapshot.highlightEnabled && this.snapshot.degradationReason === reason)) return;
    this.commit({ highlightEnabled: false, degradationReason: reason });
  }

  isDisposed() {
    return this.disposed;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseRuntime();
    this.listeners.clear();
    this.activeSaveToken = null;
  }

  private accepts(operation: TextSaveOperation) {
    return !this.disposed && this.activeSaveToken === operation.token;
  }

  private calculateDirty() {
    if (!this.snapshot.hasDocument) return false;
    if (
      this.runtime !== null &&
      this.adapter &&
      this.baselineDocument !== null &&
      this.baselineAdapter === this.adapter
    ) {
      return !this.adapter.equals(this.adapter.document(this.runtime), this.baselineDocument);
    }
    return this.currentContent() !== this.baselineContent;
  }

  private releaseRuntime() {
    if (this.runtime !== null && this.adapter?.dispose) this.adapter.dispose(this.runtime);
    this.adapter = null;
    this.runtime = null;
    this.baselineDocument = null;
    this.baselineAdapter = null;
  }

  private commit(update: Partial<TextEditorSessionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...update };
    for (const listener of Array.from(this.listeners)) listener();
  }
}
