import { describe, expect, it, vi } from "vitest";
import { createFileSelectionStore } from "./fileSelectionStore";

const entries = [
  { name: "a.txt", relativePath: "a.txt", type: "file" as const, size: 10, mode: "", modifiedUnix: 0, isSymlink: false },
  { name: "b.txt", relativePath: "b.txt", type: "file" as const, size: 20, mode: "", modifiedUnix: 0, isSymlink: false },
  { name: "c.txt", relativePath: "c.txt", type: "file" as const, size: 30, mode: "", modifiedUnix: 0, isSymlink: false },
  { name: "d.txt", relativePath: "d.txt", type: "file" as const, size: 40, mode: "", modifiedUnix: 0, isSymlink: false },
];

describe("file selection store", () => {
  it("notifies only paths whose selected bit changed", () => {
    const store = createFileSelectionStore(entries);
    const listeners = Object.fromEntries(["a.txt", "b.txt", "c.txt"].map((path) => [path, vi.fn()]));
    const unsubscribe = Object.entries(listeners).map(([path, listener]) => store.subscribePath(path, listener));

    store.replace(["a.txt", "b.txt"]);
    expect(listeners["a.txt"]).toHaveBeenCalledTimes(1);
    expect(listeners["b.txt"]).toHaveBeenCalledTimes(1);
    expect(listeners["c.txt"]).not.toHaveBeenCalled();

    store.replace(["b.txt", "c.txt"]);
    expect(listeners["a.txt"]).toHaveBeenCalledTimes(2);
    expect(listeners["b.txt"]).toHaveBeenCalledTimes(1);
    expect(listeners["c.txt"]).toHaveBeenCalledTimes(1);

    unsubscribe.forEach((dispose) => dispose());
    store.clear();
    expect(listeners["b.txt"]).toHaveBeenCalledTimes(1);
    expect(listeners["c.txt"]).toHaveBeenCalledTimes(1);
  });

  it("preserves single, toggle, and Shift anchor behavior in visible order", () => {
    const store = createFileSelectionStore(entries);
    store.setVisibleOrder(["d.txt", "c.txt", "b.txt", "a.txt"]);

    store.select("c.txt", "range");
    expect(store.getOrderedPaths()).toEqual(["c.txt"]);
    expect(store.getAnchor()).toBe("c.txt");

    store.select("a.txt", "range");
    expect(store.getOrderedPaths()).toEqual(["c.txt", "b.txt", "a.txt"]);
    expect(store.getAnchor()).toBe("c.txt");

    store.select("d.txt", "toggle");
    expect(store.getOrderedPaths()).toEqual(["d.txt", "c.txt", "b.txt", "a.txt"]);
    expect(store.getAnchor()).toBe("d.txt");

    store.select("b.txt", "single");
    expect(store.getOrderedPaths()).toEqual(["b.txt"]);
    expect(store.getAnchor()).toBe("b.txt");
  });

  it("keeps a stable summary snapshot and updates count, bytes, and select-all together", () => {
    const store = createFileSelectionStore(entries.slice(0, 3));
    const listener = vi.fn();
    store.subscribeSummary(listener);
    const initial = store.getSummary();

    store.replace([]);
    expect(store.getSummary()).toBe(initial);
    expect(listener).not.toHaveBeenCalled();

    store.selectAll(true);
    expect(store.getSummary()).toEqual({ selectedCount: 3, selectedBytes: 60, allVisibleSelected: true });
    expect(listener).toHaveBeenCalledTimes(1);

    store.toggle("b.txt");
    expect(store.getSummary()).toEqual({ selectedCount: 2, selectedBytes: 40, allVisibleSelected: false });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("prunes removed paths and anchors while retaining updated byte totals", () => {
    const store = createFileSelectionStore(entries.slice(0, 3));
    const removedListener = vi.fn();
    store.subscribePath("a.txt", removedListener);
    store.select("a.txt", "single");
    store.toggle("b.txt");
    expect(store.getAnchor()).toBe("b.txt");

    store.setEntries([
      { ...entries[1], size: 25 },
      entries[2],
    ]);

    expect(store.getSelected()).toEqual(new Set(["b.txt"]));
    expect(store.getAnchor()).toBe("b.txt");
    expect(store.getSummary()).toEqual({ selectedCount: 1, selectedBytes: 25, allVisibleSelected: false });
    expect(removedListener).toHaveBeenCalledTimes(2);

    store.setEntries([entries[2]]);
    expect(store.getSelected()).toEqual(new Set());
    expect(store.getAnchor()).toBeNull();
  });

  it("uses the latest visible order without notifying path or summary subscribers", () => {
    const store = createFileSelectionStore(entries.slice(0, 3));
    const pathListener = vi.fn();
    const summaryListener = vi.fn();
    store.subscribePath("a.txt", pathListener);
    store.subscribeSummary(summaryListener);
    store.replace(["a.txt", "c.txt"]);
    pathListener.mockClear();
    summaryListener.mockClear();

    store.setVisibleOrder(["c.txt", "b.txt", "a.txt"]);

    expect(store.getOrderedPaths()).toEqual(["c.txt", "a.txt"]);
    expect(pathListener).not.toHaveBeenCalled();
    expect(summaryListener).not.toHaveBeenCalled();
  });
});
