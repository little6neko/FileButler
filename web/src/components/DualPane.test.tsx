import { within, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { DualPane } from "./DualPane";

vi.mock("../api/client", () => ({
  api: {
    roots: vi.fn(),
    browse: vi.fn(),
    opsDryRun: vi.fn(),
    opsCreateJob: vi.fn(),
    renamePreview: vi.fn(),
    renameCreateJob: vi.fn(),
    singleRenameCreateJob: vi.fn(),
    jobs: vi.fn(),
    job: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(api.roots).mockReset();
  vi.mocked(api.browse).mockReset();
  vi.mocked(api.opsDryRun).mockReset();
  vi.mocked(api.opsCreateJob).mockReset();
  vi.mocked(api.renamePreview).mockReset();
  vi.mocked(api.renameCreateJob).mockReset();
  vi.mocked(api.singleRenameCreateJob).mockReset();
  vi.mocked(api.jobs).mockReset();
  vi.mocked(api.jobs).mockResolvedValue([]);
  vi.mocked(api.job).mockReset();
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
  await userEvent.click(within(leftPane).getByLabelText("Select source.txt"));
  await userEvent.click(screen.getByRole("button", { name: "copy" }));

  await waitFor(() =>
    expect(api.opsDryRun).toHaveBeenCalledWith(
      expect.objectContaining({ type: "copy", sourceRoot: "root", sources: ["source.txt"], destRoot: "root", destPath: "target" }),
    ),
  );
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
  await userEvent.click(within(leftPane).getByRole("button", { name: "Name" }));
  await userEvent.click(within(leftPane).getByLabelText("Select b.txt"));
  await userEvent.click(within(leftPane).getByLabelText("Select a.txt"));
  await userEvent.click(screen.getByRole("button", { name: "PowerRename" }));

  await waitFor(() =>
    expect(api.renamePreview).toHaveBeenCalledWith(
      expect.objectContaining({ rootId: "root", paths: ["a.txt", "b.txt"] }),
    ),
  );
});

it("refreshes both panes after an operation job reaches a terminal status", async () => {
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockResolvedValue([
    { name: "source.txt", relativePath: "source.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
  ]);
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "source.txt", destPath: "source.txt", conflict: false, changed: true }],
  });
  vi.mocked(api.opsCreateJob).mockResolvedValue({ id: "job-1" });
  vi.mocked(api.job).mockResolvedValue({
    id: "job-1",
    type: "copy",
    status: "completed",
    progressTotal: 1,
    progressDone: 1,
    errorMessage: "",
    items: [],
  });
  render(<DualPane />);

  const leftPane = await screen.findByRole("region", { name: "Left pane" });
  await waitFor(() => expect(api.browse).toHaveBeenCalledTimes(2));
  vi.mocked(api.browse).mockClear();

  await userEvent.click(await within(leftPane).findByLabelText("Select source.txt"));
  await userEvent.click(screen.getByRole("button", { name: "copy" }));
  await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));

  await waitFor(() => expect(api.opsCreateJob).toHaveBeenCalled());
  await waitFor(() => expect(api.job).toHaveBeenCalledWith("job-1"));
  await waitFor(() => expect(api.browse).toHaveBeenCalledTimes(2));
});
