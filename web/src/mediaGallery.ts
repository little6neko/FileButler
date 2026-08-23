import type { Entry } from "./api/types";
import { mediaKindForPath, type MediaKind } from "./media";

export type MediaDirection = "previous" | "next";

export type MediaGalleryItem = {
  name: string;
  relativePath: string;
  kind: MediaKind;
};

export type MediaGallerySnapshot = {
  rootId: string;
  items: MediaGalleryItem[];
  index: number;
};

export function createMediaGallerySnapshot(
  rootId: string,
  directoryPath: string,
  entries: readonly Entry[],
  visibleOrder: readonly string[],
  currentPath: string,
): MediaGallerySnapshot | null {
  const entriesByPath = new Map(entries.map((entry) => [entry.relativePath, entry]));
  const orderedEntries: Entry[] = [];
  const seen = new Set<string>();

  for (const path of visibleOrder) {
    const entry = entriesByPath.get(path);
    if (!entry || seen.has(path)) continue;
    seen.add(path);
    orderedEntries.push(entry);
  }
  for (const entry of entries) {
    if (seen.has(entry.relativePath)) continue;
    seen.add(entry.relativePath);
    orderedEntries.push(entry);
  }

  const items = orderedEntries.flatMap<MediaGalleryItem>((entry) => {
    if (entry.type === "directory" || !isImmediateChild(entry.relativePath, directoryPath)) return [];
    const kind = mediaKindForPath(entry.name);
    return kind ? [{ name: entry.name, relativePath: entry.relativePath, kind }] : [];
  });
  const index = items.findIndex((item) => item.relativePath === currentPath);
  return index < 0 ? null : { rootId, items, index };
}

export function currentMediaItem(snapshot: MediaGallerySnapshot): MediaGalleryItem | null {
  return snapshot.items[snapshot.index] ?? null;
}

export function canMoveMedia(snapshot: MediaGallerySnapshot, direction: MediaDirection): boolean {
  return direction === "previous"
    ? snapshot.index > 0
    : snapshot.index < snapshot.items.length - 1;
}

export function moveMedia<T extends MediaGallerySnapshot>(snapshot: T, direction: MediaDirection): T {
  if (!canMoveMedia(snapshot, direction)) return snapshot;
  return { ...snapshot, index: snapshot.index + (direction === "previous" ? -1 : 1) };
}

function isImmediateChild(relativePath: string, directoryPath: string): boolean {
  const normalizedPath = normalizePath(relativePath);
  const normalizedDirectory = normalizePath(directoryPath);
  const separator = normalizedPath.lastIndexOf("/");
  const parent = separator < 0 ? "" : normalizedPath.slice(0, separator);
  return parent === normalizedDirectory;
}

function normalizePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  return normalized === "." ? "" : normalized;
}
