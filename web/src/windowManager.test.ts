import { describe, expect, it } from "vitest";
import {
  closeWindow,
  createWindowManagerState,
  focusWindow,
  isMediaPreviewWindow,
  isTextEditorWindow,
  minimizeWindow,
  openFileWindow,
  openMediaPreviewWindow,
  openPowerRenameWindow,
  openTextEditorWindow,
  reconcileWindowBounds,
  renderedWindowRect,
  resizeWindowRect,
  restoreWindow,
  setWindowRect,
  toggleMaximizeWindow,
  windowsByMostRecent,
} from "./windowManager";

const bounds = { width: 1000, height: 700 };

describe("window manager", () => {
  it("opens windows with deterministic cascading rectangles and focus order", () => {
    let state = createWindowManagerState();
    state = openFileWindow(state, "window-1", "session-1", bounds);
    state = openFileWindow(state, "window-2", "session-2", bounds);

    expect(state.windows[0].rect).toEqual({ x: 96, y: 40, width: 680, height: 504 });
    expect(state.windows[1].rect).toEqual({ x: 124, y: 64, width: 680, height: 504 });
    expect(state.activeWindowId).toBe("window-2");
    expect(windowsByMostRecent(state).map((window) => window.id)).toEqual(["window-2", "window-1"]);
  });

  it("minimizes the active window, focuses the next visible window, and restores its prior state", () => {
    let state = openFileWindow(createWindowManagerState(), "window-1", "session-1", bounds);
    state = openFileWindow(state, "window-2", "session-2", bounds);
    state = toggleMaximizeWindow(state, "window-2");
    state = minimizeWindow(state, "window-2");

    expect(state.activeWindowId).toBe("window-1");
    expect(state.windows.find((window) => window.id === "window-2")).toMatchObject({
      status: "minimized",
      statusBeforeMinimize: "maximized",
    });

    state = restoreWindow(state, "window-2");
    expect(state.activeWindowId).toBe("window-2");
    expect(state.windows.find((window) => window.id === "window-2")).toMatchObject({
      status: "maximized",
      statusBeforeMinimize: null,
    });
  });

  it("maximizes without losing the normal rectangle and restores it", () => {
    let state = openFileWindow(createWindowManagerState(), "window-1", "session-1", bounds);
    const normalRect = state.windows[0].rect;

    state = toggleMaximizeWindow(state, "window-1");
    expect(renderedWindowRect(state.windows[0], bounds)).toEqual({ x: 0, y: 0, width: 1000, height: 700 });

    state = toggleMaximizeWindow(state, "window-1");
    expect(state.windows[0].rect).toEqual(normalRect);
  });

  it("clamps movement and eight-direction resizing to desktop bounds and minimum dimensions", () => {
    let state = openFileWindow(createWindowManagerState(), "window-1", "session-1", bounds);
    state = setWindowRect(state, "window-1", { x: -100, y: -100, width: 200, height: 100 }, bounds);
    expect(state.windows[0].rect).toEqual({ x: 12, y: 12, width: 560, height: 360 });

    const resized = resizeWindowRect(state.windows[0].rect, "nw", 500, 500, bounds);
    expect(resized).toEqual({ x: 12, y: 12, width: 560, height: 360 });
  });

  it.each(["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const)("resizes from the %s handle", (direction) => {
    const start = { x: 200, y: 150, width: 600, height: 400 };
    const resized = resizeWindowRect(start, direction, 24, 18, bounds);

    expect(resized).not.toEqual(start);
    expect(resized.width).toBeGreaterThanOrEqual(560);
    expect(resized.height).toBeGreaterThanOrEqual(360);
    expect(resized.x).toBeGreaterThanOrEqual(12);
    expect(resized.y).toBeGreaterThanOrEqual(12);
    expect(resized.x + resized.width).toBeLessThanOrEqual(bounds.width - 12);
    expect(resized.y + resized.height).toBeLessThanOrEqual(bounds.height - 12);
  });

  it("reconciles normal and restore rectangles when the viewport shrinks", () => {
    let state = openFileWindow(createWindowManagerState(), "window-1", "session-1", bounds);
    state = setWindowRect(state, "window-1", { x: 300, y: 220, width: 680, height: 460 }, bounds);
    state = reconcileWindowBounds(state, { width: 800, height: 500 });

    expect(state.windows[0].rect).toEqual({ x: 108, y: 28, width: 680, height: 460 });
  });

  it("focuses and closes windows using MRU order", () => {
    let state = openFileWindow(createWindowManagerState(), "window-1", "session-1", bounds);
    state = openFileWindow(state, "window-2", "session-2", bounds);
    state = focusWindow(state, "window-1");
    state = closeWindow(state, "window-1");

    expect(state.activeWindowId).toBe("window-2");
    expect(state.windows.map((window) => window.id)).toEqual(["window-2"]);
  });

  it("preserves every application identity through shared window transitions", () => {
    let state = openFileWindow(createWindowManagerState(), "window-file", "session-1", bounds);
    state = openPowerRenameWindow(state, "window-rename", "rename-1", bounds);
    state = openMediaPreviewWindow(state, "window-media", "media-1", bounds);
    state = openTextEditorWindow(state, "window-text", "text-1", bounds);

    expect(state.windows).toMatchObject([
      { id: "window-file", kind: "file", sessionId: "session-1" },
      { id: "window-rename", kind: "powerRename", instanceId: "rename-1" },
      { id: "window-media", kind: "mediaPreview", instanceId: "media-1" },
      { id: "window-text", kind: "textEditor", instanceId: "text-1" },
    ]);
    expect(state.windows[1].rect).toMatchObject({ width: 720, height: 504 });
    expect(isMediaPreviewWindow(state.windows[2])).toBe(true);
    expect(isTextEditorWindow(state.windows[3])).toBe(true);

    state = setWindowRect(state, "window-media", { x: 0, y: 0, width: 100, height: 100 }, bounds);
    expect(state.windows[2].restoreRect).toMatchObject({ width: 420, height: 280 });

    state = setWindowRect(state, "window-text", { x: 0, y: 0, width: 100, height: 100 }, bounds);
    expect(state.windows[3].restoreRect).toMatchObject({ width: 640, height: 400 });

    state = setWindowRect(state, "window-rename", { x: 0, y: 0, width: 100, height: 100 }, bounds);
    state = toggleMaximizeWindow(state, "window-rename");
    state = minimizeWindow(state, "window-rename");
    state = restoreWindow(state, "window-rename");

    expect(state.windows[1]).toMatchObject({
      kind: "powerRename",
      instanceId: "rename-1",
      status: "maximized",
      restoreRect: { width: 720, height: 480 },
    });

    state = closeWindow(state, "window-rename");
    expect(state.activeWindowId).toBe("window-text");
    expect(state.windows).toMatchObject([
      { id: "window-file", kind: "file", sessionId: "session-1" },
      { id: "window-media", kind: "mediaPreview", instanceId: "media-1" },
      { id: "window-text", kind: "textEditor", instanceId: "text-1" },
    ]);
  });
});
