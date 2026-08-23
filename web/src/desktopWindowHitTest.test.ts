import { expect, it } from "vitest";
import { powerRenameCoversPoint } from "./desktopWindowHitTest";

it("blocks file drops only when the top desktop window is PowerRename", () => {
  const fileWindow = document.createElement("section");
  fileWindow.className = "desktop-window";
  fileWindow.dataset.windowKind = "file";
  const fileContent = document.createElement("div");
  fileWindow.append(fileContent);

  const powerRenameWindow = document.createElement("section");
  powerRenameWindow.className = "desktop-window";
  powerRenameWindow.dataset.windowKind = "powerRename";
  const powerRenameContent = document.createElement("div");
  powerRenameWindow.append(powerRenameContent);

  expect(powerRenameCoversPoint(10, 20, () => [powerRenameContent, fileContent])).toBe(true);
  expect(powerRenameCoversPoint(10, 20, () => [fileContent, powerRenameContent])).toBe(false);
  expect(powerRenameCoversPoint(10, 20, () => [])).toBe(false);
});
