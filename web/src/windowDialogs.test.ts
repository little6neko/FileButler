import { describe, expect, it } from "vitest";
import type { WindowDialogState } from "./windowDialogs";
import {
  clearAllWindowDialogs,
  clearWindowDialog,
  closeWindowDialog,
  openWindowDialog,
} from "./windowDialogs";

describe("window dialog state", () => {
  it("stores each dialog snapshot under its parent window", () => {
    const mkdir = dialog({
      dialogId: "dialog-1",
      windowId: "window-1",
      kind: "mkdir",
      rootId: "root-a",
      directoryPath: "photos",
    });
    const rename = dialog({
      dialogId: "dialog-2",
      windowId: "window-2",
      kind: "singleRename",
      rootId: "root-b",
      path: "old.txt",
      initialName: "old.txt",
      entryType: "file",
    });
    const operation = dialog({
      dialogId: "dialog-3",
      windowId: "window-3",
      kind: "operation",
      request: { type: "delete", sourceRoot: "root-c", sources: ["gone.txt"] },
    });

    const state = [mkdir, rename, operation].reduce(openWindowDialog, {});

    expect(state).toEqual({
      "window-1": mkdir,
      "window-2": rename,
      "window-3": operation,
    });
  });

  it("does not replace an existing dialog in the same window", () => {
    const current = openWindowDialog({}, dialog({
      dialogId: "dialog-1",
      windowId: "window-1",
      kind: "mkdir",
      rootId: "root",
      directoryPath: ".",
    }));

    const next = openWindowDialog(current, dialog({
      dialogId: "dialog-2",
      windowId: "window-1",
      kind: "operation",
      request: { type: "delete", sourceRoot: "root", sources: ["a.txt"] },
    }));

    expect(next).toBe(current);
    expect(next["window-1"]?.dialogId).toBe("dialog-1");
  });

  it("only closes the matching dialog instance", () => {
    const first = dialog({
      dialogId: "dialog-1",
      windowId: "window-1",
      kind: "mkdir",
      rootId: "root",
      directoryPath: ".",
    });
    const current = openWindowDialog({}, first);

    expect(closeWindowDialog(current, "window-1", "stale-dialog")).toBe(current);
    expect(closeWindowDialog(current, "window-1", first.dialogId)).toEqual({});
  });

  it("clears one parent window or every parent window", () => {
    const first = dialog({
      dialogId: "dialog-1",
      windowId: "window-1",
      kind: "mkdir",
      rootId: "root",
      directoryPath: ".",
    });
    const second = dialog({
      dialogId: "dialog-2",
      windowId: "window-2",
      kind: "operation",
      request: { type: "copy", sourceRoot: "a", sources: ["a.txt"], destRoot: "b", destPath: "." },
      clearMoveClipboard: false,
    });
    const current = openWindowDialog(openWindowDialog({}, first), second);

    expect(clearWindowDialog(current, "window-1")).toEqual({ "window-2": second });
    expect(clearWindowDialog(current, "missing")).toBe(current);
    expect(clearAllWindowDialogs(current)).toEqual({});
    expect(clearAllWindowDialogs({})).toEqual({});
  });
});

function dialog<T extends WindowDialogState>(value: T) {
  return value;
}
