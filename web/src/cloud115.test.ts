import { afterEach, expect, it, vi } from "vitest";
import { cloudDirectory, isCloudArchive } from "./cloud115";

afterEach(() => vi.unstubAllGlobals());
it("loads every page before returning a directory", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: { entries: [{ id: "1" }], total: 2, offset: 0 } }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ data: { entries: [{ id: "2" }], total: 2, offset: 1 } }) });
  vi.stubGlobal("fetch", fetchMock);
  expect(await cloudDirectory("0")).toEqual([{ id: "1" }, { id: "2" }]);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ parentId: "0", offset: 1 });
});
it("rejects incomplete directories rather than publishing a partial list", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { entries: [], total: 2, offset: 0 } }) }));
  await expect(cloudDirectory("0")).rejects.toThrow("不完整");
});
it("only enables extraction for recognized archive files", () => {
  const entry = { id: "1", parentId: "0", size: 1, name: "archive.ZIP", isDirectory: false };
  expect(isCloudArchive(entry)).toBe(true);
  expect(isCloudArchive({ ...entry, name: "photo.jpg" })).toBe(false);
  expect(isCloudArchive({ ...entry, isDirectory: true })).toBe(false);
});
