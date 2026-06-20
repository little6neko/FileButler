import type { Entry, Job, OpsRequest, PlanItem, RenameRequest, Root } from "./types";

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
  jobs: () => request<Job[]>("/api/jobs"),
  job: (id: string) => request<Job & { items: PlanItem[] }>(`/api/jobs/${encodeURIComponent(id)}`),
  cancelJob: (id: string) =>
    request<{ id: string }>(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
};
