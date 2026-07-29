import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { paneDropId, type FileDropFeedback } from "../fileDrag";
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

it("treats a row gesture below the marquee threshold as a selection click", () => {
  const onSelectEntry = vi.fn();
  const { container } = renderPane({
    entries: [entry("a.txt"), entry("b.txt")],
    onSelectEntry,
  });
  const fileList = container.querySelector(".file-list") as HTMLDivElement;
  const rows = within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row");
  const typeCell = within(rows[0]).getAllByRole("cell")[2];
  mockRect(fileList, { left: 0, top: 0, right: 400, bottom: 160, width: 400, height: 160 });
  rows.forEach((row, index) => {
    mockRect(row, { left: 0, top: 32 + index * 32, right: 376, bottom: 64 + index * 32, width: 376, height: 32 });
  });

  fireEvent.mouseDown(typeCell, { button: 0, clientX: 250, clientY: 40 });
  fireEvent.mouseMove(document, { clientX: 252, clientY: 41 });
  fireEvent.mouseUp(document, { clientX: 252, clientY: 41, ctrlKey: true });

  expect(onSelectEntry).toHaveBeenCalledWith("a.txt", { ctrlKey: true, shiftKey: false });
  expect(container.querySelector(".drag-selection-box")).not.toBeInTheDocument();
});

it("turns a moved row gesture into marquee selection without emitting a row click", () => {
  const onSelectEntry = vi.fn();
  const onSelectPaths = vi.fn();
  const { container } = renderPane({ entries: [entry("a.txt"), entry("b.txt")], onSelectEntry, onSelectPaths });
  const fileList = container.querySelector(".file-list") as HTMLDivElement;
  const rows = within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row");
  const sizeCell = within(rows[0]).getAllByRole("cell")[3];
  mockRect(fileList, { left: 0, top: 0, right: 400, bottom: 160, width: 400, height: 160 });
  rows.forEach((row, index) => {
    mockRect(row, { left: 0, top: 32 + index * 32, right: 376, bottom: 64 + index * 32, width: 376, height: 32 });
  });

  fireEvent.mouseDown(sizeCell, { button: 0, clientX: 280, clientY: 40 });
  fireEvent.mouseMove(document, { clientX: 288, clientY: 94 });
  fireEvent.mouseUp(document, { clientX: 288, clientY: 94 });

  expect(onSelectPaths).toHaveBeenCalledWith(["a.txt", "b.txt"]);
  expect(onSelectEntry).not.toHaveBeenCalled();
});

it("selects from a short icon-and-name click with its modifier state", () => {
  const onSelectEntry = vi.fn();
  renderPane({ onSelectEntry });
  const handle = screen.getByText("file.txt").closest("[data-file-drag-handle]");
  if (!handle) throw new Error("file drag handle was not rendered");

  fireEvent.click(handle, { ctrlKey: true, shiftKey: true });

  expect(onSelectEntry).toHaveBeenCalledWith("file.txt", { ctrlKey: true, shiftKey: true });
});

it("exposes row selection state without changing checkbox behavior", async () => {
  const onSelectEntry = vi.fn();
  const onToggleSelection = vi.fn();
  renderPane({ selectedPaths: new Set(["file.txt"]), onSelectEntry, onToggleSelection });
  const row = screen.getByText("file.txt").closest("tr");

  expect(row).toHaveAttribute("aria-selected", "true");
  await userEvent.click(screen.getByLabelText("Select file.txt"));
  expect(onToggleSelection).toHaveBeenCalledWith("file.txt");
  expect(onSelectEntry).not.toHaveBeenCalled();
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

it("renders path separators outside the clickable folder controls", () => {
  const { container } = renderPane({ currentPath: "photos/2026/raw" });
  const nav = screen.getByRole("navigation", { name: "Left pane segments" });

  expect(within(nav).getAllByRole("button").map((button) => button.textContent)).toEqual(["/", "photos", "2026", "raw"]);
  expect(container.querySelectorAll(".path-separator")).toHaveLength(3);
});

it("keeps fixed folders and the newest ancestors visible in a narrow pane", async () => {
  const restoreMeasurements = mockBreadcrumbMeasurements(280);
  try {
    renderPane({ currentPath: "photos/2026/raw/camera/original" });

    const nav = screen.getByRole("navigation", { name: "Left pane segments" });
    await waitFor(() => {
      expect(within(nav).getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual([
        "/",
        "photos",
        "Show 2 hidden folders",
        "camera",
        "original",
      ]);
    });
  } finally {
    restoreMeasurements();
  }
});

it("recomputes hidden ancestors as the pane narrows and widens", async () => {
  const measurements = mockResizableBreadcrumbMeasurements(900);
  try {
    const view = renderPane({ currentPath: "photos/2026/raw/camera/original" });
    const nav = screen.getByRole("navigation", { name: "Left pane segments" });
    const labels = () =>
      within(nav)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label") ?? button.textContent);

    expect(labels()).toEqual(["/", "photos", "2026", "raw", "camera", "original"]);

    act(() => measurements.resize(280));
    await waitFor(() => expect(labels()).toEqual(["/", "photos", "Show 2 hidden folders", "camera", "original"]));

    act(() => measurements.resize(900));
    await waitFor(() => expect(labels()).toEqual(["/", "photos", "2026", "raw", "camera", "original"]));

    view.unmount();
    expect(measurements.pathObserverDisconnected()).toBe(true);
  } finally {
    measurements.restore();
  }
});

it("opens hidden folders from the ellipsis menu", async () => {
  const restoreMeasurements = mockBreadcrumbMeasurements(280);
  const onPathChange = vi.fn();
  try {
    renderPane({ currentPath: "photos/2026/raw/camera/original", onPathChange });

    await userEvent.click(await screen.findByRole("button", { name: "Show 2 hidden folders" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "2026" }));

    expect(onPathChange).toHaveBeenCalledWith("photos/2026");
  } finally {
    restoreMeasurements();
  }
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

it("updates marquee selection while dragging without emitting duplicate path lists", () => {
  const onSelectPaths = vi.fn();
  const { container } = renderPane({
    entries: [entry("a.txt"), entry("b.txt"), entry("c.txt")],
    onSelectPaths,
  });
  const fileList = container.querySelector(".file-list") as HTMLDivElement;
  const rows = within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row");
  mockRect(fileList, { left: 0, top: 0, right: 400, bottom: 160, width: 400, height: 160 });
  rows.forEach((row, index) => {
    mockRect(row, { left: 0, top: 32 + index * 32, right: 376, bottom: 64 + index * 32, width: 376, height: 32 });
  });

  const typeCell = within(rows[0]).getAllByRole("cell")[2];
  fireEvent.mouseDown(typeCell, { button: 0, clientX: 250, clientY: 40 });
  fireEvent.mouseMove(document, { clientX: 260, clientY: 94 });

  expect(onSelectPaths).toHaveBeenLastCalledWith(["a.txt", "b.txt"]);
  const callCount = onSelectPaths.mock.calls.length;
  fireEvent.mouseMove(document, { clientX: 260, clientY: 94 });
  expect(onSelectPaths).toHaveBeenCalledTimes(callCount);

  fireEvent.mouseUp(document, { clientX: 260, clientY: 94 });
});

it("auto-scrolls a bottom-edge marquee to select rows below the initial viewport", () => {
  const frames = mockAnimationFrames();
  try {
    const onSelectPaths = vi.fn();
    const { container } = renderPane({
      entries: [entry("a.txt"), entry("b.txt"), entry("c.txt"), entry("d.txt"), entry("e.txt")],
      onSelectPaths,
    });
    const fileList = container.querySelector(".file-list") as HTMLDivElement;
    const rows = within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row");
    mockScrollableList(fileList, { top: 0, height: 100, scrollHeight: 220, scrollTop: 0 });
    rows.forEach((row, index) => mockScrollingRow(row, fileList, 30 + index * 28, 28));

    const typeCell = within(rows[0]).getAllByRole("cell")[2];
    fireEvent.mouseDown(typeCell, { button: 0, clientX: 250, clientY: 40 });
    fireEvent.mouseMove(document, { clientX: 260, clientY: 98 });

    expect(frames.pending()).toBe(1);
    frames.runNext();
    frames.runNext();

    expect(fileList.scrollTop).toBeGreaterThan(0);
    expect(onSelectPaths).toHaveBeenLastCalledWith(expect.arrayContaining(["d.txt"]));

    fireEvent.mouseUp(document, { clientX: 260, clientY: 98 });
    expect(frames.pending()).toBe(0);
    expect(container.querySelector(".drag-selection-box")).not.toBeInTheDocument();
  } finally {
    frames.restore();
  }
});

it("auto-scrolls upward and cancels an active marquee when the window loses focus", () => {
  const frames = mockAnimationFrames();
  try {
    const onSelectPaths = vi.fn();
    const { container } = renderPane({
      entries: [entry("a.txt"), entry("b.txt"), entry("c.txt"), entry("d.txt"), entry("e.txt")],
      onSelectPaths,
    });
    const fileList = container.querySelector(".file-list") as HTMLDivElement;
    const rows = within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row");
    mockScrollableList(fileList, { top: 0, height: 100, scrollHeight: 220, scrollTop: 60 });
    rows.forEach((row, index) => mockScrollingRow(row, fileList, 30 + index * 28, 28));

    const sizeCell = within(rows[4]).getAllByRole("cell")[3];
    fireEvent.mouseDown(sizeCell, { button: 0, clientX: 280, clientY: 88 });
    fireEvent.mouseMove(document, { clientX: 270, clientY: 2 });
    expect(frames.pending()).toBe(1);

    frames.runNext();
    expect(fileList.scrollTop).toBeLessThan(60);

    fireEvent.blur(window);
    expect(frames.pending()).toBe(0);
    expect(container.querySelector(".drag-selection-box")).not.toBeInTheDocument();
  } finally {
    frames.restore();
  }
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

it("registers full rows as drag sources but activates from only the icon and visible name", () => {
  renderPane({
    entries: [
      entry("file.txt"),
      entry("folder", "directory"),
      { ...entry("link", "symlink"), isSymlink: true, symlinkTarget: "target" },
    ],
  });

  const fileName = screen.getByText("file.txt");
  const fileRow = fileName.closest("tr");
  const fileHandle = fileName.closest<HTMLElement>("[data-file-drag-handle]");
  const directoryRow = screen.getByText("folder").closest("tr");
  const linkName = screen.getByText("link");
  const linkHandle = linkName.closest<HTMLElement>("[data-file-drag-handle]");
  const linkTarget = screen.getByText(/target/);
  if (!fileRow || !fileHandle || !directoryRow || !linkHandle) {
    throw new Error("expected drag source rows and handles");
  }

  expect(fileRow).toHaveAttribute("data-file-drag-source", "true");
  expect(fileRow).not.toHaveAttribute("data-drop-kind", "directory");
  expect(directoryRow).toHaveAttribute("data-file-drag-source", "true");
  expect(directoryRow).toHaveAttribute("data-drop-kind", "directory");
  expect(fileHandle).toContainElement(within(fileRow).getByTestId("file-icon-file"));
  expect(fileHandle).toContainElement(fileName);
  expect(linkHandle).toContainElement(linkName);
  expect(linkHandle).not.toContainElement(linkTarget);
});

it.each([
  { state: "valid", valid: true },
  { state: "invalid", valid: false },
])("renders $state pane feedback in a non-interactive foreground layer", ({ state, valid }) => {
  const feedback: FileDropFeedback = {
    target: {
      id: paneDropId("left"),
      kind: "current-directory",
      pane: "left",
      rootId: "data",
      path: ".",
      label: "Current directory",
    },
    operation: "move",
    valid,
    reason: valid ? undefined : "same-directory",
  };
  renderPane({ dropFeedback: feedback });

  const frame = screen.getByTestId("file-list-left").closest(".file-list-frame");
  const layer = frame?.querySelector(".file-list-drop-feedback");
  expect(frame).toHaveAttribute("data-drop-state", state);
  expect(layer).toHaveAttribute("data-drop-state", state);
  expect(layer).toHaveAttribute("aria-hidden", "true");
});

it("does not render pane feedback for a nonmatching target", () => {
  const feedback: FileDropFeedback = {
    target: {
      id: paneDropId("right"),
      kind: "current-directory",
      pane: "right",
      rootId: "data",
      path: ".",
      label: "Current directory",
    },
    operation: "move",
    valid: true,
  };
  renderPane({ dropFeedback: feedback });
  expect(document.querySelector(".file-list-drop-feedback")).not.toBeInTheDocument();
});

it("does not start marquee selection from the file drag activator", () => {
  const onSelectPaths = vi.fn();
  const { container } = renderPane({ onSelectPaths });
  const fileList = container.querySelector(".file-list") as HTMLDivElement;
  const row = screen.getByText("file.txt").closest("tr") as HTMLTableRowElement;
  const handle = screen.getByText("file.txt").closest("[data-file-drag-handle]");
  if (!handle) throw new Error("file drag handle was not rendered");
  mockRect(fileList, { left: 0, top: 0, right: 400, bottom: 96, width: 400, height: 96 });
  mockRect(row, { left: 0, top: 32, right: 376, bottom: 64, width: 376, height: 32 });

  fireEvent.mouseDown(handle, { button: 0, clientX: 44, clientY: 44 });
  fireEvent.mouseMove(document, { clientX: 360, clientY: 60 });
  expect(container.querySelector(".drag-selection-box")).not.toBeInTheDocument();
  fireEvent.mouseUp(document);
  expect(onSelectPaths).not.toHaveBeenCalled();
});

it.each([
  { label: "unused name-cell space", cellIndex: 1 },
  { label: "type cell", cellIndex: 2 },
  { label: "size cell", cellIndex: 3 },
  { label: "modified-time cell", cellIndex: 4 },
])("starts marquee selection from $label", ({ cellIndex }) => {
  const onSelectPaths = vi.fn();
  const { container } = renderPane({ onSelectPaths });
  const fileList = container.querySelector(".file-list") as HTMLDivElement;
  const row = screen.getByText("file.txt").closest("tr") as HTMLTableRowElement;
  const cells = within(row).getAllByRole("cell");
  mockRect(fileList, { left: 0, top: 0, right: 400, bottom: 96, width: 400, height: 96 });
  mockRect(row, { left: 0, top: 32, right: 376, bottom: 64, width: 376, height: 32 });

  fireEvent.mouseDown(cells[cellIndex], { button: 0, clientX: 300, clientY: 40 });
  fireEvent.mouseMove(document, { clientX: 360, clientY: 60 });
  expect(container.querySelector(".drag-selection-box")).toBeInTheDocument();
  fireEvent.mouseUp(document, { clientX: 360, clientY: 60 });
  expect(onSelectPaths).toHaveBeenCalledWith(["file.txt"]);
});

it("keeps the checkbox interactive instead of using it as a drag activator", async () => {
  const onToggleSelection = vi.fn();
  renderPane({ onToggleSelection });
  await userEvent.click(screen.getByLabelText("Select file.txt"));
  expect(onToggleSelection).toHaveBeenCalledWith("file.txt");
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

it("reports the right-clicked entry before opening its context menu", () => {
  const onContextTarget = vi.fn();
  renderPane({ onContextTarget });

  fireEvent.contextMenu(screen.getByText("file.txt"), { clientX: 50, clientY: 50 });
  expect(onContextTarget).toHaveBeenCalledWith("file.txt");
});

it("reports null when list whitespace is right-clicked", () => {
  const onContextTarget = vi.fn();
  renderPane({ onContextTarget });

  fireEvent.contextMenu(screen.getByTestId("file-list-left"), { clientX: 500, clientY: 400 });
  expect(onContextTarget).toHaveBeenCalledWith(null);
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
    onContextTarget: vi.fn(),
    actions: [],
    onRefresh: vi.fn(),
    onActivate: vi.fn(),
    ...overrides,
  };
  return render(
    <DndContext>
      <FilePane {...props} />
    </DndContext>,
  );
}

function visibleEntryNames() {
  const rows = within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row");
  return rows.map((row) => within(row).getAllByRole("cell")[1].textContent);
}

function mockRect(element: Element, rect: Omit<DOMRect, "toJSON" | "x" | "y"> & Partial<Pick<DOMRect, "x" | "y">>) {
  const browserRect = new DOMRect(rect.x ?? rect.left, rect.y ?? rect.top, rect.width, rect.height);
  element.getBoundingClientRect = vi.fn(() => browserRect);
}

function mockScrollableList(
  element: HTMLDivElement,
  options: { top: number; height: number; scrollHeight: number; scrollTop: number },
) {
  mockRect(element, {
    left: 0,
    top: options.top,
    right: 400,
    bottom: options.top + options.height,
    width: 400,
    height: options.height,
  });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: options.height });
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: options.scrollHeight });
  element.scrollTop = options.scrollTop;
}

function mockScrollingRow(element: HTMLElement, list: HTMLDivElement, contentTop: number, height: number) {
  element.getBoundingClientRect = vi.fn(() => new DOMRect(0, contentTop - list.scrollTop, 376, height));
}

function mockAnimationFrames() {
  const originalRequest = window.requestAnimationFrame;
  const originalCancel = window.cancelAnimationFrame;
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextID = 1;
  const request = vi.fn((callback: FrameRequestCallback) => {
    const id = nextID;
    nextID += 1;
    callbacks.set(id, callback);
    return id;
  });
  const cancel = vi.fn((id: number) => callbacks.delete(id));
  window.requestAnimationFrame = request;
  window.cancelAnimationFrame = cancel;

  return {
    pending: () => callbacks.size,
    runNext() {
      const next = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!next) throw new Error("expected a pending animation frame");
      callbacks.delete(next[0]);
      act(() => next[1](performance.now()));
    },
    restore() {
      window.requestAnimationFrame = originalRequest;
      window.cancelAnimationFrame = originalCancel;
    },
  };
}

function mockBreadcrumbMeasurements(availableWidth: number) {
  const clientWidth = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("path-segments-content")) return availableWidth;
    return 800;
  });
  const boundingRect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const measureType = this.getAttribute("data-path-measure");
    const width =
      measureType === "segment"
        ? breadcrumbSegmentWidths[this.textContent ?? ""] ?? 0
        : measureType === "separator"
          ? 8
          : measureType === "ellipsis"
            ? 24
            : 100;
    return new DOMRect(0, 0, width, 24);
  });

  return () => {
    clientWidth.mockRestore();
    boundingRect.mockRestore();
  };
}

function mockResizableBreadcrumbMeasurements(initialWidth: number) {
  let availableWidth = initialWidth;
  const observers: Array<{
    callback: ResizeObserverCallback;
    instance: ResizeObserver;
    targets: Set<Element>;
    disconnected: boolean;
  }> = [];
  const originalResizeObserver = globalThis.ResizeObserver;

  class ResizeObserverMock implements ResizeObserver {
    private record: (typeof observers)[number];

    constructor(callback: ResizeObserverCallback) {
      this.record = { callback, instance: this, targets: new Set(), disconnected: false };
      observers.push(this.record);
    }

    observe(target: Element) {
      this.record.targets.add(target);
    }

    unobserve(target: Element) {
      this.record.targets.delete(target);
    }

    disconnect() {
      this.record.disconnected = true;
    }
  }

  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  });

  const clientWidth = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("path-segments-content")) return availableWidth;
    return 800;
  });
  const boundingRect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const measureType = this.getAttribute("data-path-measure");
    const width =
      measureType === "segment"
        ? breadcrumbSegmentWidths[this.textContent ?? ""] ?? 0
        : measureType === "separator"
          ? 8
          : measureType === "ellipsis"
            ? 24
            : 100;
    return new DOMRect(0, 0, width, 24);
  });

  function pathObservers() {
    return observers.filter((observer) =>
      Array.from(observer.targets).some((target) => target.classList.contains("path-segments-content")),
    );
  }

  return {
    resize(width: number) {
      availableWidth = width;
      pathObservers().forEach((observer) => observer.callback([], observer.instance));
    },
    pathObserverDisconnected() {
      const matching = pathObservers();
      return matching.length > 0 && matching.every((observer) => observer.disconnected);
    },
    restore() {
      clientWidth.mockRestore();
      boundingRect.mockRestore();
      Object.defineProperty(globalThis, "ResizeObserver", {
        configurable: true,
        writable: true,
        value: originalResizeObserver,
      });
    },
  };
}

const breadcrumbSegmentWidths: Record<string, number> = {
  "/": 14,
  photos: 52,
  "2026": 44,
  raw: 36,
  camera: 60,
  original: 64,
};
