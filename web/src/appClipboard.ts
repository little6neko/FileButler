import { useSyncExternalStore } from "react";
import type { Entry, OpsRequest } from "./api/types";

export type AppClipboardOperation = "copy" | "move";

export type AppClipboard = {
  accountId?: string;
  operation: AppClipboardOperation;
  sourceRootId: string;
  sourceParentPath: string;
  paths: string[];
  entries: Entry[];
  createdAt: number;
};

export type ClipboardTarget = {
  accountId?: string;
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
    ...(clipboard.accountId || target.accountId ? { accountId: clipboard.accountId ?? target.accountId, sourceAccountId: clipboard.accountId, destAccountId: target.accountId } : {}),
    sourceRoot: clipboard.sourceRootId,
    sources: clipboard.paths,
    destRoot: target.rootId,
    destPath: target.path,
  };
}

let clipboard: AppClipboard | null = null;
const listeners = new Set<() => void>();
export function getAppClipboard() { return clipboard; }
export function setAppClipboard(value: AppClipboard | null) {
  clipboard = value;
  for (const listener of listeners) listener();
}
export function clearAppClipboard(expected: AppClipboard | null) {
  if (clipboard === expected) setAppClipboard(null);
}
export function useAppClipboard() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getAppClipboard, getAppClipboard);
}

export function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='plaintext-only']"));
}
