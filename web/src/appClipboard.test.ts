import { expect, it } from "vitest";
import { buildClipboardRequest, createAppClipboard, isEditableShortcutTarget } from "./appClipboard";
import type { Entry } from "./api/types";

it("captures ordered entries and builds a fixed copy or move request", () => {
  const clipboard = createAppClipboard("move", "source-root", "photos", [entry("photos/a.jpg"), entry("photos/b.jpg")], 42);
  expect(clipboard).toMatchObject({
    operation: "move",
    sourceRootId: "source-root",
    sourceParentPath: "photos",
    paths: ["photos/a.jpg", "photos/b.jpg"],
    createdAt: 42,
  });
  expect(buildClipboardRequest(clipboard!, { rootId: "dest-root", path: "archive" })).toEqual({
    type: "move",
    sourceRoot: "source-root",
    sources: ["photos/a.jpg", "photos/b.jpg"],
    destRoot: "dest-root",
    destPath: "archive",
  });
});

it("does not create clipboard data without a source or selection", () => {
  expect(createAppClipboard("copy", "", ".", [entry("a.txt")])).toBeNull();
  expect(createAppClipboard("copy", "root", ".", [])).toBeNull();
});

it("recognizes editable shortcut targets", () => {
  const input = document.createElement("input");
  const editable = document.createElement("div");
  editable.setAttribute("contenteditable", "true");
  const child = document.createElement("span");
  editable.append(child);
  expect(isEditableShortcutTarget(input)).toBe(true);
  expect(isEditableShortcutTarget(child)).toBe(true);
  expect(isEditableShortcutTarget(document.createElement("button"))).toBe(false);
});

function entry(relativePath: string): Entry {
  return {
    name: relativePath.split("/").at(-1) ?? relativePath,
    relativePath,
    type: "file",
    size: 1,
    mode: "",
    modifiedUnix: 0,
    isSymlink: false,
  };
}
