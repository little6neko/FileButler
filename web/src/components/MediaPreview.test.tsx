import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MediaPreview } from "./MediaPreview";

it("renders image content in a named dialog", () => {
  render(<MediaPreview name="photo.jpg" url="/photo.jpg" kind="image" onClose={vi.fn()} />);

  expect(screen.getByRole("dialog", { name: "Media preview" })).toHaveClass("sm:max-w-5xl");
  expect(screen.getByRole("img", { name: "photo.jpg" })).toHaveAttribute("src", "/photo.jpg");
});
