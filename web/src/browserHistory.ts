export type DirectoryLocation = { kind: "directory"; rootId: string; path: string };
export type BrowserLocation = DirectoryLocation | { kind: "virtual-root" };

export type BrowserHistory = {
  back: DirectoryLocation[];
  forward: DirectoryLocation[];
};

export type BrowserHistoryDirection = "back" | "forward";

export type BrowserHistoryMove = {
  target: DirectoryLocation;
  history: BrowserHistory;
};

const maxHistoryEntries = 100;

export function createBrowserHistory(): BrowserHistory {
  return { back: [], forward: [] };
}

export function recordBrowserVisit(
  history: BrowserHistory,
  current: DirectoryLocation,
  next: DirectoryLocation,
): BrowserHistory {
  if (sameDirectoryLocation(current, next)) return history;
  return {
    back: appendHistory(history.back, current),
    forward: [],
  };
}

export function browserHistoryTarget(
  history: BrowserHistory,
  direction: BrowserHistoryDirection,
): DirectoryLocation | null {
  return history[direction].at(-1) ?? null;
}

export function moveBrowserHistory(
  history: BrowserHistory,
  current: DirectoryLocation,
  direction: BrowserHistoryDirection,
): BrowserHistoryMove | null {
  const target = browserHistoryTarget(history, direction);
  if (!target) return null;
  if (direction === "back") {
    return {
      target,
      history: {
        back: history.back.slice(0, -1),
        forward: appendHistory(history.forward, current),
      },
    };
  }
  return {
    target,
    history: {
      back: appendHistory(history.back, current),
      forward: history.forward.slice(0, -1),
    },
  };
}

export function parentDirectoryLocation(current: DirectoryLocation): DirectoryLocation | null {
  if (current.path === ".") return null;
  const segments = current.path.split("/").filter((segment) => segment && segment !== ".");
  segments.pop();
  return {
    ...current,
    path: segments.length > 0 ? segments.join("/") : ".",
  };
}

function sameDirectoryLocation(left: DirectoryLocation, right: DirectoryLocation) {
  return left.rootId === right.rootId && left.path === right.path;
}

function appendHistory(history: DirectoryLocation[], location: DirectoryLocation) {
  return [...history, location].slice(-maxHistoryEntries);
}
