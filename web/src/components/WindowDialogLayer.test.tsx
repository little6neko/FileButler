import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { WindowDialogLayer } from "./WindowDialogLayer";

it("renders an accessible window-local dialog without declaring a page modal", async () => {
  render(
    <WindowDialogLayer labelledBy="local-title" size="compact" onClose={vi.fn()}>
      <h2 id="local-title">Rename</h2>
      <button type="button">Confirm</button>
    </WindowDialogLayer>,
  );

  const dialog = screen.getByRole("dialog", { name: "Rename" });
  expect(dialog).not.toHaveAttribute("aria-modal");
  expect(dialog).toHaveAttribute("data-window-dialog-size", "compact");
  await waitFor(() => expect(dialog).toHaveFocus());
});

it("preserves a child autofocus target", async () => {
  render(
    <WindowDialogLayer labelledBy="local-title" onClose={vi.fn()}>
      <h2 id="local-title">New folder</h2>
      <input aria-label="Name" autoFocus />
    </WindowDialogLayer>,
  );

  await waitFor(() => expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus());
});

it("closes for Escape or a backdrop click but not a panel click", async () => {
  const onClose = vi.fn();
  const { container } = render(
    <WindowDialogLayer labelledBy="local-title" onClose={onClose}>
      <h2 id="local-title">Delete</h2>
      <button type="button">Confirm</button>
    </WindowDialogLayer>,
  );

  const dialog = screen.getByRole("dialog", { name: "Delete" });
  await userEvent.click(dialog);
  expect(onClose).not.toHaveBeenCalled();

  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);

  fireEvent.pointerDown(container.querySelector(".window-dialog-layer")!);
  expect(onClose).toHaveBeenCalledTimes(2);
});

it("wraps Tab focus at both ends of the local panel", () => {
  render(
    <WindowDialogLayer labelledBy="local-title" onClose={vi.fn()}>
      <h2 id="local-title">Move</h2>
      <button type="button">First</button>
      <button type="button">Last</button>
    </WindowDialogLayer>,
  );

  const first = screen.getByRole("button", { name: "First" });
  const last = screen.getByRole("button", { name: "Last" });
  first.focus();
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  expect(last).toHaveFocus();

  fireEvent.keyDown(last, { key: "Tab" });
  expect(first).toHaveFocus();
});
