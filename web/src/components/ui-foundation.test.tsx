import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table } from "@/components/ui/table";

it("renders shadcn buttons and an accessible dialog", async () => {
  const onOpenChange = vi.fn();
  render(
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Operation preview</DialogTitle>
        <Button variant="destructive">Delete</Button>
      </DialogContent>
    </Dialog>,
  );

  expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute("data-variant", "destructive");
  expect(screen.getByRole("dialog", { name: "Operation preview" })).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(onOpenChange.mock.calls[0]?.[0]).toBe(false);
});

it("leaves vertical paint room for low input glyphs", () => {
  render(<Input aria-label="Name" value="a_b_c.txt" readOnly />);

  const input = screen.getByRole("textbox", { name: "Name" });
  expect(input).toHaveValue("a_b_c.txt");
  expect(input).toHaveClass("h-8", "font-sans", "pt-0", "pb-px", "leading-5");
  expect(input).not.toHaveClass("py-0", "py-1");
});

it("allows a parent to own table overflow without changing the default", () => {
  const { rerender } = render(<Table aria-label="Default table" />);

  const defaultContainer = screen.getByRole("table", { name: "Default table" }).parentElement;
  expect(defaultContainer).toHaveClass("overflow-x-auto");

  rerender(<Table aria-label="Parent-owned table" containerClassName="overflow-visible" />);

  const overriddenContainer = screen.getByRole("table", { name: "Parent-owned table" }).parentElement;
  expect(overriddenContainer).toHaveClass("overflow-visible");
  expect(overriddenContainer).not.toHaveClass("overflow-x-auto");
});
