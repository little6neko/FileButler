import { MoveLeft, MoveRight } from "lucide-react";
import { expect, it, vi } from "vitest";
import { strings } from "../i18n";
import { createClipboardActions, createFileActions, createWindowFileActions } from "./fileActions";

it("creates every toolbar action in display order", () => {
  const actions = createFileActions({
    destination: strings.en.rightPane,
    destinationDirection: "right",
    selectedCount: 2,
    labels: strings.en,
    commands: commands(),
  });

  expect(actions.map((action) => action.id)).toEqual([
    "copy", "move", "symlink", "hardlink", "rename", "powerRename", "mkdir", "delete",
  ]);
  expect(actions.find((action) => action.id === "rename")?.separatorBefore).toBe(true);
  expect(actions.find((action) => action.id === "delete")?.separatorBefore).toBe(true);
});

it("points the move icon toward the destination pane", () => {
  const left = createFileActions({
    destination: strings.en.leftPane,
    destinationDirection: "left",
    selectedCount: 1,
    labels: strings.en,
    commands: commands(),
  });
  const right = createFileActions({
    destination: strings.en.rightPane,
    destinationDirection: "right",
    selectedCount: 1,
    labels: strings.en,
    commands: commands(),
  });

  expect(left.find((action) => action.id === "move")?.icon).toBe(MoveLeft);
  expect(right.find((action) => action.id === "move")?.icon).toBe(MoveRight);
  expect(left.find((action) => action.id === "copy")?.icon).toBe(right.find((action) => action.id === "copy")?.icon);
});

it("creates full-mode toolbar and clipboard actions in their display order", () => {
  const toolbar = createWindowFileActions({
    selectedCount: 1,
    locationReady: true,
    labels: strings.en,
    commands: commands(),
  });
  const clipboard = createClipboardActions({
    selectedCount: 1,
    canPaste: true,
    canOpenInNewWindow: true,
    labels: strings.en,
    commands: {
      onCopy: vi.fn(),
      onCut: vi.fn(),
      onPaste: vi.fn(),
      onOpenInNewWindow: vi.fn(),
    },
  });

  expect(toolbar.map((action) => action.id)).toEqual(["rename", "powerRename", "mkdir", "delete"]);
  expect(clipboard.map((action) => action.id)).toEqual([
    "openInNewWindow", "clipboardCopy", "clipboardCut", "clipboardPaste",
  ]);
  expect(clipboard.every((action) => !action.separatorBefore)).toBe(true);
});

it("uses the same enabled predicates as the existing toolbar", () => {
  const none = createFileActions({ destination: "Right pane", destinationDirection: "right", selectedCount: 0, labels: strings.en, commands: commands() });
  expect(none.find((action) => action.id === "mkdir")?.disabled).toBe(false);
  expect(none.filter((action) => action.id !== "mkdir").every((action) => action.disabled)).toBe(true);

  const one = createFileActions({ destination: "Right pane", destinationDirection: "right", selectedCount: 1, labels: strings.en, commands: commands() });
  expect(one.find((action) => action.id === "rename")?.disabled).toBe(false);

  const many = createFileActions({ destination: "Right pane", destinationDirection: "right", selectedCount: 2, labels: strings.en, commands: commands() });
  expect(many.find((action) => action.id === "rename")?.disabled).toBe(true);
  expect(many.find((action) => action.id === "powerRename")?.disabled).toBe(false);
});

it("dispatches commands from the shared descriptors", () => {
  const handlers = commands();
  const actions = createFileActions({ destination: "Right pane", destinationDirection: "right", selectedCount: 1, labels: strings.en, commands: handlers });

  actions.find((action) => action.id === "copy")?.run();
  actions.find((action) => action.id === "rename")?.run();
  expect(handlers.onOperation).toHaveBeenCalledWith("copy");
  expect(handlers.onRename).toHaveBeenCalledOnce();
});

function commands() {
  return {
    onOperation: vi.fn(),
    onMkdir: vi.fn(),
    onRename: vi.fn(),
    onPowerRename: vi.fn(),
  };
}
