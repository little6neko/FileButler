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

  it("opens supported regular files and symbolic links as text", () => {
    expect(fileOpenKind(entry("main.go"))).toMatchObject({ kind: "text", text: { language: "go" } });
    expect(fileOpenKind(entry("README", "symlink"))).toMatchObject({ kind: "text", text: { language: "markdown" } });
  });

  it("does not open unknown files or other entry types", () => {
    expect(fileOpenKind(entry("archive.zip"))).toEqual({ kind: "unknown" });
    expect(fileOpenKind(entry("notes.txt", "other"))).toEqual({ kind: "unknown" });
  });
});

function entry(name: string, type: Entry["type"] = "file"): Entry {
  return { name, relativePath: name, type, size: 1, mode: "", modifiedUnix: 0, isSymlink: type === "symlink" };
}
