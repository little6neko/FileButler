import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { FilePane } from "./FilePane";

const roots = [{ id: "data", name: "Data" }];

it("supports selecting file entries", async () => {
  const onToggleSelection = vi.fn();
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
      onSelectAll={vi.fn()}
      onRefresh={vi.fn()}
      onActivate={vi.fn()}
    />,
  );

  await userEvent.click(screen.getByLabelText("Select file.txt"));

  expect(onToggleSelection).toHaveBeenCalledWith("file.txt");
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
      onSelectAll={vi.fn()}
      onRefresh={vi.fn()}
      onActivate={vi.fn()}
    />,
  );

  await userEvent.dblClick(screen.getByText("folder"));
  expect(onPathChange).toHaveBeenCalledWith("folder");
});

it("marks directory rows as clickable", () => {
  renderPane({
    entries: [entry("folder", "directory"), entry("file.txt")],
  });

  expect(screen.getByText("folder").closest("tr")).toHaveClass("directory-row");
  expect(screen.getByText("file.txt").closest("tr")).not.toHaveClass("directory-row");
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
      onSelectAll={vi.fn()}
      onRefresh={vi.fn()}
      onActivate={vi.fn()}
    />,
  );
  expect(screen.getByText(/target/)).toBeInTheDocument();
});

it("sorts visible entries when clicking a column header", async () => {
  renderPane({
    entries: [entry("b.txt", "file", 2), entry("a.txt", "file", 1), entry("folder", "directory", 0)],
  });

  await userEvent.click(screen.getByRole("button", { name: "Size" }));

  expect(visibleEntryNames()).toEqual(["folder", "a.txt", "b.txt"]);
});

it("sorts by name ascending with directories first by default", () => {
  renderPane({
    entries: [entry("b.txt"), entry("a-link", "symlink"), entry("c-other", "other"), entry("folder", "directory")],
  });

  expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "ascending");
  expect(visibleEntryNames()).toEqual(["folder", "a-link", "b.txt", "c-other"]);
});

it("puts non-directories first when sorting names from Z to A", async () => {
  renderPane({
    entries: [
      entry("b-file"),
      entry("y-link", "symlink"),
      entry("m-other", "other"),
      entry("a-folder", "directory"),
      entry("z-folder", "directory"),
    ],
  });

  await userEvent.click(screen.getByRole("button", { name: "Name" }));

  expect(visibleEntryNames()).toEqual(["y-link", "m-other", "b-file", "z-folder", "a-folder"]);
});

it("keeps directories first when sorting another column descending", async () => {
  renderPane({
    entries: [
      entry("file-small", "file", 2),
      entry("dir-small", "directory", 1),
      entry("file-large", "file", 10),
      entry("dir-large", "directory", 9),
    ],
  });

  await userEvent.click(screen.getByRole("button", { name: "Size" }));
  await userEvent.click(screen.getByRole("button", { name: "Size" }));

  expect(visibleEntryNames()).toEqual(["dir-large", "dir-small", "file-large", "file-small"]);
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

it("locks the selection column to checkbox-only and keeps it non-resizable", () => {
  renderPane();

  expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  expect(screen.queryByRole("separator", { name: "Resize Selection column" })).not.toBeInTheDocument();
});

it("marks selection cells for checkbox-only styling", () => {
  renderPane();

  const headerCell = screen.getByLabelText("Select all visible").closest("th");
  const bodyCell = screen.getByLabelText("Select file.txt").closest("td");

  expect(headerCell).toHaveClass("select-cell");
  expect(bodyCell).toHaveClass("select-cell");
});

it("renders file sizes with units", () => {
  renderPane({ entries: [entry("small.txt", "file", 1), entry("large.bin", "file", 1536)] });

  expect(screen.getByText("1 B")).toBeInTheDocument();
  expect(screen.getByText("1.5 KB")).toBeInTheDocument();
});

it("lets the name column fill remaining table width while staying resizable", async () => {
  const clientWidth = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  renderPane();

  const table = screen.getByRole("table");
  const columns = table.querySelectorAll("col");

  await waitFor(() => expect(table).toHaveStyle({ "--file-col-name": "420px", "--file-col-modified": "140px", "--file-table-width": "776px" }));
  expect(table).toHaveStyle({ width: "var(--file-table-width)", minWidth: "776px" });
  expect(columns[0]).toHaveStyle({ width: "var(--file-col-select)" });
  expect(columns[1]).toHaveStyle({ width: "var(--file-col-name)" });
  expect(columns[2]).toHaveStyle({ width: "var(--file-col-type)" });
  expect(columns[3]).toHaveStyle({ width: "var(--file-col-size)" });
  expect(columns[4]).toHaveStyle({ width: "var(--file-col-modified)" });
  clientWidth.mockRestore();
});

it("replaces selection with rows intersecting a drag marquee", () => {
  const onSelectPaths = vi.fn();
  const { container } = renderPane({
    entries: [entry("a.txt"), entry("b.txt"), entry("c.txt")],
    selectedPaths: new Set(["c.txt"]),
    onSelectPaths,
  });

  const fileList = container.querySelector(".file-list") as HTMLDivElement;
  const rows = within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row");
  mockRect(fileList, { left: 0, top: 0, right: 400, bottom: 160, width: 400, height: 160 });
  rows.forEach((row, index) => {
    mockRect(row, { left: 0, top: 32 + index * 32, right: 376, bottom: 64 + index * 32, width: 376, height: 32 });
  });

  fireEvent.mouseDown(fileList, { button: 0, clientX: 376, clientY: 36 });
  fireEvent.mouseMove(document, { clientX: 380, clientY: 94 });

  expect(container.querySelector(".drag-selection-box")).toBeInTheDocument();

  fireEvent.mouseUp(document, { clientX: 380, clientY: 94 });

  expect(onSelectPaths).toHaveBeenCalledWith(["a.txt", "b.txt"]);
});

it("excludes a row that only touches the drag marquee edge", () => {
  const onSelectPaths = vi.fn();
  const { container } = renderPane({
    entries: [entry("a.txt"), entry("b.txt")],
    onSelectPaths,
  });

  const fileList = container.querySelector(".file-list") as HTMLDivElement;
  const rows = within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row");
  mockRect(fileList, { left: 0, top: 0, right: 400, bottom: 160, width: 400, height: 160 });
  mockRect(rows[0], { left: 0, top: 32, right: 376, bottom: 64, width: 376, height: 32 });
  mockRect(rows[1], { left: 0, top: 94, right: 376, bottom: 126, width: 376, height: 32 });

  fireEvent.mouseDown(fileList, { button: 0, clientX: 376, clientY: 36 });
  fireEvent.mouseMove(document, { clientX: 380, clientY: 94 });
  fireEvent.mouseUp(document);

  expect(onSelectPaths).toHaveBeenCalledWith(["a.txt"]);
});

it("does not start drag marquee from file controls", () => {
  const onSelectPaths = vi.fn();
  const { container } = renderPane({ entries: [entry("a.txt")], onSelectPaths });
  const fileList = container.querySelector(".file-list") as HTMLDivElement;
  const row = within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row")[0];
  mockRect(fileList, { left: 0, top: 0, right: 400, bottom: 96, width: 400, height: 96 });
  mockRect(row, { left: 0, top: 32, right: 376, bottom: 64, width: 376, height: 32 });

  fireEvent.mouseDown(screen.getByLabelText("Select a.txt"), { button: 0, clientX: 10, clientY: 40 });
  fireEvent.mouseMove(document, { clientX: 380, clientY: 60 });
  fireEvent.mouseUp(document);

  expect(onSelectPaths).not.toHaveBeenCalled();
  expect(container.querySelector(".drag-selection-box")).not.toBeInTheDocument();
});

it("renders compact rows and a status footer", () => {
  renderPane({
    entries: [entry("a.txt", "file", 1024), entry("b.txt", "file", 512)],
    selectedPaths: new Set(["a.txt", "b.txt"]),
    isActive: true,
  });

  expect(screen.getByRole("region", { name: "Left pane" })).toHaveAttribute("data-active", "true");
  expect(screen.getAllByRole("row")[1]).toHaveAttribute("data-density", "compact");
  expect(screen.getByText("2 selected")).toBeInTheDocument();
  expect(screen.getByText("1.5 KB")).toBeInTheDocument();
  expect(screen.getByText("2 items")).toBeInTheDocument();
});

it("keeps the active state distinguishable without relying only on color", () => {
  renderPane({ isActive: true });

  expect(screen.getByRole("region", { name: "Left pane" })).toHaveAttribute("aria-current", "true");
});

it("renders a loading skeleton while browsing", () => {
  renderPane({ entries: [], loading: true });
  expect(screen.getByTestId("pane-loading")).toBeInTheDocument();
});

it("renders an empty directory message", () => {
  renderPane({ entries: [], loading: false, error: null });
  expect(screen.getByText("This directory is empty")).toBeInTheDocument();
});

it("renders browse failures inside the pane", () => {
  renderPane({ entries: [], loading: false, error: "permission denied" });
  expect(screen.getByRole("alert")).toHaveTextContent("permission denied");
});

function entry(name: string, type: "file" | "directory" | "symlink" | "other" = "file", size = 1) {
  return {
    name,
    relativePath: name,
    type,
    size,
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
    onSelectAll: vi.fn(),
    onSelectPaths: vi.fn(),
    onRefresh: vi.fn(),
    onActivate: vi.fn(),
    ...overrides,
  };
  return render(<FilePane {...props} />);
}

function visibleEntryNames() {
  const rows = within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row");
  return rows.map((row) => within(row).getAllByRole("cell")[1].textContent);
}

function mockRect(element: Element, rect: Omit<DOMRect, "toJSON" | "x" | "y"> & Partial<Pick<DOMRect, "x" | "y">>) {
  const browserRect = new DOMRect(rect.x ?? rect.left, rect.y ?? rect.top, rect.width, rect.height);
  element.getBoundingClientRect = vi.fn(() => browserRect);
}
