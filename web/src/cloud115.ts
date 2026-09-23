import { APIError } from "./api/client";

export type CloudEntry = { id: string; parentId: string; name: string; isDirectory: boolean; size: number };
export type CloudPage = { entries: CloudEntry[]; total: number; offset: number };
export type CloudRequest = { id?: string; ids?: string[]; parentId?: string; destId?: string; name?: string; password?: string; offset?: number; rootId?: string; path?: string; paths?: string[] };
export type CloudDrag = { kind: "cloud115-entry"; entries: CloudEntry[] };

export async function cloudCall<T>(method: string, params: CloudRequest = {}): Promise<T> {
  const response = await fetch(`/api/cloud115/${method}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) });
  const body = await response.json();
  if (!response.ok) throw new APIError(body.error?.code ?? "cloud115_error", body.error?.message ?? response.statusText, response.status);
  return body.data as T;
}
