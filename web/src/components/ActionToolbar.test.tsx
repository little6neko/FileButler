import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { strings } from "../i18n";
import { ActionToolbar } from "./ActionToolbar";
import { createFileActions, type FileActionCommands } from "./fileActions";

it("labels transfer actions with the opposite pane", async () => {
  const commands = commandMocks();
  render(<ActionToolbar actions={actions(2, commands)} selectedCount={2} labels={strings.en} />);

  await userEvent.click(screen.getByRole("button", { name: "Copy to right pane" }));
  expect(commands.onOperation).toHaveBeenCalledWith("copy");
  expect(screen.getByRole("button", { name: "Move to right pane" })).toBeEnabled();
});

it("keeps rename limited to a single selection", () => {
  const commands = commandMocks();
  const { rerender } = render(<ActionToolbar actions={actions(0, commands)} selectedCount={0} labels={strings.en} />);
  expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();

  rerender(<ActionToolbar actions={actions(1, commands)} selectedCount={1} labels={strings.en} />);
  expect(screen.getByRole("button", { name: "Rename" })).toBeEnabled();
});

it("uses the same neutral variant for the first and other ordinary actions", () => {
  render(<ActionToolbar actions={actions(1, commandMocks())} selectedCount={1} labels={strings.en} />);

  expect(screen.getByRole("button", { name: "Copy to right pane" })).toHaveAttribute("data-variant", "outline");
  expect(screen.getByRole("button", { name: "Move to right pane" })).toHaveAttribute("data-variant", "outline");
  expect(screen.getByRole("button", { name: strings.en.delete })).toHaveAttribute("data-variant", "ghost");
  expect(screen.getByRole("button", { name: strings.en.delete })).toHaveClass("text-destructive");
});

function actions(selectedCount: number, commands: FileActionCommands) {
  return createFileActions({ destination: strings.en.rightPane, destinationDirection: "right", selectedCount, labels: strings.en, commands });
}

function commandMocks(): FileActionCommands {
  return {
    onOperation: vi.fn(),
    onLink: vi.fn(),
    onMkdir: vi.fn(),
    onRename: vi.fn(),
    onPowerRename: vi.fn(),
    onSuperRename: vi.fn(),
  };
}
