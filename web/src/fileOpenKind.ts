import type { Entry } from "./api/types";
import { mediaKindForPath, type MediaKind } from "./media";
import { textFileDescriptor, type TextFileDescriptor } from "./textFiles";

export type FileOpenKind =
  | { kind: "directory"; target?: FileOpenTarget }
  | { kind: "media"; mediaKind: MediaKind; target?: FileOpenTarget }
  | { kind: "text"; text: TextFileDescriptor; target?: FileOpenTarget }
  | { kind: "unknown" };

export type FileOpenTarget = {
  rootId: string;
  path: string;
};

export function fileOpenKind(entry: Pick<Entry, "name" | "type" | "symlinkResolution">): FileOpenKind {
  if (entry.type === "directory") return { kind: "directory" };
  if (entry.type === "file") return openRegularFile(entry.name);
  if (entry.type !== "symlink") return { kind: "unknown" };

  const resolution = entry.symlinkResolution;
  if (
    resolution?.state !== "mapped"
    || !resolution.targetRootId
    || resolution.targetPath === undefined
  ) return { kind: "unknown" };

  const target = { rootId: resolution.targetRootId, path: resolution.targetPath };
  if (resolution.targetKind === "directory") return { kind: "directory", target };
  if (resolution.targetKind !== "file") return { kind: "unknown" };
  return openRegularFile(resolution.targetPath, target);
}

function openRegularFile(path: string, target?: FileOpenTarget): FileOpenKind {
  const mediaKind = mediaKindForPath(path);
  if (mediaKind) return { kind: "media", mediaKind, ...(target ? { target } : {}) };

  const text = textFileDescriptor(path);
  if (text) return { kind: "text", text, ...(target ? { target } : {}) };
  return { kind: "unknown" };
}
