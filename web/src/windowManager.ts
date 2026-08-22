export type DesktopBounds = { width: number; height: number };
export type WindowStatus = "normal" | "maximized" | "minimized";
export type RestorableWindowStatus = Exclude<WindowStatus, "minimized">;
export type ResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export type WindowRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FileWindowRecord = {
  id: string;
  sessionId: string;
  status: WindowStatus;
  statusBeforeMinimize: RestorableWindowStatus | null;
  rect: WindowRect;
  restoreRect: WindowRect;
  zOrder: number;
  focusOrder: number;
};

export type WindowManagerState = {
  windows: FileWindowRecord[];
  activeWindowId: string | null;
  nextOrder: number;
  cascadeIndex: number;
};

export const desktopWindowMinimum = { width: 560, height: 360 } as const;

const desktopInset = 12;
const cascadeOrigin = { x: 96, y: 40 } as const;
const cascadeStep = { x: 28, y: 24 } as const;

export function createWindowManagerState(): WindowManagerState {
  return { windows: [], activeWindowId: null, nextOrder: 1, cascadeIndex: 0 };
}

export function openFileWindow(
  state: WindowManagerState,
  id: string,
  sessionId: string,
  bounds: DesktopBounds,
): WindowManagerState {
  const rect = cascadeRect(bounds, state.cascadeIndex);
  const order = state.nextOrder;
  return {
    windows: [
      ...state.windows,
      {
        id,
        sessionId,
        status: "normal",
        statusBeforeMinimize: null,
        rect,
        restoreRect: rect,
        zOrder: order,
        focusOrder: order,
      },
    ],
    activeWindowId: id,
    nextOrder: order + 1,
    cascadeIndex: state.cascadeIndex + 1,
  };
}

export function focusWindow(state: WindowManagerState, id: string): WindowManagerState {
  const target = state.windows.find((window) => window.id === id);
  if (!target) return state;
  if (target.status === "minimized") return restoreWindow(state, id);
  if (state.activeWindowId === id && target.zOrder === highestVisibleZ(state.windows)) return state;
  return updateFocusedWindow(state, id, (window) => window);
}

export function minimizeWindow(state: WindowManagerState, id: string): WindowManagerState {
  const target = state.windows.find((window) => window.id === id);
  if (!target || target.status === "minimized") return state;
  const statusBeforeMinimize: RestorableWindowStatus = target.status;
  const windows = state.windows.map((window) =>
    window.id === id
      ? { ...window, status: "minimized" as const, statusBeforeMinimize }
      : window,
  );
  return {
    ...state,
    windows,
    activeWindowId: state.activeWindowId === id ? mostRecentVisibleWindowID(windows, id) : state.activeWindowId,
  };
}

export function restoreWindow(state: WindowManagerState, id: string): WindowManagerState {
  const target = state.windows.find((window) => window.id === id);
  if (!target) return state;
  const status = target.status === "minimized" ? target.statusBeforeMinimize ?? "normal" : target.status;
  return updateFocusedWindow(state, id, (window) => ({
    ...window,
    status,
    statusBeforeMinimize: null,
  }));
}

export function toggleMaximizeWindow(state: WindowManagerState, id: string): WindowManagerState {
  const target = state.windows.find((window) => window.id === id);
  if (!target || target.status === "minimized") return state;
  return updateFocusedWindow(state, id, (window) =>
    window.status === "maximized"
      ? { ...window, status: "normal", rect: window.restoreRect }
      : { ...window, status: "maximized", restoreRect: window.rect },
  );
}

export function closeWindow(state: WindowManagerState, id: string): WindowManagerState {
  if (!state.windows.some((window) => window.id === id)) return state;
  const windows = state.windows.filter((window) => window.id !== id);
  return {
    ...state,
    windows,
    activeWindowId: state.activeWindowId === id ? mostRecentVisibleWindowID(windows) : state.activeWindowId,
  };
}

export function setWindowRect(
  state: WindowManagerState,
  id: string,
  rect: WindowRect,
  bounds: DesktopBounds,
): WindowManagerState {
  let changed = false;
  const windows = state.windows.map((window) => {
    if (window.id !== id || window.status !== "normal") return window;
    const nextRect = clampWindowRect(rect, bounds);
    if (sameRect(window.rect, nextRect)) return window;
    changed = true;
    return { ...window, rect: nextRect, restoreRect: nextRect };
  });
  return changed ? { ...state, windows } : state;
}

export function resizeWindowRect(
  start: WindowRect,
  direction: ResizeDirection,
  deltaX: number,
  deltaY: number,
  bounds: DesktopBounds,
): WindowRect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;

  if (direction.includes("w")) left += deltaX;
  if (direction.includes("e")) right += deltaX;
  if (direction.includes("n")) top += deltaY;
  if (direction.includes("s")) bottom += deltaY;

  if (right - left < desktopWindowMinimum.width) {
    if (direction.includes("w")) left = right - desktopWindowMinimum.width;
    else right = left + desktopWindowMinimum.width;
  }
  if (bottom - top < desktopWindowMinimum.height) {
    if (direction.includes("n")) top = bottom - desktopWindowMinimum.height;
    else bottom = top + desktopWindowMinimum.height;
  }

  return clampWindowRect({ x: left, y: top, width: right - left, height: bottom - top }, bounds);
}

export function reconcileWindowBounds(state: WindowManagerState, bounds: DesktopBounds): WindowManagerState {
  let changed = false;
  const windows = state.windows.map((window) => {
    const rect = clampWindowRect(window.rect, bounds);
    const restoreRect = clampWindowRect(window.restoreRect, bounds);
    if (sameRect(rect, window.rect) && sameRect(restoreRect, window.restoreRect)) return window;
    changed = true;
    return { ...window, rect, restoreRect };
  });
  return changed ? { ...state, windows } : state;
}

export function renderedWindowRect(window: FileWindowRecord, bounds: DesktopBounds): WindowRect {
  return window.status === "maximized"
    ? { x: 0, y: 0, width: bounds.width, height: bounds.height }
    : window.rect;
}

export function windowsByMostRecent(state: WindowManagerState): FileWindowRecord[] {
  return [...state.windows].sort((left, right) => right.focusOrder - left.focusOrder || right.zOrder - left.zOrder);
}

function updateFocusedWindow(
  state: WindowManagerState,
  id: string,
  update: (window: FileWindowRecord) => FileWindowRecord,
): WindowManagerState {
  const order = state.nextOrder;
  let found = false;
  const windows = state.windows.map((window) => {
    if (window.id !== id) return window;
    found = true;
    return { ...update(window), zOrder: order, focusOrder: order };
  });
  if (!found) return state;
  return { ...state, windows, activeWindowId: id, nextOrder: order + 1 };
}

function cascadeRect(bounds: DesktopBounds, cascadeIndex: number): WindowRect {
  const width = clamp(
    Math.round(bounds.width * 0.68),
    Math.min(desktopWindowMinimum.width, Math.max(1, bounds.width - desktopInset * 2)),
    Math.max(1, bounds.width - desktopInset * 2),
  );
  const height = clamp(
    Math.round(bounds.height * 0.72),
    Math.min(desktopWindowMinimum.height, Math.max(1, bounds.height - desktopInset * 2)),
    Math.max(1, bounds.height - desktopInset * 2),
  );
  const originX = clamp(cascadeOrigin.x, desktopInset, Math.max(desktopInset, bounds.width - width - desktopInset));
  const originY = clamp(cascadeOrigin.y, desktopInset, Math.max(desktopInset, bounds.height - height - desktopInset));
  const horizontalSteps = Math.max(0, Math.floor((bounds.width - desktopInset - width - originX) / cascadeStep.x));
  const verticalSteps = Math.max(0, Math.floor((bounds.height - desktopInset - height - originY) / cascadeStep.y));
  const positions = Math.max(1, Math.min(horizontalSteps, verticalSteps) + 1);
  const offset = cascadeIndex % positions;
  return { x: originX + offset * cascadeStep.x, y: originY + offset * cascadeStep.y, width, height };
}

function clampWindowRect(rect: WindowRect, bounds: DesktopBounds): WindowRect {
  const maximumWidth = Math.max(1, bounds.width - desktopInset * 2);
  const maximumHeight = Math.max(1, bounds.height - desktopInset * 2);
  const minimumWidth = Math.min(desktopWindowMinimum.width, maximumWidth);
  const minimumHeight = Math.min(desktopWindowMinimum.height, maximumHeight);
  const width = clamp(rect.width, minimumWidth, maximumWidth);
  const height = clamp(rect.height, minimumHeight, maximumHeight);
  return {
    x: clamp(rect.x, desktopInset, Math.max(desktopInset, bounds.width - width - desktopInset)),
    y: clamp(rect.y, desktopInset, Math.max(desktopInset, bounds.height - height - desktopInset)),
    width,
    height,
  };
}

function mostRecentVisibleWindowID(windows: FileWindowRecord[], excludedID?: string): string | null {
  return [...windows]
    .filter((window) => window.id !== excludedID && window.status !== "minimized")
    .sort((left, right) => right.focusOrder - left.focusOrder)[0]?.id ?? null;
}

function highestVisibleZ(windows: FileWindowRecord[]) {
  return Math.max(0, ...windows.filter((window) => window.status !== "minimized").map((window) => window.zOrder));
}

function sameRect(left: WindowRect, right: WindowRect) {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
