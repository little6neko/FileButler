import { describe, expect, it } from "vitest";
import type { Entry } from "./api/types";
import { fileOpenKind } from "./fileOpenKind";

describe("file open dispatch", () => {
  it("prioritizes directories before names and extensions", () => {
    expect(fileOpenKind(entry("photo.svg", "directory"))).toEqual({ kind: "directory" });
  });

  it("prioritizes all supported media before text", () => {
    expect(fileOpenKind(entry("picture.svg"))).toEqual({ kind: "media", mediaKind: "image" });
    expect(fileOpenKind(entry("clip.mp4"))).toEqual({ kind: "media", mediaKind: "video" });
  });

  it("opens supported regular files as text", () => {
    expect(fileOpenKind(entry("main.go"))).toMatchObject({ kind: "text", text: { language: "go" } });
  });

  it("routes mapped directory links to their returned target", () => {
    expect(fileOpenKind(mappedLink("shortcut", "directory", "target", "albums/2026"))).toEqual({
      kind: "directory",
      target: { rootId: "target", path: "albums/2026" },
    });
  });

  it("classifies mapped file links by the target extension", () => {
    expect(fileOpenKind(mappedLink("cover", "file", "target", "albums/cover.jpg"))).toEqual({
      kind: "media",
      mediaKind: "image",
      target: { rootId: "target", path: "albums/cover.jpg" },
    });
    expect(fileOpenKind(mappedLink("source", "file", "target", "src/main.go"))).toMatchObject({
      kind: "text",
      text: { language: "go" },
      target: { rootId: "target", path: "src/main.go" },
    });
  });

  it("does not follow broken, unmapped, or incompletely mapped links", () => {
    expect(fileOpenKind(link("broken"))).toEqual({ kind: "unknown" });
    expect(fileOpenKind(link("unmapped"))).toEqual({ kind: "unknown" });
    expect(fileOpenKind({
      ...entry("missing-target", "symlink"),
      symlinkResolution: { state: "mapped", targetKind: "file" },
    })).toEqual({ kind: "unknown" });
  });

  it("does not open unknown files or other entry types", () => {
    expect(fileOpenKind(entry("archive.zip"))).toEqual({ kind: "unknown" });
    expect(fileOpenKind(entry("notes.txt", "other"))).toEqual({ kind: "unknown" });
  });
});

function entry(name: string, type: Entry["type"] = "file"): Entry {
  return { name, relativePath: name, type, size: 1, mode: "", modifiedUnix: 0, isSymlink: type === "symlink" };
}

function mappedLink(name: string, targetKind: "file" | "directory", targetRootId: string, targetPath: string): Entry {
  return {
    ...entry(name, "symlink"),
    symlinkResolution: { state: "mapped", targetKind, targetRootId, targetPath },
  };
}

function link(state: "broken" | "unmapped"): Entry {
  return { ...entry(`${state}-link`, "symlink"), symlinkResolution: { state } };
}
