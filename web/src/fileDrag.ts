import type { Entry, OpsRequest } from "./api/types";

export type PaneKey = string;
export type DragOperation = Extract<OpsRequest["type"], "move" | "copy">;
export type InvalidDropReason = "same-directory" | "inside-source";

export type FileDragData = {
  accountId?: string;
  entries?: Entry[];
  kind: "file-entry";
  pane: PaneKey;
  rootId: string;
  parentPath: string;
  entry: Entry;
};

export type FileDragSource = {
  accountId?: string;
  pane: PaneKey;
  rootId: string;
  parentPath: string;
  entries: Entry[];
};

export type FileDropData = {
  accountId?: string;
  ancestorIds?: string[];
  provider?: "cloud115";
  id: string;
  kind: "directory" | "current-directory";
  pane: PaneKey;
  rootId: string;
  path: string;
  label: string;
  layer?: number;
  windowId?: string;
};

export type FileDropFeedback = {
  transfer?: "upload" | "download";
  target: FileDropData;
  operation: DragOperation;
  valid: boolean;
  reason?: InvalidDropReason;
};

export function fileDragId(pane: PaneKey, path: string) {
  return `drag:${pane}:${encodeURIComponent(path)}`;
}

export function paneDropId(pane: PaneKey) {
  return `drop:${pane}:current-directory`;
}

export function directoryDropId(pane: PaneKey, path: string) {
  return `drop:${pane}:directory:${encodeURIComponent(path)}`;
}

export function buildFileDragSource(
  data: FileDragData,
  selectedPaths: ReadonlySet<string>,
  visibleEntries: readonly Entry[],
): FileDragSource {
  const entries = selectedPaths.has(data.entry.relativePath)
    ? visibleEntries.filter((entry) => selectedPaths.has(entry.relativePath))
    : [data.entry];
  return { pane: data.pane, rootId: data.rootId, parentPath: data.parentPath, entries, ...(data.accountId ? { accountId: data.accountId } : {}) };
}

export function defaultDragOperation(source: FileDragSource, target: FileDropData): DragOperation {
  return source.rootId === target.rootId ? "move" : "copy";
}

export function validateFileDrop(
  source: FileDragSource,
  target: FileDropData,
): { valid: true } | { valid: false; reason: InvalidDropReason } {
  if (source.rootId !== target.rootId) return { valid: true };

  if (source.rootId === "@115") {
    if (source.accountId !== target.accountId) return { valid: false, reason: "inside-source" };
    if (source.parentPath === target.path) return { valid: false, reason: "same-directory" };
    const inside = source.entries.some((entry) => entry.type === "directory" && (entry.relativePath === target.path || target.ancestorIds?.includes(entry.relativePath)));
    return inside ? { valid: false, reason: "inside-source" } : { valid: true };
  }

  if (normalizeRelativePath(source.parentPath) === normalizeRelativePath(target.path)) {
    return { valid: false, reason: "same-directory" };
  }

  const targetPath = normalizeRelativePath(target.path);
  const insideSource = source.entries.some(
    (entry) => entry.type === "directory" && isSameOrDescendant(targetPath, normalizeRelativePath(entry.relativePath)),
  );
  return insideSource ? { valid: false, reason: "inside-source" } : { valid: true };
}

export function buildFileDropFeedback(source: FileDragSource, target: FileDropData): FileDropFeedback {
  const validation = validateFileDrop(source, target);
  return {
    target,
    operation: defaultDragOperation(source, target),
    valid: validation.valid,
    reason: validation.valid ? undefined : validation.reason,
    ...(source.rootId === "@115" && target.rootId !== "@115" ? { transfer: "download" as const } : source.rootId !== "@115" && target.rootId === "@115" ? { transfer: "upload" as const } : {}),
  };
}

export function buildDragRequest(source: FileDragSource, target: FileDropData): OpsRequest {
  return {
    type: defaultDragOperation(source, target),
    ...(source.accountId || target.accountId ? { accountId: source.accountId ?? target.accountId, sourceAccountId: source.accountId, destAccountId: target.accountId } : {}),
    sourceRoot: source.rootId,
    sources: source.entries.map((entry) => entry.relativePath),
    destRoot: target.rootId,
    destPath: target.path,
  };
}

export function isFileDragData(value: unknown): value is FileDragData {
  return Boolean(value && typeof value === "object" && (value as { kind?: unknown }).kind === "file-entry");
}

export function isFileDropData(value: unknown): value is FileDropData {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "directory" || kind === "current-directory";
}

function normalizeRelativePath(path: string) {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/") || ".";
}

function isSameOrDescendant(candidate: string, parent: string) {
  return candidate === parent || (parent !== "." && candidate.startsWith(`${parent}/`));
}
