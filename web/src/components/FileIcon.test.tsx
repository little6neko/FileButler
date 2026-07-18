import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { FileIcon } from "./FileIcon";

it("uses distinct hidden icons for folders and files", () => {
  const { rerender } = render(<FileIcon name="photos" type="directory" />);
  expect(screen.getByTestId("file-icon-directory")).toHaveAttribute("aria-hidden", "true");

  rerender(<FileIcon name="notes.txt" type="file" />);
  expect(screen.getByTestId("file-icon-file")).toHaveAttribute("aria-hidden", "true");
});
