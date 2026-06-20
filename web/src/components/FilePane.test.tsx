import { fireEvent, render, screen, within } from "@testing-library/react";
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
      onSelectAll={vi.fn()}
      onRefresh={vi.fn()}
      onActivate={vi.fn()}
    />,
  );

  await userEvent.click(screen.getByLabelText("Select file.txt"));
  await userEvent.click(screen.getByRole("button", { name: "Clear" }));

  expect(onToggleSelection).toHaveBeenCalledWith("file.txt");
  expect(onClearSelection).toHaveBeenCalled();
});

it("selects all visible entries from the header checkbox", async () => {
  const onSelectAll = vi.fn();
  renderPane({
    entries: [entry("file.txt"), entry("folder", "directory")],
    selectedPaths: new Set(),
    onSelectAll,
  });

  await userEvent.click(screen.getByLabelText("Select all visible"));
  expect(onSelectAll).toHaveBeenCalledWith(true);
});

it("navigates to a typed path with Enter", async () => {
  const onPathChange = vi.fn();
  renderPane({ currentPath: ".", onPathChange });

  const input = screen.getByLabelText("Left pane path");
  await userEvent.clear(input);
  await userEvent.type(input, "photos/2026{Enter}");

  expect(onPathChange).toHaveBeenCalledWith("photos/2026");
});

it("displays non-root paths with a leading slash", () => {
  renderPane({ currentPath: "photos" });

  expect(screen.getByLabelText("Left pane path")).toHaveValue("/photos");
});

it("uses arrow keys to choose a directory suggestion", async () => {
  const onPathChange = vi.fn();
  renderPane({
    entries: [entry("photos", "directory"), entry("photo-file.txt"), entry("videos", "directory")],
    onPathChange,
  });

  const input = screen.getByLabelText("Left pane path");
  await userEvent.clear(input);
  await userEvent.type(input, "pho{ArrowDown}{Enter}");

  expect(onPathChange).toHaveBeenCalledWith("photos");
});

it("shows a slash root marker instead of a selector for one mapped root", () => {
  renderPane();

  expect(screen.queryByRole("combobox", { name: "Left pane root" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Left pane root")).toHaveTextContent("/");
  expect(screen.getByRole("button", { name: "/" })).toBeInTheDocument();
});

it("renders current path as clickable segments", async () => {
  const onPathChange = vi.fn();
  renderPane({ currentPath: "photos/2026/raw", onPathChange });

  await userEvent.click(screen.getByRole("button", { name: "photos" }));
  expect(onPathChange).toHaveBeenCalledWith("photos");

  await userEvent.click(screen.getByRole("button", { name: "2026" }));
  expect(onPathChange).toHaveBeenCalledWith("photos/2026");
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
      onSelectAll={vi.fn()}
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
      onSelectAll={vi.fn()}
      onRefresh={vi.fn()}
      onActivate={vi.fn()}
    />,
  );
  expect(screen.getByText(/target/)).toBeInTheDocument();
});

it("sorts visible entries when clicking a column header", async () => {
  renderPane({
    entries: [entry("b.txt"), entry("a.txt"), entry("folder", "directory")],
  });

  await userEvent.click(screen.getByRole("button", { name: "Name" }));

  const rows = within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row");
  expect(rows.map((row) => within(row).getAllByRole("cell")[1].textContent)).toEqual(["a.txt", "b.txt", "folder"]);
});

it("resizes columns by dragging a header divider", () => {
  renderPane();

  const table = screen.getByRole("table");
  const handle = screen.getByRole("separator", { name: "Resize Name column" });
  expect(table).toHaveStyle({ "--file-col-name": "220px" });

  fireEvent.mouseDown(handle, { clientX: 220 });
  fireEvent.mouseMove(document, { clientX: 280 });
  fireEvent.mouseUp(document);

  expect(table).toHaveStyle({ "--file-col-name": "280px" });
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

function renderPane(overrides: Partial<Parameters<typeof FilePane>[0]> = {}) {
  const props = {
    title: "Left pane",
    roots,
    selectedRootId: "data",
    currentPath: ".",
    entries: [entry("file.txt")],
    selectedPaths: new Set<string>(),
    onRootChange: vi.fn(),
    onPathChange: vi.fn(),
    onToggleSelection: vi.fn(),
    onClearSelection: vi.fn(),
    onSelectAll: vi.fn(),
    onRefresh: vi.fn(),
    onActivate: vi.fn(),
    ...overrides,
  };
  return render(<FilePane {...props} />);
}
