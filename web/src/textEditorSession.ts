import type {
  TextDocument,
  TextEncoding,
  TextLineEnding,
  TextSaveResult,
  TextWritableLineEnding,
} from "./api/types";
import type { TextFileDescriptor, TextLanguage } from "./textFiles";

export const textHighlightByteLimit = 2 * 1024 * 1024;

export type TextEditorStatus = "loading" | "ready" | "saving" | "conflict" | "error";
export type TextEditorDegradationReason = "large-file" | "document-too-large" | "language-load-failed";
export type TextLanguageSelection = "auto" | TextLanguage;

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
  languageSelection: TextLanguageSelection;
  automaticLanguage: TextLanguage;
  requestedLanguage: TextLanguage;
  appliedLanguage: TextLanguage;
  languageLoading: boolean;
  languageRequestGeneration: number;
  largeFileHighlightLocked: boolean;
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
      languageSelection: "auto",
      automaticLanguage: identity.text.language,
      requestedLanguage: "plain",
      appliedLanguage: "plain",
      languageLoading: false,
      languageRequestGeneration: 0,
      largeFileHighlightLocked: false,
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
    const languageState = this.languageStateForLoadedDocument(document.byteSize);
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
      ...languageState,
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

  startSaving(captureOverride?: TextDocumentCapture): TextSaveOperation | null {
    if (this.disposed || !this.snapshot.hasDocument || this.activeSaveToken !== null) return null;
    const capture = captureOverride ?? this.captureDocument();
    if (!capture) return null;
    const token = this.nextOperationToken++;
    this.activeSaveToken = token;
    this.commit({ status: "saving", issue: null });
    return { token, capture };
  }

  finishSaving(operation: TextSaveOperation, result: TextSaveResult) {
    if (!this.accepts(operation)) return false;
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
    return true;
  }

  failSaving(operation: TextSaveOperation, issue: TextEditorIssue) {
    if (!this.accepts(operation)) return false;
    this.activeSaveToken = null;
    this.commit({ status: "error", issue });
    return true;
  }

  markConflict(operation: TextSaveOperation, issue: TextEditorIssue) {
    if (!this.accepts(operation)) return false;
    this.activeSaveToken = null;
    this.commit({ status: "conflict", issue });
    return true;
  }

  dismissConflict() {
    if (this.disposed || this.snapshot.status !== "conflict") return;
    this.commit({ status: "ready", issue: null });
  }

  beginReloading() {
    if (this.disposed || !this.snapshot.hasDocument || this.activeSaveToken !== null) return false;
    this.commit({ status: "loading", issue: null });
    return true;
  }

  failReloading(issue: TextEditorIssue) {
    if (this.disposed || !this.snapshot.hasDocument || this.snapshot.status !== "loading") return false;
    this.commit({ status: "conflict", issue });
    return true;
  }

  selectLanguage(selection: TextLanguageSelection): number | null {
    if (this.disposed || !this.snapshot.hasDocument || this.snapshot.largeFileHighlightLocked) return null;
    const requestedLanguage = selection === "auto" ? this.snapshot.automaticLanguage : selection;
    const generation = this.snapshot.languageRequestGeneration + 1;
    if (requestedLanguage === "plain") {
      this.commit({
        languageSelection: selection,
        requestedLanguage,
        appliedLanguage: "plain",
        languageLoading: false,
        languageRequestGeneration: generation,
        highlightEnabled: false,
        degradationReason: null,
      });
      return generation;
    }
    this.commit({
      languageSelection: selection,
      requestedLanguage,
      languageLoading: true,
      languageRequestGeneration: generation,
      highlightEnabled: true,
      degradationReason: null,
    });
    return generation;
  }

  completeLanguageRequest(generation: number) {
    if (!this.acceptsLanguageRequest(generation)) return false;
    this.commit({
      appliedLanguage: this.snapshot.requestedLanguage,
      languageLoading: false,
      highlightEnabled: true,
      degradationReason: null,
    });
    return true;
  }

  failLanguageRequest(generation: number) {
    if (!this.acceptsLanguageRequest(generation)) return false;
    this.commit({
      appliedLanguage: "plain",
      languageLoading: false,
      highlightEnabled: false,
      degradationReason: "language-load-failed",
    });
    return true;
  }

  disableHighlight(reason: TextEditorDegradationReason) {
    if (this.disposed || (!this.snapshot.highlightEnabled && this.snapshot.degradationReason === reason)) return;
    const locksForSize = reason === "large-file" || reason === "document-too-large";
    this.commit({
      requestedLanguage: locksForSize ? "plain" : this.snapshot.requestedLanguage,
      appliedLanguage: "plain",
      languageLoading: false,
      languageRequestGeneration: locksForSize
        ? this.snapshot.languageRequestGeneration + 1
        : this.snapshot.languageRequestGeneration,
      largeFileHighlightLocked: locksForSize || this.snapshot.largeFileHighlightLocked,
      highlightEnabled: false,
      degradationReason: reason,
    });
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

  private acceptsLanguageRequest(generation: number) {
    return !this.disposed &&
      this.snapshot.hasDocument &&
      !this.snapshot.largeFileHighlightLocked &&
      this.snapshot.languageLoading &&
      this.snapshot.requestedLanguage !== "plain" &&
      this.snapshot.languageRequestGeneration === generation;
  }

  private languageStateForLoadedDocument(byteSize: number): Pick<
    TextEditorSessionSnapshot,
    | "requestedLanguage"
    | "appliedLanguage"
    | "languageLoading"
    | "languageRequestGeneration"
    | "largeFileHighlightLocked"
    | "highlightEnabled"
    | "degradationReason"
  > {
    const languageRequestGeneration = this.snapshot.languageRequestGeneration + 1;
    if (byteSize > textHighlightByteLimit) {
      return {
        requestedLanguage: "plain",
        appliedLanguage: "plain",
        languageLoading: false,
        languageRequestGeneration,
        largeFileHighlightLocked: true,
        highlightEnabled: false,
        degradationReason: "large-file",
      };
    }
    const requestedLanguage = this.snapshot.languageSelection === "auto"
      ? this.snapshot.automaticLanguage
      : this.snapshot.languageSelection;
    return {
      requestedLanguage,
      appliedLanguage: "plain",
      languageLoading: requestedLanguage !== "plain",
      languageRequestGeneration,
      largeFileHighlightLocked: false,
      highlightEnabled: requestedLanguage !== "plain",
      degradationReason: null,
    };
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
