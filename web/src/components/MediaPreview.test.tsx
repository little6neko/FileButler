import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { MediaPreview, MediaPreviewContent } from "./MediaPreview";

it("renders image content in a named dialog", () => {
  render(<MediaPreview name="photo.jpg" url="/photo.jpg" kind="image" onClose={vi.fn()} />);

  expect(screen.getByRole("dialog", { name: "Media preview" })).toHaveClass("media-preview-dialog", "sm:max-w-5xl");
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

it("renders fading gallery controls with disabled boundaries and remounts switched media", async () => {
  const onPrevious = vi.fn();
  const onNext = vi.fn();
  const { rerender } = render(
    <MediaPreviewContent
      name="first.png"
      url="/first.png"
      kind="image"
      mediaKey="first.png"
      canPrevious={false}
      canNext
      previousLabel="Previous media"
      nextLabel="Next media"
      onPrevious={onPrevious}
      onNext={onNext}
    />,
  );

  const previous = screen.getByRole("button", { name: "Previous media" });
  const next = screen.getByRole("button", { name: "Next media" });
  expect(previous).toBeDisabled();
  expect(next).toBeEnabled();
  await userEvent.click(previous);
  await userEvent.click(next);
  expect(onPrevious).not.toHaveBeenCalled();
  expect(onNext).toHaveBeenCalledTimes(1);

  const firstImage = screen.getByRole("img", { name: "first.png" });
  rerender(
    <MediaPreviewContent
      name="second.png"
      url="/second.png"
      kind="image"
      mediaKey="second.png"
      canPrevious
      canNext={false}
      previousLabel="Previous media"
      nextLabel="Next media"
      onPrevious={onPrevious}
      onNext={onNext}
    />,
  );
  expect(screen.getByRole("img", { name: "second.png" })).not.toBe(firstImage);
  expect(screen.getByRole("button", { name: "Previous media" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Next media" })).toBeDisabled();
});
