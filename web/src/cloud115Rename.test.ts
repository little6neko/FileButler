import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloudCall } from "./cloud115";
import { cloudPowerRenameClient, cloudSuperRenameClient } from "./cloud115Rename";
import { defaultRenameOptions } from "./components/powerRenameOptions";
import type { SuperRenameInventoryGroup } from "./api/types";
import { clearAppClipboard, setAppClipboard, useAppClipboard } from "./appClipboard";
import { renderHook, act } from "@testing-library/react";

vi.mock("./cloud115", () => ({ cloudCall: vi.fn() }));
const call = vi.mocked(cloudCall);
beforeEach(() => { vi.clearAllMocks(); setAppClipboard(null); });

describe("cloud batch adapters", () => {
  it("submits the exact preview token, not regenerated names; disables metadata", async () => {
    const client = cloudPowerRenameClient("10", "7");
    const request = { rootId: "@115", paths: ["12"], options: { ...defaultRenameOptions, readMetadata: true } };
    call.mockResolvedValueOnce({ items: [], hasConflict: false, previewToken: "frozen-plan" }).mockResolvedValueOnce({ id: "job" });
    await client.renamePreview(request);
    expect(call).toHaveBeenNthCalledWith(1, "power.preview", { accountId: "7", parentId: "10", ids: ["12"], options: { ...request.options, readMetadata: false } });
    await expect(client.renameCreateJob(request)).resolves.toEqual({ id: "job" });
    expect(call).toHaveBeenLastCalledWith("power.submit", { accountId: "7", parentId: "10", previewToken: "frozen-plan" });
    await expect(client.renameCreateJob(request)).rejects.toThrow();
  });

  it("cannot submit changed options or a pending preview", async () => {
    const client = cloudPowerRenameClient("0", "7");
    const request = { rootId: "@115", paths: ["1"], options: defaultRenameOptions };
    await expect(client.renameCreateJob(request)).rejects.toThrow();
    call.mockResolvedValue({ items: [], hasConflict: false, previewToken: "old" });
    await client.renamePreview(request);
    await expect(client.renameCreateJob({ ...request, options: { ...defaultRenameOptions, search: "changed" } })).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("retains independent revisions for deep and sibling SuperRename groups", async () => {
    const client = cloudSuperRenameClient("10", "7");
    call.mockResolvedValueOnce({ groups: [{ path: "A" }, { path: "B" }], revision: "root" });
    await client.superRenamePreview({ rootId: "@115", directoryPath: "." });
    call.mockResolvedValueOnce({ path: "A/nested", revision: "child" } as SuperRenameInventoryGroup & { revision: string });
    await client.superRenameGroupPreview({ rootId: "@115", directoryPath: ".", groupPath: "A/nested" });
    call.mockResolvedValueOnce({ id: "job" });
    await client.superRenameCreateJob({ rootId: "@115", directoryPath: ".", selectedPaths: ["A/nested/a.jpg"] });
    expect(call).toHaveBeenLastCalledWith("super.submit", { accountId: "7", parentId: "10", paths: ["A/nested/a.jpg"], revisions: { "A/nested": "child" } });
    call.mockResolvedValueOnce({ id: "next" });
    await client.superRenameCreateJob({ rootId: "@115", directoryPath: ".", selectedPaths: ["B/b.jpg"] });
    expect(call).toHaveBeenLastCalledWith("super.submit", { accountId: "7", parentId: "10", paths: ["B/b.jpg"], revisions: { B: "root" } });
  });

  it("a pending cut cannot clear newer clipboard contents from another window", () => {
    const old = { accountId: "7", operation: "move" as const, paths: ["1"], sourceRootId: "@115", sourceParentPath: "0", entries: [], createdAt: 1 };
    const next = { ...old, paths: ["2"] };
    setAppClipboard(old);
    const hook = renderHook(useAppClipboard);
    act(() => { setAppClipboard(next); clearAppClipboard(old); });
    expect(hook.result.current).toBe(next);
    act(() => clearAppClipboard(next));
    expect(hook.result.current).toBeNull();
  });
});
