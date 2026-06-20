import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { FilePane } from "./FilePane";

const roots = [{ id: "data", name: "Data" }];

it("supports selecting and clearing file selections", async () => {
  const onToggleSelection = vi.fn();
  const onClearSelection = vi.fn();
  render(
    <FilePane
      title="Left pane"
      roots={roots}
      selectedRootId="data"
      currentPath="."
      entries={[entry("file.txt")]}
      selectedPaths={new Set()}
      onRootChange={vi.fn()}
      onPathChange={vi.fn()}
      onToggleSelection={onToggleSelection}
      onClearSelection={onClearSelection}
      onRefresh={vi.fn()}
      onActivate={vi.fn()}
    />,
  );

  await userEvent.click(screen.getByLabelText("Select file.txt"));
  await userEvent.click(screen.getByRole("button", { name: "Clear" }));

  expect(onToggleSelection).toHaveBeenCalledWith("file.txt");
  expect(onClearSelection).toHaveBeenCalled();
});

it("navigates into a directory", async () => {
  const onPathChange = vi.fn();
  render(
    <FilePane
      title="Left pane"
      roots={roots}
      selectedRootId="data"
      currentPath="."
      entries={[entry("folder", "directory")]}
      selectedPaths={new Set()}
      onRootChange={vi.fn()}
      onPathChange={onPathChange}
      onToggleSelection={vi.fn()}
      onClearSelection={vi.fn()}
      onRefresh={vi.fn()}
      onActivate={vi.fn()}
    />,
  );

  await userEvent.dblClick(screen.getByText("folder"));
  expect(onPathChange).toHaveBeenCalledWith("folder");
});

it("renders symlink target metadata", () => {
  render(
    <FilePane
      title="Left pane"
      roots={roots}
      selectedRootId="data"
      currentPath="."
      entries={[{ ...entry("link", "symlink"), isSymlink: true, symlinkTarget: "target" }]}
      selectedPaths={new Set()}
      onRootChange={vi.fn()}
      onPathChange={vi.fn()}
      onToggleSelection={vi.fn()}
      onClearSelection={vi.fn()}
      onRefresh={vi.fn()}
      onActivate={vi.fn()}
    />,
  );
  expect(screen.getByText(/target/)).toBeInTheDocument();
});

function entry(name: string, type: "file" | "directory" | "symlink" | "other" = "file") {
  return {
    name,
    relativePath: name,
    type,
    size: 1,
    mode: "-rw-r--r--",
    modifiedUnix: 0,
    isSymlink: false,
  };
}
