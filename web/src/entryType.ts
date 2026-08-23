import type { Entry } from "./api/types";

export type EntryTypeLabels = {
  entryFolderType: string;
  entryFileType: string;
  entrySymlinkType: string;
  entryOtherType: string;
};

export function entryTypeLabel(
  entry: Pick<Entry, "name" | "type">,
  labels: EntryTypeLabels,
): string {
  switch (entry.type) {
    case "directory":
      return labels.entryFolderType;
    case "file":
      return finalExtension(entry.name) ?? labels.entryFileType;
    case "symlink":
      return labels.entrySymlinkType;
    case "other":
      return labels.entryOtherType;
  }
}

function finalExtension(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  const extension = name.slice(dot + 1).trim();
  return extension ? extension.toLowerCase() : null;
}
