import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { MkdirContent, MkdirDialog } from "./MkdirDialog";

it("renders reusable mkdir content without a page dialog portal", async () => {
  const onSubmit = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  render(<MkdirContent titleId="local-mkdir-title" onClose={vi.fn()} onSubmit={onSubmit} />);

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Directory name" })).toHaveAttribute("id", "local-mkdir-title");
  await userEvent.type(screen.getByRole("textbox", { name: "Directory name" }), "assets");
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

  expect(onSubmit).toHaveBeenCalledWith("assets");
});

it("submits a trimmed directory name once and disables the dialog while pending", async () => {
  let resolveSubmit!: () => void;
  const onClose = vi.fn();
  const onSubmit = vi.fn(() => new Promise<void>((resolve) => {
    resolveSubmit = resolve;
  }));
  render(<MkdirDialog onClose={onClose} onSubmit={onSubmit} />);

  const dialog = screen.getByRole("dialog", { name: "Directory name" });
  const input = within(dialog).getByRole("textbox", { name: "Directory name" });
  const cancel = within(dialog).getByRole("button", { name: "Cancel" });
  const confirm = within(dialog).getByRole("button", { name: "Confirm" });
  await userEvent.type(input, "  assets  ");
  await userEvent.keyboard("{Enter}");

  expect(onSubmit).toHaveBeenCalledWith("assets");
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(input).toBeDisabled();
  expect(cancel).toBeDisabled();
  expect(confirm).toBeDisabled();
  expect(confirm.querySelector(".animate-spin")).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(onClose).not.toHaveBeenCalled();

  resolveSubmit();
  await waitFor(() => expect(input).not.toBeDisabled());
});

it("keeps the entered name and allows retry after submission fails", async () => {
  const onSubmit = vi
    .fn<(name: string) => Promise<void>>()
    .mockRejectedValueOnce(new Error("directory already exists"))
    .mockResolvedValueOnce(undefined);
  render(<MkdirDialog onClose={vi.fn()} onSubmit={onSubmit} />);

  const dialog = screen.getByRole("dialog", { name: "Directory name" });
  const input = within(dialog).getByRole("textbox", { name: "Directory name" });
  await userEvent.type(input, "assets");
  await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

  expect(await within(dialog).findByRole("alert")).toHaveTextContent("directory already exists");
  expect(input).toHaveValue("assets");
  expect(input).not.toBeDisabled();

  await userEvent.clear(input);
  await userEvent.type(input, "assets-2");
  await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  expect(onSubmit).toHaveBeenNthCalledWith(2, "assets-2");
});
