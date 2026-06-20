export type MediaKind = "image" | "video";

const imageExtensions = new Set([".avif", ".bmp", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
const videoExtensions = new Set([".m4v", ".mkv", ".mov", ".mp4", ".ogg", ".ogv", ".webm"]);

export function mediaKindForPath(path: string): MediaKind | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = path.slice(dot).toLowerCase();
  if (imageExtensions.has(ext)) return "image";
  if (videoExtensions.has(ext)) return "video";
  return null;
}
