import { describe, expect, it } from "vitest";
import type { Entry } from "./api/types";
import {
  canMoveMedia,
  createMediaGallerySnapshot,
  createSingleMediaSnapshot,
  currentMediaItem,
  moveMedia,
} from "./mediaGallery";

function entry(name: string, relativePath = name, type: Entry["type"] = "file"): Entry {
  return { name, relativePath, type, size: 1, mode: "", modifiedUnix: 0, isSymlink: false };
}

describe("media gallery snapshots", () => {
  it("uses the visible file order and filters non-media, directories, and nested entries", () => {
    const entries = [
      entry("folder", "folder", "directory"),
      entry("photo-10.png"),
      entry("notes.txt"),
      entry("clip.mp4"),
      entry("photo-2.jpg"),
      entry("nested.png", "folder/nested.png"),
    ];
    const snapshot = createMediaGallerySnapshot(
      "source",
      ".",
      entries,
      ["clip.mp4", "folder/nested.png", "notes.txt", "photo-10.png", "photo-2.jpg", "folder"],
      "photo-10.png",
    );

    expect(snapshot).toMatchObject({ rootId: "source", index: 1 });
    expect(snapshot?.items.map((item) => item.relativePath)).toEqual(["clip.mp4", "photo-10.png", "photo-2.jpg"]);
    expect(snapshot?.items.map((item) => item.kind)).toEqual(["video", "image", "image"]);
  });

  it("falls back to entry order for an immediate child in a nested current directory", () => {
    const snapshot = createMediaGallerySnapshot(
      "source",
      "albums",
      [entry("b.webp", "albums/b.webp"), entry("outside.png"), entry("a.mkv", "albums/a.mkv")],
      [],
      "albums/a.mkv",
    );

    expect(snapshot?.items.map((item) => item.relativePath)).toEqual(["albums/b.webp", "albums/a.mkv"]);
    expect(snapshot?.index).toBe(1);
  });

  it("moves immutably between adjacent media and protects both boundaries", () => {
    const initial = createMediaGallerySnapshot(
      "source",
      ".",
      [entry("a.png"), entry("b.mp4"), entry("c.jpg")],
      ["a.png", "b.mp4", "c.jpg"],
      "b.mp4",
    )!;

    expect(currentMediaItem(initial)?.relativePath).toBe("b.mp4");
    expect(canMoveMedia(initial, "previous")).toBe(true);
    expect(canMoveMedia(initial, "next")).toBe(true);

    const first = moveMedia(initial, "previous");
    expect(first).not.toBe(initial);
    expect(currentMediaItem(first)?.relativePath).toBe("a.png");
    expect(canMoveMedia(first, "previous")).toBe(false);
    expect(moveMedia(first, "previous")).toBe(first);

    const last = moveMedia(moveMedia(first, "next"), "next");
    expect(currentMediaItem(last)?.relativePath).toBe("c.jpg");
    expect(canMoveMedia(last, "next")).toBe(false);
    expect(moveMedia(last, "next")).toBe(last);
  });

  it("returns null when the requested media is not an immediate previewable item", () => {
    expect(createMediaGallerySnapshot("source", ".", [entry("notes.txt")], [], "notes.txt")).toBeNull();
    expect(createMediaGallerySnapshot("source", ".", [entry("nested.png", "folder/nested.png")], [], "folder/nested.png")).toBeNull();
  });

  it("creates an isolated snapshot for a mapped media link while retaining its display name", () => {
    expect(createSingleMediaSnapshot("target", "albums/actual.jpg", "shortcut", "image")).toEqual({
      rootId: "target",
      items: [{ name: "shortcut", relativePath: "albums/actual.jpg", kind: "image" }],
      index: 0,
    });
  });
});
