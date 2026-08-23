import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MediaPreview, MediaPreviewContent } from "./MediaPreview";

it("renders image content in a named dialog", () => {
  render(<MediaPreview name="photo.jpg" url="/photo.jpg" kind="image" onClose={vi.fn()} />);

  expect(screen.getByRole("dialog", { name: "Media preview" })).toHaveClass("sm:max-w-5xl");
  expect(screen.getByRole("img", { name: "photo.jpg" })).toHaveAttribute("src", "/photo.jpg");
});

it("renders reusable video content with native controls", () => {
  render(<MediaPreviewContent name="clip.mp4" url="/clip.mp4" kind="video" />);

  const content = screen.getByTestId("media-preview-content");
  expect(content).toHaveClass("media-preview-content");
  expect(screen.getByLabelText("clip.mp4")).toHaveAttribute("src", "/clip.mp4");
  expect(screen.getByLabelText("clip.mp4")).toHaveAttribute("controls");
  expect(screen.getByLabelText("clip.mp4")).not.toHaveAttribute("autoplay");
});
