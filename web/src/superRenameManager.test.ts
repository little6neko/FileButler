import { describe, expect, it, vi } from "vitest";
import { APIError } from "./api/client";
import type { SuperRenameInventory, SuperRenameInventoryGroup } from "./api/types";
import { SuperRenameManager, type SuperRenameClient } from "./superRenameManager";

describe("SuperRenameManager", () => {
  it("loads with every matched file selected and only matched groups expanded", async () => {
    const inventory = makeInventory([
      group("albums/A", ["a.jpg"], ["clip.mp4"]),
      group("albums/B", [], [], ["notes.txt"]),
    ]);
    const client = clientWithPreviews(inventory);
    const manager = new SuperRenameManager("media", "albums", client);

    await manager.load();

    const snapshot = manager.getSnapshot();
    expect([...snapshot.selectedPaths]).toEqual(["albums/A/a.jpg", "albums/A/clip.mp4"]);
    expect([...snapshot.expandedGroups]).toEqual(["albums/A"]);
    expect(snapshot.projection?.groups.map((item) => item.selectionState)).toEqual(["all", "none"]);
    expect(snapshot.loading).toBe(false);
  });

  it("reprojects only the changed group and media partition", async () => {
    const inventory = makeInventory([
      group("albums/A", ["a.jpg", "b.jpg"], ["clip.mp4"]),
      group("albums/B", ["other.jpg"], []),
    ]);
    const manager = new SuperRenameManager("media", "albums", clientWithPreviews(inventory));
    await manager.load();
    const before = manager.getSnapshot().projection!;

    manager.setItemSelected("albums/A/a.jpg", false);

    const after = manager.getSnapshot().projection!;
    expect(after.groups[0]).not.toBe(before.groups[0]);
    expect(after.groups[0].images).not.toBe(before.groups[0].images);
    expect(after.groups[0].videos).toBe(before.groups[0].videos);
    expect(after.groups[1]).toBe(before.groups[1]);
    expect(after.groups[0].images.map((item) => item.targetPath)).toEqual(["", "albums/A/01.jpg"]);
    expect(after.groups[0].selectionState).toBe("some");
  });

  it("toggles a whole group without changing other group projections", async () => {
    const inventory = makeInventory([
      group("albums/A", ["a.jpg"], ["clip.mp4"]),
      group("albums/B", ["other.jpg"], []),
    ]);
    const manager = new SuperRenameManager("media", "albums", clientWithPreviews(inventory));
    await manager.load();
    const before = manager.getSnapshot().projection!;

    manager.setGroupSelected("albums/A", false);

    const after = manager.getSnapshot().projection!;
    expect(after.groups[0].selectionState).toBe("none");
    expect(after.groups[0].selectedCount).toBe(0);
    expect(after.groups[1]).toBe(before.groups[1]);
  });

  it("preserves existing choices and expansion while selecting newly discovered media", async () => {
    const first = makeInventory([group("albums/A", ["a.jpg", "b.jpg"], [])]);
    const second = makeInventory([
      group("albums/A", ["a.jpg", "c.jpg"], []),
      group("albums/B", [], ["new.mp4"]),
    ]);
    const client = clientWithPreviews(first, second);
    const manager = new SuperRenameManager("media", "albums", client);
    await manager.load();
    manager.setItemSelected("albums/A/a.jpg", false);
    manager.setGroupExpanded("albums/A", false);

    await manager.refresh();

    const snapshot = manager.getSnapshot();
    expect([...snapshot.selectedPaths]).toEqual(["albums/A/c.jpg", "albums/B/new.mp4"]);
    expect([...snapshot.expandedGroups]).toEqual(["albums/B"]);
    expect(snapshot.projection?.summary.selectedCount).toBe(2);
  });

  it("keeps the previous preview when refresh fails", async () => {
    const inventory = makeInventory([group("albums/A", ["a.jpg"], [])]);
    const client = clientWithPreviews(inventory, new Error("offline"));
    const manager = new SuperRenameManager("media", "albums", client);
    await manager.load();
    const before = manager.getSnapshot().projection;

    await manager.refresh();

    expect(manager.getSnapshot().projection).toBe(before);
    expect(manager.getSnapshot().error).toBe("offline");
  });

  it("ignores an older preview response that arrives last", async () => {
    const first = deferred<SuperRenameInventory>();
    const second = deferred<SuperRenameInventory>();
    const preview = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const client: SuperRenameClient = {
      superRenamePreview: preview,
      superRenameCreateJob: vi.fn(),
    };
    const manager = new SuperRenameManager("media", "albums", client);
    const firstLoad = manager.load();
    const secondLoad = manager.refresh();
    second.resolve(makeInventory([group("albums/new", ["new.jpg"], [])]));
    await secondLoad;
    first.resolve(makeInventory([group("albums/old", ["old.jpg"], [])]));
    await firstLoad;

    expect(manager.getSnapshot().inventory?.groups[0].path).toBe("albums/new");
  });

  it("locks concurrent submissions and sends source paths in inventory order", async () => {
    const inventory = makeInventory([group("albums/A", ["a.jpg", "b.jpg"], [])]);
    const submission = deferred<{ id: string }>();
    const create = vi.fn().mockReturnValue(submission.promise);
    const client: SuperRenameClient = {
      superRenamePreview: vi.fn().mockResolvedValue(inventory),
      superRenameCreateJob: create,
    };
    const manager = new SuperRenameManager("media", "albums", client);
    await manager.load();
    const first = manager.submit();
    const second = manager.submit();

    expect(first).toBe(second);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      rootId: "media",
      directoryPath: "albums",
      selectedPaths: ["albums/A/a.jpg", "albums/A/b.jpg"],
    });
    submission.resolve({ id: "job_1" });
    await expect(first).resolves.toBe("job_1");
    expect(manager.getSnapshot().submitting).toBe(false);
  });

  it("refreshes a stale submission and requires explicit confirmation again", async () => {
    const first = makeInventory([group("albums/A", ["a.jpg"], [])]);
    const second = makeInventory([group("albums/A", ["a.jpg", "new.jpg"], [])]);
    const preview = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const client: SuperRenameClient = {
      superRenamePreview: preview,
      superRenameCreateJob: vi.fn().mockRejectedValue(new APIError("stale_preview", "changed", 409)),
    };
    const manager = new SuperRenameManager("media", "albums", client);
    await manager.load();

    await expect(manager.submit()).resolves.toBeNull();

    const snapshot = manager.getSnapshot();
    expect(preview).toHaveBeenCalledTimes(2);
    expect(snapshot.confirmationRequired).toBe(true);
    expect(snapshot.error).toBe("changed");
    expect([...snapshot.selectedPaths]).toEqual(["albums/A/a.jpg", "albums/A/new.jpg"]);
  });
});

function makeInventory(groups: SuperRenameInventoryGroup[]): SuperRenameInventory {
  return { rootId: "media", directoryPath: "albums", generatedAtUnix: 1, groups };
}

function group(
  path: string,
  imageNames: string[],
  videoNames: string[],
  unmatchedNames: string[] = [],
): SuperRenameInventoryGroup {
  return {
    path,
    name: path.slice(path.lastIndexOf("/") + 1),
    images: imageNames.map((name) => ({
      sourcePath: `${path}/${name}`,
      name,
      extension: name.slice(name.lastIndexOf(".")),
      mediaKind: "image",
    })),
    videos: videoNames.map((name) => ({
      sourcePath: `${path}/${name}`,
      name,
      extension: name.slice(name.lastIndexOf(".")),
      mediaKind: "video",
    })),
    unmatched: unmatchedNames.map((name) => ({
      path: `${path}/${name}`,
      name,
      kind: "file",
      reason: "unsupported-extension",
    })),
    directOccupiedPaths: [
      ...imageNames.map((name) => `${path}/${name}`),
      ...videoNames.map((name) => `${path}/${name}`),
      ...unmatchedNames.map((name) => `${path}/${name}`),
    ],
    videoDirectory: { status: "missing", path: `${path}/视频`, occupiedPaths: [] },
    recoveryResidues: [],
  };
}

function clientWithPreviews(...responses: Array<SuperRenameInventory | Error>): SuperRenameClient {
  const preview = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) preview.mockRejectedValueOnce(response);
    else preview.mockResolvedValueOnce(response);
  }
  return {
    superRenamePreview: preview,
    superRenameCreateJob: vi.fn(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
