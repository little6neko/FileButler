import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { DialogFooter } from "./dialog";

it("provides a full-width muted footer without shrinking or adding a shadow", () => {
  render(<DialogFooter><button>Confirm</button></DialogFooter>);
  const footer = screen.getByRole("button").parentElement!;
  expect(footer).toHaveAttribute("data-slot", "dialog-footer");
  expect(footer).toHaveClass("-mx-4", "-mb-4", "border-t", "bg-muted/50", "p-4", "shrink-0");
  expect(footer.className).not.toContain("shadow");
});
