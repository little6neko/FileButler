import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { confirmDialogOnEnter } from "./dialogConfirm";

function Harness({
  enabled = true,
  onConfirm,
  preventInputEnter = false,
}: {
  enabled?: boolean;
  onConfirm(): void;
  preventInputEnter?: boolean;
}) {
  return (
    <div
      data-testid="dialog"
      tabIndex={-1}
      onKeyDown={(event) => confirmDialogOnEnter(event, enabled, onConfirm)}
    >
      <input
        aria-label="Name"
        onKeyDown={preventInputEnter ? (event) => event.preventDefault() : undefined}
      />
      <button type="button">Other action</button>
      <a href="#target">Link</a>
      <input type="checkbox" aria-label="Choice" />
      <input type="radio" aria-label="Mode" />
      <div role="option" tabIndex={0}>Preset option</div>
      <textarea aria-label="Notes" />
      <div aria-label="Editor" contentEditable tabIndex={0} />
    </div>
  );
}

it("confirms Enter from dialog content and text inputs", async () => {
  const onConfirm = vi.fn();
  render(<Harness onConfirm={onConfirm} />);

  screen.getByTestId("dialog").focus();
  await userEvent.keyboard("{Enter}");
  screen.getByLabelText("Name").focus();
  await userEvent.keyboard("{Enter}");

  expect(onConfirm).toHaveBeenCalledTimes(2);
});

it("ignores disabled, consumed, composing, repeated, and specific-control Enter", async () => {
  const onConfirm = vi.fn();
  const view = render(<Harness enabled={false} onConfirm={onConfirm} />);
  screen.getByLabelText("Name").focus();
  await userEvent.keyboard("{Enter}");

  view.rerender(<Harness onConfirm={onConfirm} preventInputEnter />);
  screen.getByLabelText("Name").focus();
  await userEvent.keyboard("{Enter}");

  view.rerender(<Harness onConfirm={onConfirm} />);
  fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" });
  fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter", isComposing: true });
  fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter", repeat: true });

  for (const control of [
    screen.getByRole("button", { name: "Other action" }),
    screen.getByRole("link", { name: "Link" }),
    screen.getByRole("checkbox", { name: "Choice" }),
    screen.getByRole("radio", { name: "Mode" }),
    screen.getByRole("option", { name: "Preset option" }),
    screen.getByRole("textbox", { name: "Notes" }),
    screen.getByLabelText("Editor"),
  ]) {
    control.focus();
    await userEvent.keyboard("{Enter}");
  }

  expect(onConfirm).not.toHaveBeenCalled();
});
