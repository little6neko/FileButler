import { expect, it, vi } from "vitest";
import { strings } from "../i18n";
import { createFileActions } from "./fileActions";

it("creates every toolbar action in display order", () => {
  const actions = createFileActions({
    destination: strings.en.rightPane,
    selectedCount: 2,
    labels: strings.en,
    commands: commands(),
  });

  expect(actions.map((action) => action.id)).toEqual([
    "copy", "move", "symlink", "hardlink", "mkdir", "rename", "powerRename", "delete",
  ]);
  expect(actions.find((action) => action.id === "mkdir")?.separatorBefore).toBe(true);
  expect(actions.find((action) => action.id === "delete")?.separatorBefore).toBe(true);
});

it("uses the same enabled predicates as the existing toolbar", () => {
  const none = createFileActions({ destination: "Right pane", selectedCount: 0, labels: strings.en, commands: commands() });
  expect(none.find((action) => action.id === "mkdir")?.disabled).toBe(false);
  expect(none.filter((action) => action.id !== "mkdir").every((action) => action.disabled)).toBe(true);

  const one = createFileActions({ destination: "Right pane", selectedCount: 1, labels: strings.en, commands: commands() });
  expect(one.find((action) => action.id === "rename")?.disabled).toBe(false);

  const many = createFileActions({ destination: "Right pane", selectedCount: 2, labels: strings.en, commands: commands() });
  expect(many.find((action) => action.id === "rename")?.disabled).toBe(true);
  expect(many.find((action) => action.id === "powerRename")?.disabled).toBe(false);
});

it("dispatches commands from the shared descriptors", () => {
  const handlers = commands();
  const actions = createFileActions({ destination: "Right pane", selectedCount: 1, labels: strings.en, commands: handlers });

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
