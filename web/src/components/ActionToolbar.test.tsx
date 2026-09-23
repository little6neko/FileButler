import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { strings } from "../i18n";
import { ActionToolbar } from "./ActionToolbar";
import { createFileActions, createClipboardActions, type FileActionCommands } from "./fileActions";

it("places More before Delete and exposes only hidden actions", async () => {
  const onCopy = vi.fn();
  const shown = actions(1, commandMocks());
  const hidden = createClipboardActions({ selectedCount: 1, canPaste: false, canOpenInNewWindow: false, labels: strings.en, commands: { onCopy, onCut: vi.fn(), onPaste: vi.fn(), onOpenInNewWindow: vi.fn() } });
  render(<ActionToolbar actions={shown} moreActions={[...hidden, ...shown]} selectedCount={1} labels={strings.en} />);
  const buttons = screen.getAllByRole("button");
  expect(buttons.indexOf(screen.getByRole("button", { name: "More" }))).toBe(buttons.indexOf(screen.getByRole("button", { name: strings.en.delete })) - 1);
  await userEvent.click(screen.getByRole("button", { name: "More" }));
  expect(screen.queryByRole("menuitem", { name: strings.en.rename })).not.toBeInTheDocument();
  expect(await screen.findByRole("menuitem", { name: "Paste" })).toHaveAttribute("aria-disabled", "true");
  await userEvent.click(screen.getByRole("menuitem", { name: /^Copy$/ }));
  expect(onCopy).toHaveBeenCalledOnce();
});

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
