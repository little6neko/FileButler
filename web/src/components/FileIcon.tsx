import { File, FileArchive, FileImage, FileText, FileVideo, FolderClosed, Link } from "lucide-react";
import type { Entry } from "../api/types";

export function FileIcon({ name, type }: Pick<Entry, "name" | "type">) {
  const kind = type === "directory" ? "directory" : "file";
  const props = { "aria-hidden": true, "data-testid": `file-icon-${kind}`, className: "size-3.5 shrink-0" } as const;
  if (type === "directory") return <FolderClosed {...props} />;
  if (type === "symlink") return <Link {...props} />;
  const extension = name.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(extension ?? "")) return <FileImage {...props} />;
  if (["mp4", "webm", "mov", "mkv"].includes(extension ?? "")) return <FileVideo {...props} />;
  if (["zip", "tar", "gz", "7z", "rar"].includes(extension ?? "")) return <FileArchive {...props} />;
  if (["txt", "md", "json", "yaml", "yml", "toml", "csv"].includes(extension ?? "")) return <FileText {...props} />;
  return <File {...props} />;
}
