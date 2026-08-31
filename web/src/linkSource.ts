import type { Entry, LinkRequest, LinkType } from "./api/types";

export type LinkSource = {
  sourceRootId: string;
  sourceParentPath: string;
  paths: string[];
  entries: Entry[];
  createdAt: number;
};

export type LinkTarget = {
  rootId: string;
  path: string;
};

export type LinkTargetContext =
  | { kind: "directory"; rootId: string; path: string; entry?: Pick<Entry, "relativePath" | "type"> }
  | { kind: "virtual-root"; rootId: string };

export function createLinkSource(
  sourceRootId: string,
  sourceParentPath: string,
  entries: readonly Entry[],
  createdAt = Date.now(),
): LinkSource | null {
  if (!sourceRootId || entries.length === 0) return null;
  const parentPath = normalizeRelativePath(sourceParentPath);
  const paths = entries.map((entry) => normalizeRelativePath(entry.relativePath));
  if (new Set(paths).size !== paths.length || paths.some((path) => parentOf(path) !== parentPath)) {
    return null;
  }
  return {
    sourceRootId,
    sourceParentPath: parentPath,
    paths,
    entries: entries.map(cloneEntry),
    createdAt,
  };
}

export function isLinkSourceEntry(
  source: LinkSource | null,
  rootId: string,
  relativePath: string,
) {
  return source?.sourceRootId === rootId
    && source.paths.includes(normalizeRelativePath(relativePath));
}

export function buildLinkRequest(
  type: LinkType,
  sourceRoot: string,
  sources: readonly string[],
  target: LinkTarget,
): LinkRequest {
  return {
    type,
    sourceRoot,
    sources: sources.map(normalizeRelativePath),
    destRoot: target.rootId,
    destPath: normalizeRelativePath(target.path),
  };
}

export function buildLinkSourceRequest(
  source: LinkSource,
  target: LinkTarget,
  type: LinkType,
) {
  return buildLinkRequest(type, source.sourceRootId, source.paths, target);
}

export function resolveLinkTarget(context: LinkTargetContext): LinkTarget | null {
  if (!context.rootId) return null;
  if (context.kind === "virtual-root") {
    return { rootId: context.rootId, path: "." };
  }
  return {
    rootId: context.rootId,
    path: context.entry?.type === "directory"
      ? normalizeRelativePath(context.entry.relativePath)
      : normalizeRelativePath(context.path),
  };
}

function cloneEntry(entry: Entry): Entry {
  return {
    ...entry,
    symlinkResolution: entry.symlinkResolution
      ? { ...entry.symlinkResolution }
      : undefined,
  };
}

function normalizeRelativePath(value: string) {
  const parts: string[] = [];
  for (const part of value.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts.at(-1) !== "..") {
        parts.pop();
      } else {
        parts.push(part);
      }
      continue;
    }
    parts.push(part);
  }
  return parts.join("/") || ".";
}

function parentOf(value: string) {
  if (value === ".") return ".";
  const separator = value.lastIndexOf("/");
  return separator < 0 ? "." : value.slice(0, separator) || ".";
}
