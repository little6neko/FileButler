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

export type BaseWindowRecord = {
  id: string;
  status: WindowStatus;
  statusBeforeMinimize: RestorableWindowStatus | null;
  rect: WindowRect;
  restoreRect: WindowRect;
  zOrder: number;
  focusOrder: number;
};

export type FileWindowRecord = BaseWindowRecord & {
  kind: "file";
  sessionId: string;
};

export type PowerRenameWindowRecord = BaseWindowRecord & {
  kind: "powerRename";
  instanceId: string;
};

export type MediaPreviewWindowRecord = BaseWindowRecord & {
  kind: "mediaPreview";
  instanceId: string;
};

export type TextEditorWindowRecord = BaseWindowRecord & {
  kind: "textEditor";
  instanceId: string;
};

export type SuperRenameWindowRecord = BaseWindowRecord & {
  kind: "superRename";
  instanceId: string;
};

export type Cloud115WindowRecord = BaseWindowRecord & { kind: "cloud115"; instanceId: string; trail?: { id: string; name: string }[] };
export type DesktopWindowRecord = FileWindowRecord | PowerRenameWindowRecord | MediaPreviewWindowRecord | TextEditorWindowRecord | SuperRenameWindowRecord | Cloud115WindowRecord;

export type WindowManagerState = {
  windows: DesktopWindowRecord[];
  activeWindowId: string | null;
  nextOrder: number;
  cascadeIndex: number;
};

export const desktopWindowMinimum = { width: 560, height: 360 } as const;
export const powerRenameWindowMinimum = { width: 720, height: 480 } as const;
export const mediaPreviewWindowMinimum = { width: 420, height: 280 } as const;
export const textEditorWindowMinimum = { width: 640, height: 400 } as const;
export const superRenameWindowMinimum = { width: 760, height: 500 } as const;

const desktopInset = 12;
const cascadeOrigin = { x: 96, y: 40 } as const;
const cascadeStep = { x: 28, y: 24 } as const;

export function createWindowManagerState(): WindowManagerState {
  return { windows: [], activeWindowId: null, nextOrder: 1, cascadeIndex: 0 };
}

export function openCloud115Window(state: WindowManagerState, id: string, bounds: DesktopBounds, trail?: { id: string; name: string }[]): WindowManagerState {
  return openWindow(state, id, { kind: "cloud115", instanceId: id, trail }, bounds);
}

export function openFileWindow(
  state: WindowManagerState,
  id: string,
  sessionId: string,
  bounds: DesktopBounds,
): WindowManagerState {
  return openWindow(state, id, { kind: "file", sessionId }, bounds);
}

export function openPowerRenameWindow(
  state: WindowManagerState,
  id: string,
  instanceId: string,
  bounds: DesktopBounds,
): WindowManagerState {
  return openWindow(state, id, { kind: "powerRename", instanceId }, bounds);
}

export function openMediaPreviewWindow(
  state: WindowManagerState,
  id: string,
  instanceId: string,
  bounds: DesktopBounds,
): WindowManagerState {
  return openWindow(state, id, { kind: "mediaPreview", instanceId }, bounds);
}

export function openTextEditorWindow(
  state: WindowManagerState,
  id: string,
  instanceId: string,
  bounds: DesktopBounds,
): WindowManagerState {
  return openWindow(state, id, { kind: "textEditor", instanceId }, bounds);
}

export function openSuperRenameWindow(
  state: WindowManagerState,
  id: string,
  instanceId: string,
  bounds: DesktopBounds,
): WindowManagerState {
  return openWindow(state, id, { kind: "superRename", instanceId }, bounds);
}

function openWindow(
  state: WindowManagerState,
  id: string,
  identity:
    | Pick<FileWindowRecord, "kind" | "sessionId">
    | Pick<PowerRenameWindowRecord, "kind" | "instanceId">
    | Pick<MediaPreviewWindowRecord, "kind" | "instanceId">
    | Pick<TextEditorWindowRecord, "kind" | "instanceId">
    | Pick<SuperRenameWindowRecord, "kind" | "instanceId">
    | Pick<Cloud115WindowRecord, "kind" | "instanceId" | "trail">,
  bounds: DesktopBounds,
): WindowManagerState {
  const rect = cascadeRect(bounds, state.cascadeIndex, windowMinimum(identity));
  const order = state.nextOrder;
  const base = {
    id,
    status: "normal" as const,
    statusBeforeMinimize: null,
    rect,
    restoreRect: rect,
    zOrder: order,
    focusOrder: order,
  };
  const window: DesktopWindowRecord = identity.kind === "file"
    ? { ...base, kind: identity.kind, sessionId: identity.sessionId }
    : { ...base, kind: identity.kind, instanceId: identity.instanceId };
  return {
    windows: [...state.windows, window],
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
    const nextRect = clampWindowRect(rect, bounds, windowMinimum(window));
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
  minimum: { width: number; height: number } = desktopWindowMinimum,
): WindowRect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;

  if (direction.includes("w")) left += deltaX;
  if (direction.includes("e")) right += deltaX;
  if (direction.includes("n")) top += deltaY;
  if (direction.includes("s")) bottom += deltaY;

  if (right - left < minimum.width) {
    if (direction.includes("w")) left = right - minimum.width;
    else right = left + minimum.width;
  }
  if (bottom - top < minimum.height) {
    if (direction.includes("n")) top = bottom - minimum.height;
    else bottom = top + minimum.height;
  }

  return clampWindowRect({ x: left, y: top, width: right - left, height: bottom - top }, bounds, minimum);
}

export function reconcileWindowBounds(state: WindowManagerState, bounds: DesktopBounds): WindowManagerState {
  let changed = false;
  const windows = state.windows.map((window) => {
    const minimum = windowMinimum(window);
    const rect = clampWindowRect(window.rect, bounds, minimum);
    const restoreRect = clampWindowRect(window.restoreRect, bounds, minimum);
    if (sameRect(rect, window.rect) && sameRect(restoreRect, window.restoreRect)) return window;
    changed = true;
    return { ...window, rect, restoreRect };
  });
  return changed ? { ...state, windows } : state;
}

export function renderedWindowRect(window: BaseWindowRecord, bounds: DesktopBounds): WindowRect {
  return window.status === "maximized"
    ? { x: 0, y: 0, width: bounds.width, height: bounds.height }
    : window.rect;
}

export function windowsByMostRecent(state: WindowManagerState): DesktopWindowRecord[] {
  return [...state.windows].sort((left, right) => right.focusOrder - left.focusOrder || right.zOrder - left.zOrder);
}

function updateFocusedWindow(
  state: WindowManagerState,
  id: string,
  update: (window: DesktopWindowRecord) => DesktopWindowRecord,
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

function cascadeRect(
  bounds: DesktopBounds,
  cascadeIndex: number,
  minimum: { width: number; height: number },
): WindowRect {
  const width = clamp(
    Math.round(bounds.width * 0.68),
    Math.min(minimum.width, Math.max(1, bounds.width - desktopInset * 2)),
    Math.max(1, bounds.width - desktopInset * 2),
  );
  const height = clamp(
    Math.round(bounds.height * 0.72),
    Math.min(minimum.height, Math.max(1, bounds.height - desktopInset * 2)),
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

function clampWindowRect(
  rect: WindowRect,
  bounds: DesktopBounds,
  minimum: { width: number; height: number },
): WindowRect {
  const maximumWidth = Math.max(1, bounds.width - desktopInset * 2);
  const maximumHeight = Math.max(1, bounds.height - desktopInset * 2);
  const minimumWidth = Math.min(minimum.width, maximumWidth);
  const minimumHeight = Math.min(minimum.height, maximumHeight);
  const width = clamp(rect.width, minimumWidth, maximumWidth);
  const height = clamp(rect.height, minimumHeight, maximumHeight);
  return {
    x: clamp(rect.x, desktopInset, Math.max(desktopInset, bounds.width - width - desktopInset)),
    y: clamp(rect.y, desktopInset, Math.max(desktopInset, bounds.height - height - desktopInset)),
    width,
    height,
  };
}

function mostRecentVisibleWindowID(windows: DesktopWindowRecord[], excludedID?: string): string | null {
  return [...windows]
    .filter((window) => window.id !== excludedID && window.status !== "minimized")
    .sort((left, right) => right.focusOrder - left.focusOrder)[0]?.id ?? null;
}

function highestVisibleZ(windows: DesktopWindowRecord[]) {
  return Math.max(0, ...windows.filter((window) => window.status !== "minimized").map((window) => window.zOrder));
}

export function windowMinimum(window: Pick<DesktopWindowRecord, "kind">) {
  if (window.kind === "powerRename") return powerRenameWindowMinimum;
  if (window.kind === "mediaPreview") return mediaPreviewWindowMinimum;
  if (window.kind === "textEditor") return textEditorWindowMinimum;
  if (window.kind === "superRename") return superRenameWindowMinimum;
  return desktopWindowMinimum;
}

export function isFileWindow(window: DesktopWindowRecord): window is FileWindowRecord {
  return window.kind === "file";
}

export function isMediaPreviewWindow(window: DesktopWindowRecord): window is MediaPreviewWindowRecord {
  return window.kind === "mediaPreview";
}

export function isTextEditorWindow(window: DesktopWindowRecord): window is TextEditorWindowRecord {
  return window.kind === "textEditor";
}

export function isSuperRenameWindow(window: DesktopWindowRecord): window is SuperRenameWindowRecord {
  return window.kind === "superRename";
}

function sameRect(left: WindowRect, right: WindowRect) {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
