import type { Entry } from "./api/types";
import { applyFileSelection, type FileSelectionMode } from "./fileSelection";

export type FileSelectionSummary = {
  selectedCount: number;
  selectedBytes: number;
  allVisibleSelected: boolean;
};

type Listener = () => void;

export type FileSelectionStore = ReturnType<typeof createFileSelectionStore>;

export function createFileSelectionStore(initialEntries: readonly Entry[] = [], initialSelected: Iterable<string> = []) {
  let entriesByPath = new Map(initialEntries.map((entry) => [entry.relativePath, entry]));
  let selected = selectedFrom(initialSelected, entriesByPath);
  let anchor: string | null = null;
  let visibleOrder = initialEntries.map((entry) => entry.relativePath);
  let summary = calculateSummary(selected, entriesByPath);
  const pathListeners = new Map<string, Set<Listener>>();
  const summaryListeners = new Set<Listener>();

  function notifyPath(path: string) {
    const listeners = pathListeners.get(path);
    if (!listeners) return;
    for (const listener of Array.from(listeners)) listener();
  }

  function notifySummary() {
    for (const listener of Array.from(summaryListeners)) listener();
  }

  function updateSummary(next: FileSelectionSummary) {
    if (sameSummary(summary, next)) return;
    summary = next;
    notifySummary();
  }

  function commit(nextSelected: Set<string>, nextAnchor: string | null) {
    const removed: string[] = [];
    const added: string[] = [];
    for (const path of selected) {
      if (!nextSelected.has(path)) removed.push(path);
    }
    for (const path of nextSelected) {
      if (!selected.has(path)) added.push(path);
    }

    const selectionChanged = removed.length > 0 || added.length > 0;
    if (!selectionChanged && anchor === nextAnchor) return;

    let selectedCount = summary.selectedCount;
    let selectedBytes = summary.selectedBytes;
    for (const path of removed) {
      const entry = entriesByPath.get(path);
      if (!entry) continue;
      selectedCount -= 1;
      selectedBytes -= entry.size;
    }
    for (const path of added) {
      const entry = entriesByPath.get(path);
      if (!entry) continue;
      selectedCount += 1;
      selectedBytes += entry.size;
    }

    selected = nextSelected;
    anchor = nextAnchor;
    for (const path of removed) notifyPath(path);
    for (const path of added) notifyPath(path);
    updateSummary({
      selectedCount,
      selectedBytes,
      allVisibleSelected: entriesByPath.size > 0 && selectedCount === entriesByPath.size,
    });
  }

  const store = {
    getSelected: () => selected as ReadonlySet<string>,
    getAnchor: () => anchor,
    getVisibleOrder: () => visibleOrder as readonly string[],
    getSummary: () => summary,
    isSelected: (path: string) => selected.has(path),
    subscribePath(path: string, listener: Listener) {
      let listeners = pathListeners.get(path);
      if (!listeners) {
        listeners = new Set();
        pathListeners.set(path, listeners);
      }
      listeners.add(listener);
      return () => {
        listeners?.delete(listener);
        if (listeners?.size === 0) pathListeners.delete(path);
      };
    },
    subscribeSummary(listener: Listener) {
      summaryListeners.add(listener);
      return () => summaryListeners.delete(listener);
    },
    replace(paths: Iterable<string>, nextAnchor: string | null = null) {
      commit(selectedFrom(paths, entriesByPath), validAnchor(nextAnchor, entriesByPath));
    },
    clear() {
      commit(new Set(), null);
    },
    select(path: string, mode: FileSelectionMode) {
      if (!entriesByPath.has(path)) return;
      const next = applyFileSelection(selected, anchor, visibleOrder, path, mode);
      commit(next.selected, next.anchor);
    },
    toggle(path: string) {
      store.select(path, "toggle");
    },
    selectAll(checked: boolean) {
      commit(checked ? new Set(entriesByPath.keys()) : new Set(), null);
    },
    selectContextTarget(path: string | null) {
      if (path === null) {
        store.clear();
        return;
      }
      if (!entriesByPath.has(path)) return;
      if (selected.has(path)) {
        commit(selected, path);
        return;
      }
      commit(new Set([path]), path);
    },
    setVisibleOrder(paths: readonly string[]) {
      if (sameStringArray(visibleOrder, paths)) return;
      visibleOrder = Array.from(paths);
    },
    setEntries(entries: readonly Entry[]) {
      const nextEntries = new Map(entries.map((entry) => [entry.relativePath, entry]));
      const nextSelected = selectedFrom(selected, nextEntries);
      const nextAnchor = validAnchor(anchor, nextEntries);
      const nextOrder = visibleOrder.filter((path) => nextEntries.has(path));
      const orderedPaths = new Set(nextOrder);
      for (const entry of entries) {
        if (!orderedPaths.has(entry.relativePath)) nextOrder.push(entry.relativePath);
      }

      const removed = Array.from(selected).filter((path) => !nextSelected.has(path));
      entriesByPath = nextEntries;
      visibleOrder = nextOrder;
      selected = nextSelected;
      anchor = nextAnchor;
      for (const path of removed) notifyPath(path);
      updateSummary(calculateSummary(selected, entriesByPath));
    },
    getOrderedPaths() {
      const ordered = visibleOrder.filter((path) => selected.has(path));
      const visible = new Set(visibleOrder);
      return [...ordered, ...Array.from(selected).filter((path) => !visible.has(path))];
    },
  };

  return store;
}

function selectedFrom(paths: Iterable<string>, entriesByPath: ReadonlyMap<string, Entry>) {
  const selected = new Set<string>();
  for (const path of paths) {
    if (entriesByPath.has(path)) selected.add(path);
  }
  return selected;
}

function validAnchor(anchor: string | null, entriesByPath: ReadonlyMap<string, Entry>) {
  return anchor !== null && entriesByPath.has(anchor) ? anchor : null;
}

function calculateSummary(selected: ReadonlySet<string>, entriesByPath: ReadonlyMap<string, Entry>): FileSelectionSummary {
  let selectedCount = 0;
  let selectedBytes = 0;
  for (const path of selected) {
    const entry = entriesByPath.get(path);
    if (!entry) continue;
    selectedCount += 1;
    selectedBytes += entry.size;
  }
  return {
    selectedCount,
    selectedBytes,
    allVisibleSelected: entriesByPath.size > 0 && selectedCount === entriesByPath.size,
  };
}

function sameSummary(left: FileSelectionSummary, right: FileSelectionSummary) {
  return (
    left.selectedCount === right.selectedCount &&
    left.selectedBytes === right.selectedBytes &&
    left.allVisibleSelected === right.allVisibleSelected
  );
}

function sameStringArray(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
