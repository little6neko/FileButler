import { APIError } from "./api/client";
import type { RenameOptions } from "./api/types";

export type CloudEntry = { id: string; parentId: string; name: string; isDirectory: boolean; size: number; modifiedUnix?: number };
export type CloudLocation = { id: string; name: string }[];
export type CloudPage = { entries: CloudEntry[]; total: number; offset: number };
export type CloudOfflineQuota = { used: number; total: number; remaining: number };
export type CloudRequest = { accountId?: string; id?: string; ids?: string[]; parentId?: string; destId?: string; name?: string; password?: string; offset?: number; rootId?: string; path?: string; paths?: string[]; url?: string; options?: RenameOptions; previewToken?: string; revisions?: Record<string, string>; loginSession?: string };

export async function cloudDirectory(parentId: string, accountId: string, isCurrent: () => boolean = () => true): Promise<CloudEntry[]> {
  const entries: CloudEntry[] = [];
  const ids = new Set<string>();
  let total: number | undefined;
  do {
    const page = await cloudCall<CloudPage>("browse", { parentId, accountId, offset: entries.length });
    if (!isCurrent()) throw new Error("目录加载已取消");
    if (total !== undefined && total !== page.total) throw new Error("目录加载期间发生变化，请刷新");
    total = page.total;
    if (page.offset !== entries.length || (!page.entries.length && entries.length < total)) throw new Error("115返回不完整的目录列表，请刷新");
    for (const entry of page.entries) {
      if (ids.has(entry.id)) throw new Error("目录加载期间发生变化，请刷新");
      ids.add(entry.id);
      entries.push(entry);
    }
  } while (entries.length < total);
  return entries;
}

export function isCloudArchive(entry: CloudEntry | undefined) {
  return Boolean(entry && !entry.isDirectory && /\.(zip|rar|7z)$/i.test(entry.name));
}

export async function cloudCall<T>(method: string, params: CloudRequest & Partial<import("./api/types").OpsRequest> = {}, signal?: AbortSignal): Promise<T> {
  const path = `/api/cloud115/${method}`;
  const response = await fetch(path, { method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params), signal });
  const text = await response.text();
  let body: Record<string, unknown> | undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) body = value as Record<string, unknown>;
  } catch { /* Proxies may replace JSON errors with an HTML error page. */ }
  const error = body?.error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    throw new APIError("code" in error && typeof error.code === "string" ? error.code : "cloud115_error", error.message, response.status);
  }
  if (!response.ok || !body || !("data" in body)) {
    const type = response.headers.get("content-type") || "未知响应类型";
    const html = /text\/html/i.test(type) || /^\s*(?:<!doctype\s+html|<html\b)/i.test(text);
    // Extract a small, inert page title only; never render a proxy's HTML/body.
    const sample = text.slice(0, 16384);
    let heading = sample || "服务器返回了空响应";
    if (html) heading = sample.match(/<(title|h1)\b[^>]*>([\s\S]*?)<\/\1\s*>/i)?.[2] || "服务器返回了 HTML 页面，而非 JSON";
    else if (body || /json/i.test(type)) heading = "服务器返回了无效的 JSON 响应";
    const summary = heading.replace(/<[^>]*>/g, " ")
      .replace(/(?:https?:\/\/|magnet:|ed2k:|ftp:\/\/)[^\s<>"']+/gi, "[链接已省略]")
      .replace(/\b(?:cookie|authorization|uid|cid|seid|kid|token|password|sign|signature)\b["']?\s*[:=].*/gi, "[敏感信息已省略]")
      .replace(/\s+/g, " ").trim().slice(0, 300);
    throw new APIError(response.ok ? "invalid_response" : "http_error", `POST ${path}\nHTTP ${response.status} ${response.statusText}\n${type}\n${summary}`.trim(), response.status);
  }
  return body.data as T;
}
