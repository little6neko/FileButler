import { afterEach, expect, it, vi } from "vitest";
import { cloudCall, cloudDirectory, isCloudArchive } from "./cloud115";

afterEach(() => vi.unstubAllGlobals());
it("loads every page before returning a directory", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: { entries: [{ id: "1" }], total: 2, offset: 0 } }))).mockResolvedValueOnce(new Response(JSON.stringify({ data: { entries: [{ id: "2" }], total: 2, offset: 1 } })));
  vi.stubGlobal("fetch", fetchMock);
  expect(await cloudDirectory("0", "7")).toEqual([{ id: "1" }, { id: "2" }]);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ parentId: "0", accountId: "7", offset: 1 });
});
it("rejects incomplete directories rather than publishing a partial list", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { entries: [], total: 2, offset: 0 } }))));
  await expect(cloudDirectory("0", "7")).rejects.toThrow("不完整");
});
it("only enables extraction for recognized archive files", () => {
  const entry = { id: "1", parentId: "0", size: 1, name: "archive.ZIP", isDirectory: false };
  expect(isCloudArchive(entry)).toBe(true);
  expect(isCloudArchive({ ...entry, name: "photo.jpg" })).toBe(false);
  expect(isCloudArchive({ ...entry, isDirectory: true })).toBe(false);
});

it("preserves the original 115 business error without retrying submission", async () => {
  const message = "POST https://clouddownload.115.com/web/\n115 API unknown: 任务已存在，请勿输入重复的链接地址";
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "cloud115_error", message } }), { status: 422, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(cloudCall("offline.add", { url: "magnet:?xt=test" })).rejects.toMatchObject({ message, status: 422, code: "cloud115_error" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("describes a proxy HTML response instead of exposing a JSON parsing exception", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('<!DOCTYPE html><title>502: Bad gateway</title><script>secret()</script><body>Cookie=private</body>', { status: 502, statusText: "Bad Gateway", headers: { "Content-Type": "text/html; charset=UTF-8" } }));
  vi.stubGlobal("fetch", fetchMock);
  const error = await cloudCall("offline.add").catch(error => error);
  expect(error).toMatchObject({ status: 502, code: "http_error" });
  if (!(error instanceof Error)) throw new Error("expected an API error");
  expect(error.message).toContain("POST /api/cloud115/offline.add");
  expect(error.message).toContain("HTTP 502 Bad Gateway");
  expect(error.message).toContain("text/html");
  expect(error.message).toContain("502: Bad gateway");
  expect(error.message).not.toMatch(/Unexpected token|secret|private|<script>/);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([
  [200, "<html><title>Sign in</title></html>", "text/html"],
  [200, "null", "application/json"],
  [200, "{}", "application/json"],
  [502, "", "text/plain"],
  [504, "upstream timeout", "text/plain"],
  [502, '{"error":', "application/json"],
])("handles malformed or empty responses (%s, %s)", async (status, body, type) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status, headers: { "Content-Type": type } })));
  await expect(cloudCall("offline.add")).rejects.toMatchObject({ status, message: expect.stringContaining(`HTTP ${status}`) });
});

it("does not turn an aborted response read into an API error", async () => {
  const error = new DOMException("Canceled", "AbortError");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ text: () => Promise.reject(error) }));
  await expect(cloudCall("offline.add")).rejects.toBe(error);
});

it("redacts and bounds text error summaries", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream https://example.com/?token=private Cookie=private", { status: 502, headers: { "Content-Type": "text/plain" } })));
  await expect(cloudCall("offline.add")).rejects.toMatchObject({ message: expect.not.stringContaining("private") });
});
