import { expect, it } from "vitest";
import type { Entry } from "./api/types";
import {
  buildLinkRequest,
  buildLinkSourceRequest,
  createLinkSource,
  isLinkSourceEntry,
  resolveLinkTarget,
} from "./linkSource";

it("captures one pane selection in visible order and replaces it with a new snapshot", () => {
  const first = createLinkSource("media", "写真 (A)", [
    entry("写真 (A)/二.jpg"),
    entry("写真 (A)/一.jpg"),
  ], 42);
  const replacement = createLinkSource("other", ".", [entry("新文件.txt")], 43);

  expect(first).toMatchObject({
    sourceRootId: "media",
    sourceParentPath: "写真 (A)",
    paths: ["写真 (A)/二.jpg", "写真 (A)/一.jpg"],
    createdAt: 42,
  });
  expect(replacement).toMatchObject({ sourceRootId: "other", paths: ["新文件.txt"] });
  expect(isLinkSourceEntry(first, "media", "写真 (A)/二.jpg")).toBe(true);
  expect(isLinkSourceEntry(first, "other", "写真 (A)/二.jpg")).toBe(false);
});

it("rejects empty, duplicate, or mixed-parent source selections", () => {
  expect(createLinkSource("", ".", [entry("a.txt")])).toBeNull();
  expect(createLinkSource("root", ".", [])).toBeNull();
  expect(createLinkSource("root", ".", [entry("a.txt"), entry("a.txt")])).toBeNull();
  expect(createLinkSource("root", "a", [entry("a/one.txt"), entry("b/two.txt")])).toBeNull();
});

it("owns entry and nested symlink metadata instead of retaining mutable input", () => {
  const original = entry("folder/link");
  original.type = "symlink";
  original.isSymlink = true;
  original.symlinkResolution = {
    state: "mapped",
    targetKind: "directory",
    targetRootId: "target",
    targetPath: "album",
  };
  const source = createLinkSource("root", "folder", [original])!;

  original.name = "changed";
  original.relativePath = "folder/changed";
  original.symlinkResolution.targetPath = "changed";
  expect(source.entries[0]).toMatchObject({
    name: "link",
    relativePath: "folder/link",
    symlinkResolution: { targetPath: "album" },
  });
});

it("builds cross-root preview requests from a source snapshot", () => {
  const source = createLinkSource("source", "写真 (A)", [entry("写真 (A)/一.jpg")])!;
  expect(buildLinkSourceRequest(source, { rootId: "destination", path: "archive" }, "hardlink")).toEqual({
    type: "hardlink",
    sourceRoot: "source",
    sources: ["写真 (A)/一.jpg"],
    destRoot: "destination",
    destPath: "archive",
  });
});

it("lets toolbar callers build the same request without LinkSource state", () => {
  expect(buildLinkRequest("symlink", "left", ["folder/a.txt"], { rootId: "right", path: "." })).toEqual({
    type: "symlink",
    sourceRoot: "left",
    sources: ["folder/a.txt"],
    destRoot: "right",
    destPath: ".",
  });
});

it("targets real directories, current directories, and virtual root cards", () => {
  expect(resolveLinkTarget({
    kind: "directory",
    rootId: "data",
    path: "current",
    entry: { type: "directory", relativePath: "current/subfolder" },
  })).toEqual({ rootId: "data", path: "current/subfolder" });
  for (const type of ["file", "symlink", "other"] as const) {
    expect(resolveLinkTarget({
      kind: "directory",
      rootId: "data",
      path: "current",
      entry: { type, relativePath: "current/item" },
    })).toEqual({ rootId: "data", path: "current" });
  }
  expect(resolveLinkTarget({ kind: "directory", rootId: "data", path: "current" }))
    .toEqual({ rootId: "data", path: "current" });
  expect(resolveLinkTarget({ kind: "virtual-root", rootId: "archive" }))
    .toEqual({ rootId: "archive", path: "." });
});

function entry(relativePath: string): Entry {
  return {
    name: relativePath.split("/").at(-1) ?? relativePath,
    relativePath,
    type: "file",
    size: 1,
    mode: "-rw-r--r--",
    modifiedUnix: 1,
    isSymlink: false,
  };
}
