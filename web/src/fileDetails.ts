import type { Entry } from "./api/types";

export type DetailsTarget = { rootId: string; paths: string[]; accountId?: string; names: string[] };
export type DetailItem = { name: string; type: Entry["type"]; path: string; location: string; size: number; allocated: number | null; modifiedUnix: number | null; createdUnix: number | null; sha1: string; warning?: string };
export type DetailTotals = { size: number; allocated: number | null; files: number; folders: number };
export type DetailMedia = { width: number | null; height: number | null; duration: number | null };
export const detailChinese = {
  title: "详细信息", mixed: "多种类型", multipleLocations: "多个位置", resolution: "分辨率", duration: "时长", size: "大小", allocated: "占用空间", contains: "共包含", location: "位置", modified: "修改时间", created: "创建时间", copy: "复制原始路径", refresh: "重新获取", calculating: "计算中...", loading: "读取中...", bytes: "字节", copied: "路径已复制", files: "个文件", folders: "个文件夹", count: "项", etc: "等", accountChanged: "115账号已变化，请重新打开详细信息",
};
export type DetailsLabels = { [K in keyof typeof detailChinese]: string };
export const detailEnglish: DetailsLabels = {
  title: "Details", mixed: "Multiple types", multipleLocations: "Multiple locations", resolution: "Resolution", duration: "Duration", size: "Size", allocated: "Size on disk", contains: "Contains", location: "Location", modified: "Modified", created: "Created", copy: "Copy original path", refresh: "Refresh", calculating: "Calculating...", loading: "Loading...", bytes: "bytes", copied: "Path copied", files: " files", folders: " folders", count: "items", etc: "and others —", accountChanged: "115 account changed; reopen details",
};
export function detailsTitle(target: DetailsTarget, labels: DetailsLabels) {
  return target.names.length > 1 ? `${target.names[0]} ${labels.etc} ${target.names.length.toLocaleString("en-US")} ${labels.count}` : target.names[0];
}
export function detailSize(value: number | null | undefined, bytes: string) {
  if (value == null || !Number.isFinite(value)) return "--";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let scaled = value, index = 0;
  while (scaled >= 1024 && index < units.length - 1) { scaled /= 1024; index++; }
  return `${scaled.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${units[index]}（${value.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${bytes}）`;
}
export function detailDuration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "--";
  const n = Math.floor(seconds);
  return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map((part) => String(part).padStart(2, "0")).join(":");
}
export async function readDetails<T>(target: DetailsTarget, section: "basic" | "stats" | "media" | "hash", signal: AbortSignal): Promise<T> {
  const cloud = target.rootId === "@115";
  const response = await fetch(cloud ? `/api/cloud115/details.${section}` : `/api/details/${section}`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify(cloud ? { ids: target.paths, accountId: target.accountId } : { rootId: target.rootId, paths: target.paths }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || "读取详细信息失败");
  return body.data as T;
}
