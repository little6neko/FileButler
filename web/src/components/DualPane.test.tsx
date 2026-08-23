import { act, fireEvent, within, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { api } from "../api/client";
import type { Job } from "../api/types";
import { JobEventsStore } from "../jobEvents";
import { DualPane } from "./DualPane";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("../api/client", () => ({
  api: {
    roots: vi.fn(),
    browse: vi.fn(),
    mediaUrl: vi.fn((rootId: string, path: string) => `/api/media?rootId=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`),
    opsDryRun: vi.fn(),
    opsCreateJob: vi.fn(),
    renamePreview: vi.fn(),
    renameCreateJob: vi.fn(),
    singleRenameCreateJob: vi.fn(),
    cancelJob: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(api.roots).mockReset();
  vi.mocked(api.browse).mockReset();
  vi.mocked(api.mediaUrl).mockClear();
  vi.mocked(api.opsDryRun).mockReset();
  vi.mocked(api.opsCreateJob).mockReset();
  vi.mocked(api.renamePreview).mockReset();
  vi.mocked(api.renameCreateJob).mockReset();
  vi.mocked(api.singleRenameCreateJob).mockReset();
  vi.mocked(api.cancelJob).mockReset();
});

it("loads roots and renders two panes", async () => {
  vi.mocked(api.roots).mockResolvedValue([{ id: "data", name: "Data" }]);
  vi.mocked(api.browse).mockResolvedValue([]);
  render(<DualPane />);

  expect(await screen.findByRole("region", { name: "Left pane" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Right pane" })).toBeInTheDocument();
});

it("loads entries when a root is selected", async () => {
  vi.mocked(api.roots).mockResolvedValue([{ id: "data", name: "Data" }]);
  vi.mocked(api.browse).mockResolvedValue([
    { name: "file.txt", relativePath: "file.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
  ]);
  render(<DualPane />);

  await waitFor(() => expect(api.browse).toHaveBeenCalledWith("data", "."));
  expect(await screen.findAllByText("file.txt")).toHaveLength(2);
});

it("uses the opposite pane path as operation destination", async () => {
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockImplementation(async (_rootId, path) => {
    if (path === ".") {
      return [
        { name: "source.txt", relativePath: "source.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
        { name: "target", relativePath: "target", type: "directory", size: 0, mode: "", modifiedUnix: 0, isSymlink: false },
      ];
    }
    return [];
  });
  vi.mocked(api.opsDryRun).mockResolvedValue({ hasConflict: false, items: [] });
  render(<DualPane />);

  const rightPane = await screen.findByRole("region", { name: "Right pane" });
  await userEvent.dblClick(await within(rightPane).findByText("target"));
  await waitFor(() => expect(api.browse).toHaveBeenCalledWith("root", "target"));

  const leftPane = screen.getByRole("region", { name: "Left pane" });
  await userEvent.click(await within(leftPane).findByLabelText("Select source.txt"));
  await userEvent.click(screen.getByRole("button", { name: "Copy to right pane" }));

  await waitFor(() =>
    expect(api.opsDryRun).toHaveBeenCalledWith(
      expect.objectContaining({ type: "copy", sourceRoot: "root", sources: ["source.txt"], destRoot: "root", destPath: "target" }),
    ),
  );
});

it("creates a mkdir job from the name dialog without a second confirmation", async () => {
  const prompt = vi.spyOn(window, "prompt").mockReturnValue("browser-folder");
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockResolvedValue([]);
  vi.mocked(api.opsCreateJob).mockResolvedValue({ id: "job-mkdir" });
  render(<DualPane />);

  await screen.findByRole("region", { name: "Left pane" });
  await userEvent.click(screen.getByRole("button", { name: "mkdir" }));

  expect(prompt).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog", { name: "Directory name" });
  await userEvent.type(within(dialog).getByLabelText("Directory name"), "modal-folder");
  await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

  await waitFor(() =>
    expect(api.opsCreateJob).toHaveBeenCalledWith(
      {
        type: "mkdir",
        sourceRoot: "root",
        sources: [],
        destRoot: "root",
        destPath: ".",
        newName: "modal-folder",
      },
    ),
  );
  expect(api.opsDryRun).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog", { name: "mkdir preview" })).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Directory name" })).not.toBeInTheDocument();
  expect(toast.success).toHaveBeenCalledWith("Background job created");
  prompt.mockRestore();
});

it("marks the clicked pane as active", async () => {
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockResolvedValue([]);
  render(<DualPane />);

  const workspace = await screen.findByTestId("workspace");
  expect(workspace).toHaveAttribute("data-active-pane", "left");
  await userEvent.click(screen.getByRole("region", { name: "Right pane" }));
  expect(workspace).toHaveAttribute("data-active-pane", "right");
});

it("resizes the left and right panes by dragging the pane divider", async () => {
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockResolvedValue([]);
  render(<DualPane />);

  const workspace = await screen.findByTestId("workspace");
  workspace.getBoundingClientRect = vi.fn(() => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1000,
    bottom: 600,
    width: 1000,
    height: 600,
    toJSON: () => ({}),
  }));
  const divider = screen.getByRole("separator", { name: "Resize panes" });

  fireEvent.mouseDown(divider, { clientX: 500 });
  fireEvent.mouseMove(document, { clientX: 650 });
  fireEvent.mouseUp(document);

  expect(workspace).toHaveStyle({ gridTemplateColumns: "65fr 8px 35fr" });
});

it("opens an image media preview from a double-clicked file", async () => {
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockResolvedValue([
    { name: "photo.jpg", relativePath: "photo.jpg", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
  ]);
  render(<DualPane />);

  const leftPane = await screen.findByRole("region", { name: "Left pane" });
  await userEvent.dblClick(await within(leftPane).findByText("photo.jpg"));

  const preview = await screen.findByRole("img", { name: "photo.jpg" });
  expect(preview).toHaveAttribute("src", "/api/media?rootId=root&path=photo.jpg");
});

it("opens a video media preview from a double-clicked file", async () => {
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockResolvedValue([
    { name: "clip.mp4", relativePath: "clip.mp4", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
  ]);
  render(<DualPane />);

  const leftPane = await screen.findByRole("region", { name: "Left pane" });
  await userEvent.dblClick(await within(leftPane).findByText("clip.mp4"));

  const preview = await screen.findByLabelText("clip.mp4");
  expect(preview.tagName).toBe("VIDEO");
  expect(preview).toHaveAttribute("controls");
  expect(preview).toHaveAttribute("src", "/api/media?rootId=root&path=clip.mp4");
});

it("enables ordinary rename only for one selected item and keeps PowerRename for batch selection", async () => {
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockResolvedValue([
    { name: "a.txt", relativePath: "a.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
    { name: "b.txt", relativePath: "b.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
  ]);
  render(<DualPane />);

  const leftPane = await screen.findByRole("region", { name: "Left pane" });
  expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "PowerRename" })).toBeDisabled();

  await userEvent.click(await within(leftPane).findByLabelText("Select a.txt"));
  expect(screen.getByRole("button", { name: "Rename" })).not.toBeDisabled();
  expect(screen.getByRole("button", { name: "PowerRename" })).not.toBeDisabled();

  await userEvent.click(within(leftPane).getByLabelText("Select b.txt"));
  expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "PowerRename" })).not.toBeDisabled();
});

it("opens PowerRename with selected paths in the current visible sort order", async () => {
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockResolvedValue([
    { name: "b.txt", relativePath: "b.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
    { name: "a.txt", relativePath: "a.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
  ]);
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  render(<DualPane />);

  const leftPane = await screen.findByRole("region", { name: "Left pane" });
  await within(leftPane).findByLabelText("Select b.txt");
  await userEvent.click(within(leftPane).getByLabelText("Select b.txt"));
  await userEvent.click(await within(leftPane).findByLabelText("Select a.txt"));
  await userEvent.click(screen.getByRole("button", { name: "PowerRename" }));

  await waitFor(() =>
    expect(api.renamePreview).toHaveBeenCalledWith(
      expect.objectContaining({ rootId: "root", paths: ["a.txt", "b.txt"] }),
    ),
  );
});

it("keeps PowerRename settings only after a rename job is created", async () => {
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockResolvedValue([
    { name: "file.txt", relativePath: "file.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
  ]);
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  vi.mocked(api.renameCreateJob).mockResolvedValue({ id: "job-rename" });
  render(<DualPane />);

  const leftPane = await screen.findByRole("region", { name: "Left pane" });
  await userEvent.click(await within(leftPane).findByLabelText("Select file.txt"));
  await userEvent.click(screen.getByRole("button", { name: "PowerRename" }));
  let dialog = await screen.findByRole("dialog", { name: "Rename dialog" });
  await userEvent.type(within(dialog).getByLabelText("Search"), "draft");
  await userEvent.click(within(dialog).getByLabelText("Use regular expressions"));
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

  await userEvent.click(screen.getByRole("button", { name: "PowerRename" }));
  dialog = await screen.findByRole("dialog", { name: "Rename dialog" });
  expect(within(dialog).getByLabelText("Search")).toHaveValue("");
  expect(within(dialog).getByLabelText("Use regular expressions")).not.toBeChecked();

  await userEvent.type(within(dialog).getByLabelText("Search"), "committed");
  await userEvent.type(within(dialog).getByLabelText("Replace"), "renamed");
  await userEvent.click(within(dialog).getByLabelText("Use regular expressions"));
  await userEvent.click(within(dialog).getByRole("button", { name: "Rename 1 item" }));
  await waitFor(() => expect(api.renameCreateJob).toHaveBeenCalled());

  await userEvent.click(await within(leftPane).findByLabelText("Select file.txt"));
  await userEvent.click(screen.getByRole("button", { name: "PowerRename" }));
  dialog = await screen.findByRole("dialog", { name: "Rename dialog" });
  expect(within(dialog).getByLabelText("Search")).toHaveValue("committed");
  expect(within(dialog).getByLabelText("Replace")).toHaveValue("renamed");
  expect(within(dialog).getByLabelText("Use regular expressions")).toBeChecked();
});

it("clears hidden selection after a rename job refreshes the pane", async () => {
  const jobEvents = new JobEventsStore();
  jobEvents.handleSnapshot({ runtimeId: "runtime-a", cursor: 0, reset: false, jobs: [] });
  let renamed = false;
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockImplementation(async () =>
    renamed
      ? [{ name: "new.txt", relativePath: "new.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false }]
      : [{ name: "old.txt", relativePath: "old.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false }],
  );
  vi.mocked(api.singleRenameCreateJob).mockImplementation(async () => {
    renamed = true;
    return { id: "job-rename" };
  });
  render(<DualPane jobEventsStore={jobEvents} />);

  const leftPane = await screen.findByRole("region", { name: "Left pane" });
  await userEvent.click(await within(leftPane).findByLabelText("Select old.txt"));
  await userEvent.click(screen.getByRole("button", { name: "Rename" }));
  const dialog = await screen.findByRole("dialog", { name: "Rename dialog" });
  await userEvent.clear(within(dialog).getByRole("textbox"));
  await userEvent.type(within(dialog).getByRole("textbox"), "new.txt");
  await userEvent.click(within(dialog).getByRole("button", { name: "Rename" }));

  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Background job created"));
  act(() => {
    jobEvents.handleChanged({
      runtimeId: "runtime-a",
      cursor: 1,
      job: makeJob({ id: "job-rename", type: "rename", status: "completed", eventVersion: 1 }),
    });
  });

  expect(await within(leftPane).findByLabelText("Select new.txt")).not.toBeChecked();
  await waitFor(() => expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled());
  expect(screen.getByRole("button", { name: "PowerRename" })).toBeDisabled();
});

it("clears selection when navigating to another folder", async () => {
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockImplementation(async (_rootId, path) => {
    if (path === ".") {
      return [
        { name: "selected.txt", relativePath: "selected.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
        { name: "folder", relativePath: "folder", type: "directory", size: 0, mode: "", modifiedUnix: 0, isSymlink: false },
      ];
    }
    return [{ name: "inside.txt", relativePath: "folder/inside.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false }];
  });
  render(<DualPane />);

  const leftPane = await screen.findByRole("region", { name: "Left pane" });
  await userEvent.click(await within(leftPane).findByLabelText("Select selected.txt"));
  expect(screen.getByRole("button", { name: "Rename" })).not.toBeDisabled();

  await userEvent.dblClick(within(leftPane).getByText("folder"));

  expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "PowerRename" })).toBeDisabled();
  expect(await within(leftPane).findByLabelText("Select inside.txt")).not.toBeChecked();
});

it("refreshes both panes after an operation job reaches a terminal status", async () => {
  const jobEvents = new JobEventsStore();
  jobEvents.handleSnapshot({ runtimeId: "runtime-a", cursor: 0, reset: false, jobs: [] });
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockResolvedValue([
    { name: "source.txt", relativePath: "source.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
  ]);
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "source.txt", destPath: "source.txt", conflict: false, changed: true }],
  });
  vi.mocked(api.opsCreateJob).mockResolvedValue({ id: "job-1" });
  render(<DualPane jobEventsStore={jobEvents} />);

  const leftPane = await screen.findByRole("region", { name: "Left pane" });
  await waitFor(() => expect(api.browse).toHaveBeenCalledTimes(2));
  vi.mocked(api.browse).mockClear();

  await userEvent.click(await within(leftPane).findByLabelText("Select source.txt"));
  await userEvent.click(screen.getByRole("button", { name: "Copy to right pane" }));
  await userEvent.click(await screen.findByRole("button", { name: "Start copy" }));

  await waitFor(() => expect(api.opsCreateJob).toHaveBeenCalled());
  expect(toast.success).toHaveBeenCalledWith("Background job created");

  act(() => {
    jobEvents.handleChanged({
      runtimeId: "runtime-a",
      cursor: 1,
      job: makeJob({ id: "job-1", status: "running", eventVersion: 1 }),
    });
  });
  expect(api.browse).not.toHaveBeenCalled();

  act(() => {
    jobEvents.handleChanged({
      runtimeId: "runtime-a",
      cursor: 2,
      job: makeJob({ id: "job-1", status: "completed", progressDone: 1, eventVersion: 2 }),
    });
  });
  await waitFor(() => expect(api.browse).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("dialog", { name: "Jobs" })).not.toBeInTheDocument();
  expect(within(leftPane).getByLabelText("Select source.txt")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Copy to right pane" })).toBeDisabled();
});

it("updates transfer labels when the active pane changes", async () => {
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockResolvedValue([
    { name: "a.txt", relativePath: "a.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
  ]);
  render(<DualPane />);

  const leftPane = await screen.findByRole("region", { name: "Left pane" });
  await userEvent.click(await within(leftPane).findByLabelText("Select a.txt"));
  expect(screen.getByRole("button", { name: "Copy to right pane" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("region", { name: "Right pane" }));
  expect(screen.getByRole("button", { name: "Copy to left pane" })).toBeInTheDocument();
});

it("shows browse failures inside the affected panes", async () => {
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockRejectedValue(new Error("permission denied"));
  render(<DualPane />);

  expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent("permission denied");
});

it("opens the jobs sheet from the workbench", async () => {
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockResolvedValue([]);
  render(<DualPane />);

  await screen.findByRole("region", { name: "Left pane" });
  await userEvent.click(screen.getAllByRole("button", { name: "Jobs" })[0]);

  expect(screen.getByRole("dialog", { name: "Jobs" })).toBeInTheDocument();
});

it("preserves a selected group when opening the row context menu", async () => {
  mockTwoEntries();
  render(<DualPane />);
  const leftPane = await screen.findByRole("region", { name: "Left pane" });
  await userEvent.click(await within(leftPane).findByLabelText("Select a.txt"));
  await userEvent.click(within(leftPane).getByLabelText("Select b.txt"));

  fireEvent.contextMenu(within(leftPane).getByText("a.txt"), { clientX: 100, clientY: 100 });
  const menu = await screen.findByRole("menu", { name: "File actions" });
  expect(within(menu).getByRole("menuitem", { name: "Rename" })).toHaveAttribute("aria-disabled", "true");
  expect(within(menu).getByRole("menuitem", { name: "PowerRename" })).not.toHaveAttribute("aria-disabled", "true");
});

it("replaces selection when opening an unselected row context menu", async () => {
  mockTwoEntries();
  render(<DualPane />);
  const leftPane = await screen.findByRole("region", { name: "Left pane" });
  await userEvent.click(await within(leftPane).findByLabelText("Select a.txt"));

  fireEvent.contextMenu(within(leftPane).getByText("b.txt"), { clientX: 100, clientY: 100 });
  const menu = await screen.findByRole("menu", { name: "File actions" });
  expect(within(leftPane).getByLabelText("Select a.txt")).not.toBeChecked();
  expect(within(leftPane).getByLabelText("Select b.txt")).toBeChecked();
  expect(within(menu).getByRole("menuitem", { name: "Rename" })).not.toHaveAttribute("aria-disabled", "true");
});

it("clears selection on whitespace but keeps every action visible", async () => {
  mockTwoEntries();
  render(<DualPane />);
  const leftPane = await screen.findByRole("region", { name: "Left pane" });
  await userEvent.click(await within(leftPane).findByLabelText("Select a.txt"));

  fireEvent.contextMenu(within(leftPane).getByTestId("file-list-left"), { clientX: 500, clientY: 400 });
  const menu = await screen.findByRole("menu", { name: "File actions" });
  const items = within(menu).getAllByRole("menuitem");
  expect(items.map((item) => item.dataset.actionId)).toEqual([
    "copy", "move", "symlink", "hardlink", "rename", "powerRename", "mkdir", "delete",
  ]);
  expect(items.find((item) => item.dataset.actionId === "mkdir")).not.toHaveAttribute("aria-disabled", "true");
  expect(items.filter((item) => item.dataset.actionId !== "mkdir").every((item) => item.getAttribute("aria-disabled") === "true")).toBe(true);
});

it("uses plain and Ctrl row clicks for single and toggle selection", async () => {
  mockFourEntries();
  render(<DualPane />);
  const leftPane = await screen.findByRole("region", { name: "Left pane" });

  fireEvent.click(await within(leftPane).findByText("a.txt"));
  expect(within(leftPane).getByLabelText("Select a.txt")).toBeChecked();
  expect(within(leftPane).getByLabelText("Select b.txt")).not.toBeChecked();

  fireEvent.click(within(leftPane).getByText("c.txt"), { ctrlKey: true });
  expect(within(leftPane).getByLabelText("Select a.txt")).toBeChecked();
  expect(within(leftPane).getByLabelText("Select c.txt")).toBeChecked();

  fireEvent.click(within(leftPane).getByText("a.txt"), { ctrlKey: true });
  expect(within(leftPane).getByLabelText("Select a.txt")).not.toBeChecked();
  expect(within(leftPane).getByLabelText("Select c.txt")).toBeChecked();
});

it("uses the first Shift click as an anchor and keeps the range until a plain click", async () => {
  mockFourEntries();
  render(<DualPane />);
  const leftPane = await screen.findByRole("region", { name: "Left pane" });

  fireEvent.click(await within(leftPane).findByText("b.txt"), { shiftKey: true });
  expect(within(leftPane).getByLabelText("Select b.txt")).toBeChecked();
  expect(within(leftPane).getByLabelText("Select a.txt")).not.toBeChecked();

  fireEvent.click(within(leftPane).getByText("d.txt"), { shiftKey: true });
  expect(within(leftPane).getByLabelText("Select a.txt")).not.toBeChecked();
  expect(within(leftPane).getByLabelText("Select b.txt")).toBeChecked();
  expect(within(leftPane).getByLabelText("Select c.txt")).toBeChecked();
  expect(within(leftPane).getByLabelText("Select d.txt")).toBeChecked();

  fireEvent.click(within(leftPane).getByText("a.txt"));
  expect(within(leftPane).getByLabelText("Select a.txt")).toBeChecked();
  expect(within(leftPane).getByLabelText("Select b.txt")).not.toBeChecked();
  expect(within(leftPane).getByLabelText("Select c.txt")).not.toBeChecked();
  expect(within(leftPane).getByLabelText("Select d.txt")).not.toBeChecked();
});

it("gives Shift range selection precedence over Ctrl toggle", async () => {
  mockFourEntries();
  render(<DualPane />);
  const leftPane = await screen.findByRole("region", { name: "Left pane" });

  fireEvent.click(await within(leftPane).findByText("d.txt"));
  fireEvent.click(within(leftPane).getByText("a.txt"), { ctrlKey: true });
  fireEvent.click(within(leftPane).getByText("c.txt"), { ctrlKey: true, shiftKey: true });

  expect(within(leftPane).getByLabelText("Select a.txt")).toBeChecked();
  expect(within(leftPane).getByLabelText("Select b.txt")).toBeChecked();
  expect(within(leftPane).getByLabelText("Select c.txt")).toBeChecked();
  expect(within(leftPane).getByLabelText("Select d.txt")).not.toBeChecked();
});

function mockTwoEntries() {
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockResolvedValue([
    { name: "a.txt", relativePath: "a.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
    { name: "b.txt", relativePath: "b.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
  ]);
}

function mockFourEntries() {
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockResolvedValue([
    { name: "a.txt", relativePath: "a.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
    { name: "b.txt", relativePath: "b.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
    { name: "c.txt", relativePath: "c.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
    { name: "d.txt", relativePath: "d.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
  ]);
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    type: "copy",
    status: "pending",
    actorId: 1,
    sourceRootId: "root",
    progressTotal: 1,
    progressDone: 0,
    failedCount: 0,
    cancelRequested: false,
    errorMessage: "",
    createdAtUnix: 1,
    updatedAtUnix: 1,
    eventVersion: 1,
    ...overrides,
  };
}
