import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { strings } from "../i18n";
import { ActionToolbar } from "./ActionToolbar";

it("labels transfer actions with the opposite pane", async () => {
  const onOperation = vi.fn();
  render(
    <ActionToolbar
      activePane="left"
      selectedCount={2}
      onOperation={onOperation}
      onMkdir={vi.fn()}
      onRename={vi.fn()}
      onPowerRename={vi.fn()}
      labels={strings.en}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Copy to right pane" }));
  expect(onOperation).toHaveBeenCalledWith("copy");
  expect(screen.getByRole("button", { name: "Move to right pane" })).toBeEnabled();
});

it("keeps rename limited to a single selection", () => {
  const props = {
    activePane: "left" as const,
    onOperation: vi.fn(),
    onMkdir: vi.fn(),
    onRename: vi.fn(),
    onPowerRename: vi.fn(),
    labels: strings.en,
  };
  const { rerender } = render(<ActionToolbar {...props} selectedCount={0} />);
  expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();

  rerender(<ActionToolbar {...props} selectedCount={1} />);
  expect(screen.getByRole("button", { name: "Rename" })).toBeEnabled();
});
