import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

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
