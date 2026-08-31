import { afterEach, describe, expect, it, vi } from "vitest";
import { APIError, api, isLinkPreview } from "./client";
import type { LinkJobRequest, LinkPreview, LinkRequest, SuperRenameInventory, TextDocument, TextSaveRequest } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("text API client", () => {
  it("URL-encodes text read parameters and returns the document", async () => {
    const document: TextDocument = {
      content: "hello",
      encoding: "utf-8",
      lineEnding: "none",
      preferredLineEnding: "lf",
      byteSize: 5,
      revision: `sha256:${"a".repeat(64)}`,
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: document }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.textRead("my root", "folder/a+b?.txt")).resolves.toEqual(document);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/text?rootId=my%20root&path=folder%2Fa%2Bb%3F.txt",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("sends the complete text save request as PUT JSON", async () => {
    const payload: TextSaveRequest = {
      rootId: "data",
      path: "src/main.go",
      content: "package main\n",
      encoding: "utf-8",
      lineEnding: "lf",
      revision: `sha256:${"b".repeat(64)}`,
      force: false,
    };
    const result = { byteSize: 13, revision: `sha256:${"c".repeat(64)}` };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: result }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.textSave(payload)).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/text",
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        body: JSON.stringify(payload),
      }),
    );
  });

  it("preserves server status and error code for revision conflicts", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error: { code: "revision_conflict", message: "changed elsewhere" },
    }, 409));
    vi.stubGlobal("fetch", fetchMock);

    const request: TextSaveRequest = {
      rootId: "data",
      path: "notes.txt",
      content: "local",
      encoding: "utf-8",
      lineEnding: "lf",
      revision: `sha256:${"d".repeat(64)}`,
      force: false,
    };
    const error = await api.textSave(request).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(APIError);
    expect(error).toMatchObject({ status: 409, code: "revision_conflict", message: "changed elsewhere" });
  });
});

describe("SuperRename API client", () => {
  it("posts the current directory snapshot request and returns its inventory", async () => {
    const inventory: SuperRenameInventory = {
      rootId: "media",
      directoryPath: "albums/写真 A",
      generatedAtUnix: 1,
      groups: [],
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: inventory }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.superRenamePreview({
      rootId: "media",
      directoryPath: "albums/写真 A",
    })).resolves.toEqual(inventory);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/super-rename/preview",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ rootId: "media", directoryPath: "albums/写真 A" }),
      }),
    );
  });

  it("loads one nested group on demand", async () => {
    const group = {
      path: "albums/A/chapter",
      name: "chapter",
      images: [],
      videos: [],
      unmatched: [],
      childDirectories: [],
      directOccupiedPaths: [],
      videoDirectory: { status: "missing" as const, path: "albums/A/chapter/视频", occupiedPaths: [] },
      recoveryResidues: [],
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: group }));
    vi.stubGlobal("fetch", fetchMock);
    const payload = { rootId: "media", directoryPath: "albums", groupPath: "albums/A/chapter" };

    await expect(api.superRenameGroupPreview(payload)).resolves.toEqual(group);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/super-rename/group-preview",
      expect.objectContaining({ method: "POST", body: JSON.stringify(payload) }),
    );
  });

  it("submits only selected source paths and preserves stale-preview errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error: { code: "stale_preview", message: "refresh first" },
    }, 409));
    vi.stubGlobal("fetch", fetchMock);
    const payload = {
      rootId: "media",
      directoryPath: "albums",
      selectedPaths: ["albums/A/a.jpg"],
    };

    const error = await api.superRenameCreateJob(payload).catch((reason: unknown) => reason);
    expect(error).toMatchObject({ status: 409, code: "stale_preview" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/super-rename/jobs",
      expect.objectContaining({ method: "POST", body: JSON.stringify(payload) }),
    );
  });
});

describe("link API client", () => {
  const request: LinkRequest = {
    type: "hardlink",
    sourceRoot: "source",
    sources: ["写真 (A)/一.jpg"],
    destRoot: "destination",
    destPath: "archive",
  };

  it("posts link preview and job requests", async () => {
    const preview = linkPreview();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: preview }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "job_1" } }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.linkPreview(request)).resolves.toEqual(preview);
    const jobRequest: LinkJobRequest = { ...request, previewRevision: preview.previewRevision };
    await expect(api.linkCreateJob(jobRequest)).resolves.toEqual({ id: "job_1" });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/links/preview", expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify(request),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/links/jobs", expect.objectContaining({
      method: "POST",
      body: JSON.stringify(jobRequest),
    }));
  });

  it("keeps a valid latest preview on 409 errors", async () => {
    const preview = linkPreview({ hasConflict: true });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error: { code: "stale_preview", message: "changed" },
      data: preview,
    }, 409)));

    const error = await api.linkCreateJob({
      ...request,
      previewRevision: `sha256:${"b".repeat(64)}`,
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(APIError);
    expect(error).toMatchObject({ code: "stale_preview", status: 409, data: preview });
  });

  it("drops malformed error data without changing ordinary API errors", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error: { code: "plan_conflict", message: "conflict" },
      data: { previewRevision: "not-a-revision" },
    }, 409)));
    const error = await api.linkCreateJob({
      ...request,
      previewRevision: `sha256:${"b".repeat(64)}`,
    }).catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code: "plan_conflict", status: 409, data: undefined });
  });

  it("validates complete link previews at runtime", () => {
    expect(isLinkPreview(linkPreview())).toBe(true);
    expect(isLinkPreview({ ...linkPreview(), items: [{ conflict: false }] })).toBe(false);
  });
});

function linkPreview(overrides: Partial<LinkPreview> = {}): LinkPreview {
  return {
    type: "hardlink",
    sourceRoot: "source",
    destRoot: "destination",
    destPath: "archive",
    previewRevision: `sha256:${"a".repeat(64)}`,
    progressTotal: 1,
    hasConflict: false,
    items: [{
      sourcePath: "写真 (A)/一.jpg",
      destPath: "archive/一.jpg",
      sourceKind: "file",
      counts: { directories: 0, files: 1, symlinks: 0 },
      conflict: false,
    }],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
