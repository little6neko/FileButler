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

  it("loads a nested directory on expansion without selecting its direct media", async () => {
    const inventory = makeInventory([
      group("albums/A", ["parent.jpg"], [], [], ["chapter"]),
    ]);
    const nested = group("albums/A/chapter", ["page.jpg"], ["clip.mp4"], [], ["deeper"]);
    const groupPreview = vi.fn().mockResolvedValue(nested);
    const manager = new SuperRenameManager("media", "albums", {
      superRenamePreview: vi.fn().mockResolvedValue(inventory),
      superRenameGroupPreview: groupPreview,
      superRenameCreateJob: vi.fn(),
    });
    await manager.load();

    expect(manager.getSnapshot().directoryNodes["albums/A/chapter"]).toMatchObject({
      loadState: "unloaded",
      selectionIntent: "none",
      depth: 1,
    });
    await manager.setGroupExpanded("albums/A/chapter", true);

    expect(groupPreview).toHaveBeenCalledWith({
      rootId: "media",
      directoryPath: "albums",
      groupPath: "albums/A/chapter",
    });
    expect(manager.getSnapshot().projection?.groups.find((item) => item.path === "albums/A/chapter")?.selectionState).toBe("none");
    expect(manager.getSnapshot().selectedPaths.has("albums/A/chapter/page.jpg")).toBe(false);
    expect(manager.getSnapshot().directoryNodes["albums/A/chapter/deeper"]).toMatchObject({
      loadState: "unloaded",
      selectionIntent: "none",
      depth: 2,
    });
  });

  it("deduplicates expansion and selection loads and selects only the requested layer", async () => {
    const inventory = makeInventory([group("albums/A", [], [], [], ["chapter"])]);
    const nested = deferred<SuperRenameInventoryGroup>();
    const groupPreview = vi.fn().mockReturnValue(nested.promise);
    const manager = new SuperRenameManager("media", "albums", {
      superRenamePreview: vi.fn().mockResolvedValue(inventory),
      superRenameGroupPreview: groupPreview,
      superRenameCreateJob: vi.fn(),
    });
    await manager.load();

    const expansion = manager.setGroupExpanded("albums/A/chapter", true);
    const selection = manager.setGroupSelected("albums/A/chapter", true);
    nested.resolve(group("albums/A/chapter", ["page.jpg"], ["clip.mp4"], [], ["deeper"]));
    await Promise.all([expansion, selection]);

    expect(groupPreview).toHaveBeenCalledTimes(1);
    expect([...manager.getSnapshot().selectedPaths]).toEqual([
      "albums/A/chapter/page.jpg",
      "albums/A/chapter/clip.mp4",
    ]);
    expect(manager.getSnapshot().directoryNodes["albums/A/chapter/deeper"].selectionIntent).toBe("none");
  });

  it("keeps parent and nested selections independent", async () => {
    const inventory = makeInventory([
      group("albums/A", ["parent.jpg"], [], [], ["chapter"]),
    ]);
    const manager = new SuperRenameManager("media", "albums", {
      superRenamePreview: vi.fn().mockResolvedValue(inventory),
      superRenameGroupPreview: vi.fn().mockResolvedValue(group("albums/A/chapter", ["page.jpg"], [])),
      superRenameCreateJob: vi.fn(),
    });
    await manager.load();
    await manager.setGroupSelected("albums/A/chapter", true);

    await manager.setGroupSelected("albums/A", false);

    expect(manager.getSnapshot().selectedPaths.has("albums/A/parent.jpg")).toBe(false);
    expect(manager.getSnapshot().selectedPaths.has("albums/A/chapter/page.jpg")).toBe(true);
    expect(manager.getSnapshot().directoryNodes["albums/A"].selectionIntent).toBe("none");
    expect(manager.getSnapshot().directoryNodes["albums/A/chapter"].selectionIntent).toBe("all");
  });

  it("retries a failed nested load from the directory checkbox", async () => {
    const inventory = makeInventory([group("albums/A", [], [], [], ["chapter"])]);
    const groupPreview = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(group("albums/A/chapter", ["page.jpg"], []));
    const manager = new SuperRenameManager("media", "albums", {
      superRenamePreview: vi.fn().mockResolvedValue(inventory),
      superRenameGroupPreview: groupPreview,
      superRenameCreateJob: vi.fn(),
    });
    await manager.load();

    await manager.setGroupExpanded("albums/A/chapter", true);
    expect(manager.getSnapshot().directoryNodes["albums/A/chapter"]).toMatchObject({
      loadState: "failed",
      error: "offline",
    });

    await manager.setGroupSelected("albums/A/chapter", true);
    expect(groupPreview).toHaveBeenCalledTimes(2);
    expect(manager.getSnapshot().directoryNodes["albums/A/chapter"].loadState).toBe("loaded");
    expect(manager.getSnapshot().selectedPaths.has("albums/A/chapter/page.jpg")).toBe(true);
  });

  it("refreshes loaded nested groups but does not scan untouched siblings", async () => {
    const inventory = makeInventory([
      group("albums/A", [], [], [], ["chapter", "untouched"]),
    ]);
    const firstNested = group("albums/A/chapter", ["old.jpg"], []);
    const refreshedNested = group("albums/A/chapter", ["new.jpg"], []);
    const preview = vi.fn().mockResolvedValue(inventory);
    const groupPreview = vi.fn()
      .mockResolvedValueOnce(firstNested)
      .mockResolvedValueOnce(refreshedNested);
    const manager = new SuperRenameManager("media", "albums", {
      superRenamePreview: preview,
      superRenameGroupPreview: groupPreview,
      superRenameCreateJob: vi.fn(),
    });
    await manager.load();
    await manager.setGroupExpanded("albums/A/chapter", true);

    await manager.refresh();

    expect(groupPreview).toHaveBeenCalledTimes(2);
    expect(groupPreview.mock.calls.every(([request]) => request.groupPath === "albums/A/chapter")).toBe(true);
    expect(manager.getSnapshot().projection?.groups.find((item) => item.path === "albums/A/chapter")?.images[0].name).toBe("new.jpg");
    expect(manager.getSnapshot().directoryNodes["albums/A/untouched"].loadState).toBe("unloaded");
  });

  it("allows a fresh nested load after refresh invalidates an older request", async () => {
    const inventory = makeInventory([group("albums/A", [], [], [], ["chapter"])]);
    const oldLoad = deferred<SuperRenameInventoryGroup>();
    const nested = group("albums/A/chapter", ["page.jpg"], []);
    const groupPreview = vi.fn()
      .mockReturnValueOnce(oldLoad.promise)
      .mockResolvedValueOnce(nested);
    const manager = new SuperRenameManager("media", "albums", {
      superRenamePreview: vi.fn().mockResolvedValue(inventory),
      superRenameGroupPreview: groupPreview,
      superRenameCreateJob: vi.fn(),
    });
    await manager.load();
    const staleLoad = manager.setGroupExpanded("albums/A/chapter", true);

    await manager.refresh();
    await manager.setGroupSelected("albums/A/chapter", true);
    oldLoad.resolve(group("albums/A/chapter", ["stale.jpg"], []));
    await staleLoad;

    expect(groupPreview).toHaveBeenCalledTimes(2);
    expect(manager.getSnapshot().projection?.groups.find((item) => item.path === "albums/A/chapter")?.images[0].name).toBe("page.jpg");
    expect(manager.getSnapshot().selectedPaths.has("albums/A/chapter/page.jpg")).toBe(true);
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

  it("preserves custom choices without selecting new media on refresh", async () => {
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
    expect([...snapshot.selectedPaths]).toEqual(["albums/B/new.mp4"]);
    expect([...snapshot.expandedGroups]).toEqual(["albums/B"]);
    expect(snapshot.projection?.summary.selectedCount).toBe(1);
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
      superRenameGroupPreview: vi.fn(),
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
      superRenameGroupPreview: vi.fn(),
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

  it("includes selected loaded nested groups in the bulk request in tree order", async () => {
    const inventory = makeInventory([
      group("albums/A", ["parent.jpg"], [], [], ["chapter"]),
    ]);
    const create = vi.fn().mockResolvedValue({ id: "job-all" });
    const manager = new SuperRenameManager("media", "albums", {
      superRenamePreview: vi.fn().mockResolvedValue(inventory),
      superRenameGroupPreview: vi.fn().mockResolvedValue(group("albums/A/chapter", ["page.jpg"], [])),
      superRenameCreateJob: create,
    });
    await manager.load();
    await manager.setGroupSelected("albums/A/chapter", true);

    await manager.submit();

    expect(create).toHaveBeenCalledWith({
      rootId: "media",
      directoryPath: "albums",
      selectedPaths: ["albums/A/parent.jpg", "albums/A/chapter/page.jpg"],
    });
  });

  it("submits one group, locks only that group, and removes it after job creation", async () => {
    const inventory = makeInventory([
      group("albums/A", ["a.jpg", "b.jpg"], ["clip.mp4"]),
      group("albums/B", ["other.jpg"], []),
    ]);
    const submission = deferred<{ id: string }>();
    const create = vi.fn().mockReturnValue(submission.promise);
    const client: SuperRenameClient = {
      superRenamePreview: vi.fn().mockResolvedValue(inventory),
      superRenameGroupPreview: vi.fn(),
      superRenameCreateJob: create,
    };
    const manager = new SuperRenameManager("media", "albums", client);
    await manager.load();
    manager.setItemSelected("albums/A/a.jpg", false);

    const first = manager.submitGroup("albums/A");
    const second = manager.submitGroup("albums/A");

    expect(first).toBe(second);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      rootId: "media",
      directoryPath: "albums",
      selectedPaths: ["albums/A/b.jpg", "albums/A/clip.mp4"],
    });
    expect([...manager.getSnapshot().submittingGroups]).toEqual(["albums/A"]);

    manager.setItemSelected("albums/B/other.jpg", false);
    expect(manager.getSnapshot().selectedPaths.has("albums/B/other.jpg")).toBe(false);

    submission.resolve({ id: "job-a" });
    await expect(first).resolves.toBe("job-a");
    expect(manager.getSnapshot().projection?.groups.map((item) => item.path)).toEqual(["albums/B"]);
    expect(manager.getSnapshot().projection?.summary).toMatchObject({
      groupCount: 1,
      selectedCount: 0,
    });
    expect(manager.getSnapshot().submittingGroups.size).toBe(0);
  });

  it("keeps a completed parent as structure until its selected descendant also completes", async () => {
    const inventory = makeInventory([
      group("albums/A", ["parent.jpg"], [], [], ["chapter"]),
    ]);
    const nested = group("albums/A/chapter", ["page.jpg"], []);
    const create = vi.fn()
      .mockResolvedValueOnce({ id: "job-parent" })
      .mockResolvedValueOnce({ id: "job-child" });
    const manager = new SuperRenameManager("media", "albums", {
      superRenamePreview: vi.fn().mockResolvedValue(inventory),
      superRenameGroupPreview: vi.fn().mockResolvedValue(nested),
      superRenameCreateJob: create,
    });
    await manager.load();
    await manager.setGroupSelected("albums/A/chapter", true);

    await manager.submitGroup("albums/A");

    expect(manager.getSnapshot().directoryNodes["albums/A"]).toMatchObject({
      ownLayerCompleted: true,
      hidden: false,
    });
    expect(manager.getSnapshot().projection?.groups.map((item) => item.path)).toEqual([
      "albums/A/chapter",
    ]);
    expect(manager.getSnapshot().projection?.summary.groupCount).toBe(2);

    await manager.submitGroup("albums/A/chapter");

    expect(manager.getSnapshot().directoryNodes["albums/A"]).toMatchObject({ hidden: true });
    expect(manager.getSnapshot().directoryNodes["albums/A/chapter"]).toMatchObject({ hidden: true });
    expect(manager.getSnapshot().projection?.summary.groupCount).toBe(0);
    expect(manager.getSnapshot().projection?.groups).toEqual([]);
  });

  it("keeps a submitted group hidden across refreshes after successful completion", async () => {
    const inventory = makeInventory([
      group("albums/A", ["a.jpg"], []),
      group("albums/B", ["b.jpg"], []),
    ]);
    const client: SuperRenameClient = {
      superRenamePreview: vi.fn().mockResolvedValue(inventory),
      superRenameGroupPreview: vi.fn(),
      superRenameCreateJob: vi.fn().mockResolvedValue({ id: "job-a" }),
    };
    const manager = new SuperRenameManager("media", "albums", client);
    await manager.load();

    await manager.submitGroup("albums/A");
    await manager.handleTerminalJobs([{ id: "job-a", status: "completed" }]);
    await manager.refresh();

    expect(manager.getSnapshot().projection?.groups.map((item) => item.path)).toEqual(["albums/B"]);
  });

  it("restores a submitted group from an authoritative preview when its job fails", async () => {
    const inventory = makeInventory([
      group("albums/A", ["a.jpg"], []),
      group("albums/B", ["b.jpg"], []),
    ]);
    const preview = vi.fn().mockResolvedValue(inventory);
    const groupPreview = vi.fn().mockResolvedValue(inventory.groups[0]);
    const client: SuperRenameClient = {
      superRenamePreview: preview,
      superRenameGroupPreview: groupPreview,
      superRenameCreateJob: vi.fn().mockResolvedValue({ id: "job-a" }),
    };
    const manager = new SuperRenameManager("media", "albums", client);
    await manager.load();
    await manager.submitGroup("albums/A");

    await manager.handleTerminalJobs([{ id: "job-a", status: "failed" }]);

    expect(preview).toHaveBeenCalledTimes(1);
    expect(groupPreview).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot().projection?.groups.map((item) => item.path)).toEqual([
      "albums/A",
      "albums/B",
    ]);
  });

  it("keeps a group visible when its job cannot be created", async () => {
    const inventory = makeInventory([group("albums/A", ["a.jpg"], [])]);
    const manager = new SuperRenameManager("media", "albums", {
      superRenamePreview: vi.fn().mockResolvedValue(inventory),
      superRenameGroupPreview: vi.fn(),
      superRenameCreateJob: vi.fn().mockRejectedValue(new Error("offline")),
    });
    await manager.load();

    await expect(manager.submitGroup("albums/A")).resolves.toBeNull();

    expect(manager.getSnapshot().projection?.groups.map((item) => item.path)).toEqual(["albums/A"]);
    expect(manager.getSnapshot().submittingGroups.size).toBe(0);
    expect(manager.getSnapshot().error).toBe("offline");
  });

  it("refreshes a stale submission and requires explicit confirmation again", async () => {
    const first = makeInventory([group("albums/A", ["a.jpg"], [])]);
    const second = makeInventory([group("albums/A", ["a.jpg", "new.jpg"], [])]);
    const preview = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const client: SuperRenameClient = {
      superRenamePreview: preview,
      superRenameGroupPreview: vi.fn(),
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
  childNames: string[] = [],
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
    childDirectories: childNames.map((name) => ({ path: `${path}/${name}`, name })),
    directOccupiedPaths: [
      ...imageNames.map((name) => `${path}/${name}`),
      ...videoNames.map((name) => `${path}/${name}`),
      ...unmatchedNames.map((name) => `${path}/${name}`),
      ...childNames.map((name) => `${path}/${name}`),
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
    superRenameGroupPreview: vi.fn(),
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
