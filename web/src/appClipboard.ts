import type { Entry, OpsRequest } from "./api/types";

export type AppClipboardOperation = "copy" | "move";

export type AppClipboard = {
  operation: AppClipboardOperation;
  sourceRootId: string;
  sourceParentPath: string;
  paths: string[];
  entries: Entry[];
  createdAt: number;
};

export type ClipboardTarget = {
  rootId: string;
  path: string;
};

export function createAppClipboard(
  operation: AppClipboardOperation,
  sourceRootId: string,
  sourceParentPath: string,
  entries: readonly Entry[],
  createdAt = Date.now(),
): AppClipboard | null {
  if (!sourceRootId || entries.length === 0) return null;
  return {
    operation,
    sourceRootId,
    sourceParentPath,
    paths: entries.map((entry) => entry.relativePath),
    entries: entries.map((entry) => ({ ...entry })),
    createdAt,
  };
}

export function buildClipboardRequest(clipboard: AppClipboard, target: ClipboardTarget): OpsRequest {
  return {
    type: clipboard.operation,
    sourceRoot: clipboard.sourceRootId,
    sources: clipboard.paths,
    destRoot: target.rootId,
    destPath: target.path,
  };
}

export function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='plaintext-only']"));
}
