import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { strings } from "../i18n";
import { TextEditorConfirm } from "./TextEditorConfirm";

it("offers cancel, reload, and force overwrite for a disk conflict", async () => {
  const onCancel = vi.fn();
  const onReload = vi.fn();
  const onOverwrite = vi.fn();
  render(
    <TextEditorConfirm
      kind="conflict"
      titleId="conflict-title"
      fileName="notes.txt"
      labels={strings.en}
      busy={null}
      onCancel={onCancel}
      onReload={onReload}
      onOverwrite={onOverwrite}
    />,
  );

  expect(screen.getByRole("heading", { name: "File changed on disk" })).toHaveAttribute("id", "conflict-title");
  expect(screen.getByText(/notes\.txt was changed outside FileButler/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await userEvent.click(screen.getByRole("button", { name: "Reload" }));
  await userEvent.click(screen.getByRole("button", { name: "Overwrite anyway" }));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onReload).toHaveBeenCalledOnce();
  expect(onOverwrite).toHaveBeenCalledOnce();
});

it("locks every decision while a conflict action is running and shows its error", () => {
  render(
    <TextEditorConfirm
      kind="conflict"
      titleId="conflict-title"
      fileName="notes.txt"
      labels={strings.en}
      busy="reload"
      error="reload failed"
      onCancel={vi.fn()}
      onReload={vi.fn()}
      onOverwrite={vi.fn()}
    />,
  );

  expect(screen.getByRole("alert")).toHaveTextContent("reload failed");
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reload" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Overwrite anyway" })).toBeDisabled();
  expect(document.querySelector(".animate-spin")).not.toBeNull();
});

it("offers save, discard, and cancel for unsaved edits", async () => {
  const onCancel = vi.fn();
  const onSave = vi.fn();
  const onDiscard = vi.fn();
  render(
    <TextEditorConfirm
      kind="unsaved"
      titleId="unsaved-title"
      fileName="notes.txt"
      labels={strings.en}
      busy={false}
      onCancel={onCancel}
      onSave={onSave}
      onDiscard={onDiscard}
    />,
  );

  expect(screen.getByRole("heading", { name: "Unsaved changes" })).toHaveAttribute("id", "unsaved-title");
  expect(screen.getByText(/notes\.txt has changes that have not been saved/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await userEvent.click(screen.getByRole("button", { name: "Don't save" }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onDiscard).toHaveBeenCalledOnce();
  expect(onSave).toHaveBeenCalledOnce();
});
