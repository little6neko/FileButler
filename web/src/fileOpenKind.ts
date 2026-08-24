import type { Entry } from "./api/types";
import { mediaKindForPath, type MediaKind } from "./media";
import { textFileDescriptor, type TextFileDescriptor } from "./textFiles";

export type FileOpenKind =
  | { kind: "directory" }
  | { kind: "media"; mediaKind: MediaKind }
  | { kind: "text"; text: TextFileDescriptor }
  | { kind: "unknown" };

export function fileOpenKind(entry: Pick<Entry, "name" | "type">): FileOpenKind {
  if (entry.type === "directory") return { kind: "directory" };
  if (entry.type !== "file" && entry.type !== "symlink") return { kind: "unknown" };

  const mediaKind = mediaKindForPath(entry.name);
  if (mediaKind) return { kind: "media", mediaKind };

  const text = textFileDescriptor(entry.name);
  if (text) return { kind: "text", text };
  return { kind: "unknown" };
}
