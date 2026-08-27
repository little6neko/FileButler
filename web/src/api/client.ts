import type {
  Entry,
  OpsRequest,
  PlanItem,
  RenameRequest,
  Root,
  SingleRenameRequest,
  SuperRenameCreateJobRequest,
  SuperRenameInventory,
  SuperRenamePreviewRequest,
  TextDocument,
  TextSaveRequest,
  TextSaveResult,
} from "./types";

export class APIError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = body.error ?? { code: "http_error", message: res.statusText };
    throw new APIError(error.code, error.message, res.status);
  }
  return body.data as T;
}

export const api = {
  initStatus: () => request<{ needsInitialization: boolean }>("/api/init/status"),
  createAdmin: (username: string, password: string) =>
    request<{ id: number; username: string }>("/api/init/admin", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    request<{ id: number; username: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  me: () => request<{ id: number; username: string }>("/api/auth/me"),
  roots: () => request<Root[]>("/api/roots"),
  browse: (rootId: string, path: string) =>
    request<Entry[]>(
      `/api/browse?rootId=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`,
    ),
  mediaUrl: (rootId: string, path: string) =>
    `/api/media?rootId=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`,
  textRead: (rootId: string, path: string) =>
    request<TextDocument>(
      `/api/text?rootId=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`,
    ),
  textSave: (payload: TextSaveRequest) =>
    request<TextSaveResult>("/api/text", { method: "PUT", body: JSON.stringify(payload) }),
  opsDryRun: (payload: OpsRequest) =>
    request<{ items: PlanItem[]; hasConflict: boolean }>("/api/ops/dry-run", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  opsCreateJob: (payload: OpsRequest) =>
    request<{ id: string }>("/api/ops/jobs", { method: "POST", body: JSON.stringify(payload) }),
  renamePreview: (payload: RenameRequest) =>
    request<{ items: PlanItem[]; hasConflict: boolean }>("/api/rename/preview", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  renameCreateJob: (payload: RenameRequest) =>
    request<{ id: string }>("/api/rename/jobs", { method: "POST", body: JSON.stringify(payload) }),
  singleRenameCreateJob: (payload: SingleRenameRequest) =>
    request<{ id: string }>("/api/rename/single/jobs", { method: "POST", body: JSON.stringify(payload) }),
  superRenamePreview: (payload: SuperRenamePreviewRequest) =>
    request<SuperRenameInventory>("/api/super-rename/preview", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  superRenameCreateJob: (payload: SuperRenameCreateJobRequest) =>
    request<{ id: string }>("/api/super-rename/jobs", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  cancelJob: (id: string) =>
    request<{ id: string }>(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
};
