import { afterEach, describe, expect, it, vi } from "vitest";
import { APIError, api } from "./client";
import type { SuperRenameInventory, TextDocument, TextSaveRequest } from "./types";

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
