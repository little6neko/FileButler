import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { MkdirDialog } from "./MkdirDialog";

it("submits a trimmed directory name from an accessible dialog", async () => {
  const onSubmit = vi.fn();
  render(<MkdirDialog onClose={vi.fn()} onSubmit={onSubmit} />);

  const dialog = screen.getByRole("dialog", { name: "Directory name" });
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Directory name" }), "  assets  ");
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

  expect(dialog).toBeInTheDocument();
  expect(onSubmit).toHaveBeenCalledWith("assets");
});
