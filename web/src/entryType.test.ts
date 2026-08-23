import { describe, expect, it } from "vitest";
import type { Entry } from "./api/types";
import { entryTypeLabel } from "./entryType";

const labels = {
  entryFolderType: "Folder",
  entryFileType: "File",
  entrySymlinkType: "Symbolic link",
  entryOtherType: "Other",
};

describe("entry type labels", () => {
  it.each([
    [entry("photos", "directory"), "Folder"],
    [entry("PHOTO.JPG"), "jpg"],
    [entry("archive.tar.gz"), "gz"],
    [entry("LICENSE"), "File"],
    [entry(".gitignore"), "File"],
    [entry("trailing."), "File"],
    [entry("photo.jpg", "symlink"), "Symbolic link"],
    [entry("socket", "other"), "Other"],
  ])("formats $0", (item, expected) => {
    expect(entryTypeLabel(item, labels)).toBe(expected);
  });
});

function entry(name: string, type: Entry["type"] = "file"): Entry {
  return { name, relativePath: name, type, size: 1, mode: "", modifiedUnix: 0, isSymlink: type === "symlink" };
}
