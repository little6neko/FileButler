import type {
  Entry,
  LinkJobRequest,
  LinkPreview,
  LinkRequest,
  OpsRequest,
  PlanItem,
  RenameRequest,
  Root,
  SingleRenameRequest,
  SuperRenameCreateJobRequest,
  SuperRenameGroupPreviewRequest,
  SuperRenameInventory,
  SuperRenameInventoryGroup,
  SuperRenamePreviewRequest,
  TextDocument,
  TextSaveRequest,
  TextSaveResult,
} from "./types";

export class APIError extends Error {
  code: string;
  status: number;
  data?: unknown;

  constructor(code: string, message: string, status: number, data?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
  errorDataGuard?: (value: unknown) => boolean,
): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = body.error ?? { code: "http_error", message: res.statusText };
    const data = errorDataGuard?.(body.data) ? body.data : undefined;
    throw new APIError(error.code, error.message, res.status, data);
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
  superRenameGroupPreview: (payload: SuperRenameGroupPreviewRequest) =>
    request<SuperRenameInventoryGroup>("/api/super-rename/group-preview", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  superRenameCreateJob: (payload: SuperRenameCreateJobRequest) =>
    request<{ id: string }>("/api/super-rename/jobs", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  linkPreview: (payload: LinkRequest) =>
    request<LinkPreview>("/api/links/preview", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  linkCreateJob: (payload: LinkJobRequest) =>
    request<{ id: string }>("/api/links/jobs", {
      method: "POST",
      body: JSON.stringify(payload),
    }, isLinkPreview),
  cancelJob: (id: string) =>
    request<{ id: string }>(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
};

export function isLinkPreview(value: unknown): value is LinkPreview {
  if (!isRecord(value)
    || !isLinkType(value.type)
    || typeof value.sourceRoot !== "string"
    || typeof value.destRoot !== "string"
    || typeof value.destPath !== "string"
    || typeof value.previewRevision !== "string"
    || !/^sha256:[0-9a-f]{64}$/.test(value.previewRevision)
    || !isNonnegativeInteger(value.progressTotal)
    || typeof value.hasConflict !== "boolean"
    || !Array.isArray(value.items)) {
    return false;
  }
  return value.items.every(isLinkPreviewItem);
}

function isLinkPreviewItem(value: unknown) {
  if (!isRecord(value)
    || typeof value.sourcePath !== "string"
    || typeof value.destPath !== "string"
    || !["file", "directory", "symlink", "other"].includes(String(value.sourceKind))
    || !isLinkCounts(value.counts)
    || typeof value.conflict !== "boolean") {
    return false;
  }
  if (value.errorCode !== undefined && !isLinkErrorCode(value.errorCode)) return false;
  return value.errorText === undefined || typeof value.errorText === "string";
}

function isLinkCounts(value: unknown) {
  return isRecord(value)
    && isNonnegativeInteger(value.directories)
    && isNonnegativeInteger(value.files)
    && isNonnegativeInteger(value.symlinks);
}

function isLinkType(value: unknown) {
  return value === "hardlink" || value === "symlink";
}

function isLinkErrorCode(value: unknown) {
  return [
    "target_exists",
    "missing_source",
    "source_changed",
    "unsupported_source",
    "special_entry",
    "cross_filesystem",
    "destination_inside_source",
    "outside_root",
    "invalid_path",
    "operation_failed",
  ].includes(String(value));
}

function isNonnegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
