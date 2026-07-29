import { describe, expect, it } from "vitest";
import type { Entry } from "./api/types";
import {
  buildDragRequest,
  buildFileDragSource,
  defaultDragOperation,
  validateFileDrop,
  type FileDragData,
  type FileDropData,
} from "./fileDrag";

describe("buildFileDragSource", () => {
  it("keeps selected entries in visible order", () => {
    const visibleEntries = [entry("a.txt"), entry("b.txt"), entry("folder", "directory")];
    const source = buildFileDragSource(dragData(visibleEntries[1]), new Set(["b.txt", "a.txt"]), visibleEntries);
    expect(source.entries.map((item) => item.relativePath)).toEqual(["a.txt", "b.txt"]);
  });

  it("uses only an unselected dragged entry", () => {
    const visibleEntries = [entry("a.txt"), entry("b.txt")];
    const source = buildFileDragSource(dragData(visibleEntries[1]), new Set(["a.txt"]), visibleEntries);
    expect(source.entries.map((item) => item.relativePath)).toEqual(["b.txt"]);
  });
});

it("defaults to move for equal roots and copy for different roots", () => {
  const source = buildSource(entry("a.txt"));
  expect(defaultDragOperation(source, drop("left", "root-a", "folder", "directory"))).toBe("move");
  expect(defaultDragOperation(source, drop("right", "root-b", ".", "current-directory"))).toBe("copy");
});

it("rejects the existing parent, self, and descendants without prefix false positives", () => {
  const fileSource = buildSource(entry("a.txt"));
  expect(validateFileDrop(fileSource, drop("right", "root-a", ".", "current-directory"))).toEqual({
    valid: false,
    reason: "same-directory",
  });

  const directorySource = buildSource(entry("folder", "directory"));
  expect(validateFileDrop(directorySource, drop("right", "root-a", "folder", "directory"))).toEqual({
    valid: false,
    reason: "inside-source",
  });
  expect(validateFileDrop(directorySource, drop("right", "root-a", "folder/child", "directory"))).toEqual({
    valid: false,
    reason: "inside-source",
  });
  expect(validateFileDrop(directorySource, drop("right", "root-a", "folder-two", "directory"))).toEqual({ valid: true });
});

it("normalizes dot segments before checking no-op and recursive destinations", () => {
  const fileEntry = entry("b/a.txt");
  const fileData = dragData(fileEntry);
  fileData.parentPath = "a/../b";
  expect(validateFileDrop(buildFileDragSource(fileData, new Set(), [fileEntry]), drop("right", "root-a", "b", "current-directory"))).toEqual({
    valid: false,
    reason: "same-directory",
  });

  const directorySource = buildSource(entry("folder", "directory"));
  expect(validateFileDrop(directorySource, drop("right", "root-a", "other/../folder", "directory"))).toEqual({
    valid: false,
    reason: "inside-source",
  });
});

it("allows different roots and builds the existing OpsRequest shape", () => {
  const source = buildSource(entry("a.txt"));
  const target = drop("right", "root-b", "archive", "directory");
  expect(validateFileDrop(source, target)).toEqual({ valid: true });
  expect(buildDragRequest(source, target)).toEqual({
    type: "copy",
    sourceRoot: "root-a",
    sources: ["a.txt"],
    destRoot: "root-b",
    destPath: "archive",
  });
});

function dragData(clicked: Entry): FileDragData {
  return {
    kind: "file-entry",
    pane: "left",
    rootId: "root-a",
    parentPath: ".",
    entry: clicked,
  };
}

function buildSource(clicked: Entry) {
  return buildFileDragSource(dragData(clicked), new Set(), [clicked]);
}

function drop(
  pane: "left" | "right",
  rootId: string,
  path: string,
  kind: FileDropData["kind"],
): FileDropData {
  return { id: `${pane}:${kind}:${path}`, kind, pane, rootId, path, label: path };
}

function entry(relativePath: string, type: Entry["type"] = "file"): Entry {
  const name = relativePath.split("/").at(-1) ?? relativePath;
  return { name, relativePath, type, size: 1, mode: "", modifiedUnix: 0, isSymlink: false };
}
