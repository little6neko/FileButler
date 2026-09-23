import { afterEach, expect, it, vi } from "vitest";
import { progressAnchor } from "./progressAnchor";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

function pane(root: string, path: string, x: number, windowId?: string) {
  const element = document.createElement("section");
  element.className = "file-pane";
  element.dataset.rootId = root;
  element.dataset.directoryPath = path;
  const rect = { x, y: 100, width: 600, height: 400 } as DOMRect;
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect);
  if (windowId) {
    const frame = document.createElement("section");
    frame.className = "desktop-window"; frame.dataset.windowId = windowId;
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(rect);
    frame.append(element); document.body.append(frame);
  } else document.body.append(element);
  return element;
}

it("uses the destination window instead of the source or active window", () => {
  pane("@115", "0", 0, "source");
  pane("local", ".", 700, "destination");
  expect(progressAnchor({ type: "copy", sourceRoot: "@115", sources: ["1"], destRoot: "local", destPath: "." }, "source")).toEqual({ x: 1000, y: 300 });
});
it("uses the compact destination pane and falls back to the initiating window", () => {
  pane("local", ".", 0, "source");
  pane("@115", "9", 700);
  expect(progressAnchor({ type: "move", sourceRoot: "local", sources: ["a"], destRoot: "@115", destPath: "9" }, "source")).toEqual({ x: 1000, y: 300 });
  expect(progressAnchor(undefined, "source")).toEqual({ x: 300, y: 300 });
});
it("lets the progress window fall back to the viewport when no pane exists", () => {
  expect(progressAnchor()).toBeUndefined();
});
