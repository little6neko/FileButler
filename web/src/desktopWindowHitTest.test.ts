import { expect, it } from "vitest";
import { applicationWindowCoversPoint } from "./desktopWindowHitTest";

it("blocks file drops when the top desktop window is an application window", () => {
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

  const superRenameWindow = document.createElement("section");
  superRenameWindow.className = "desktop-window";
  superRenameWindow.dataset.windowKind = "superRename";
  const superRenameContent = document.createElement("div");
  superRenameWindow.append(superRenameContent);

  expect(applicationWindowCoversPoint(10, 20, () => [powerRenameContent, fileContent])).toBe(true);
  expect(applicationWindowCoversPoint(10, 20, () => [superRenameContent, fileContent])).toBe(true);
  expect(applicationWindowCoversPoint(10, 20, () => [fileContent, superRenameContent])).toBe(false);
  expect(applicationWindowCoversPoint(10, 20, () => [])).toBe(false);
});
