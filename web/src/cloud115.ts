import { APIError } from "./api/client";
import type { RenameOptions } from "./api/types";

export type CloudEntry = { id: string; parentId: string; name: string; isDirectory: boolean; size: number; modifiedUnix?: number };
export type CloudLocation = { id: string; name: string }[];
export type CloudPage = { entries: CloudEntry[]; total: number; offset: number };
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
  const response = await fetch(`/api/cloud115/${method}`, { method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params), signal });
  const body = await response.json();
  if (!response.ok) throw new APIError(body.error?.code ?? "cloud115_error", body.error?.message ?? response.statusText, response.status);
  return body.data as T;
}
