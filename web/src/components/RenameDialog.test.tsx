import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { strings } from "../i18n";
import { RenameDialog } from "./RenameDialog";

vi.mock("../api/client", () => ({
  api: {
    renamePreview: vi.fn(),
    renameCreateJob: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(api.renamePreview).mockReset();
  vi.mocked(api.renameCreateJob).mockReset();
});

it("requests preview when rename options change", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  await userEvent.type(screen.getByLabelText("Search"), "file");
  await waitFor(() => expect(api.renamePreview).toHaveBeenCalled());
});

it("shows original and renamed values", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "file.txt", oldName: "file.txt", newName: "photo.txt", conflict: false }],
  });
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(await screen.findByText("photo.txt")).toBeInTheDocument();
});

it("highlights preview rows that match the PowerRename rule", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({
    hasConflict: false,
    items: [
      { sourcePath: "file.txt", oldName: "file.txt", newName: "photo.txt", changed: true, conflict: false },
      { sourcePath: "notes.txt", oldName: "notes.txt", newName: "notes.txt", changed: false, conflict: false },
    ],
  });
  render(<RenameDialog rootId="data" paths={["file.txt", "notes.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect((await screen.findByText("photo.txt")).closest("tr")).toHaveClass("bg-blue-50");
  expect(screen.getAllByText("notes.txt")[0].closest("tr")).not.toHaveClass("bg-blue-50");
});

it("disables run button when preview has conflicts", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({
    hasConflict: true,
    items: [{ sourcePath: "file.txt", oldName: "file.txt", newName: "photo.txt", conflict: true, errorText: "exists" }],
  });
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(await screen.findByText("exists")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Rename 1 item" })).toBeDisabled();
});

it("creates a rename job from selected files", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  vi.mocked(api.renameCreateJob).mockResolvedValue({ id: "job_1" });
  const onJobCreated = vi.fn();
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={onJobCreated} onClose={vi.fn()} />);

  await userEvent.click(screen.getByRole("button", { name: "Rename 1 item" }));
  expect(onJobCreated).toHaveBeenCalledWith("job_1");
});

it("keeps enumerate option visible with a checkbox", () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByLabelText("Enumerate items")).toBeInTheDocument();
});

it("renders rename dialog labels in Chinese", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "file.txt", oldName: "file.txt", newName: "photo.txt", conflict: false }],
  });

  render(
    <RenameDialog
      rootId="data"
      paths={["file.txt"]}
      labels={strings["zh-CN"]}
      onJobCreated={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  expect(screen.getByRole("heading", { name: "PowerRename" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  expect(screen.getByLabelText("搜索")).toBeInTheDocument();
  expect(screen.getByLabelText("替换")).toBeInTheDocument();
  expect(screen.getByLabelText("使用正则表达式")).toBeInTheDocument();
  expect(screen.getByLabelText("排除文件")).toBeInTheDocument();
  expect(screen.getByLabelText("排除文件夹")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "重命名 1 项" })).toBeInTheDocument();
  expect(await screen.findByText("就绪")).toBeInTheDocument();
});

it("renders as PowerRename with PowerRename options", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(screen.getByRole("heading", { name: "PowerRename" })).toBeInTheDocument();
  expect(screen.getByLabelText("Use regular expressions")).toBeInTheDocument();
  expect(screen.getByLabelText("Match all occurrences")).toBeInTheDocument();
  expect(screen.getByLabelText("Name only")).toBeInTheDocument();
  expect(screen.getByLabelText("Extension only")).toBeInTheDocument();
  expect(screen.getByLabelText("Full name")).toBeInTheDocument();
  expect(screen.getByLabelText("Uppercase")).toBeInTheDocument();
  expect(screen.getByLabelText("Randomize items")).toBeInTheDocument();
});

it("omits the source column from the PowerRename live preview", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "photos/file.txt", oldName: "file.txt", newName: "photo.txt", conflict: false }],
  });
  render(<RenameDialog rootId="data" paths={["photos/file.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(await screen.findByRole("columnheader", { name: "Old" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "New" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Source" })).not.toBeInTheDocument();
  expect(screen.queryByText("photos/file.txt", { exact: true })).not.toBeInTheDocument();
  expect(screen.getByText("file.txt", { exact: true })).toBeInTheDocument();
});

it("renders controls and live preview in separate desktop columns", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({
    hasConflict: false,
    items: [
      { sourcePath: "a.txt", oldName: "a.txt", newName: "x.txt", changed: true, conflict: false },
      { sourcePath: "b.txt", oldName: "b.txt", newName: "y.txt", changed: true, conflict: false },
    ],
  });
  render(<RenameDialog rootId="data" paths={["a.txt", "b.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(screen.getByRole("dialog", { name: "Rename dialog" })).toBeInTheDocument();
  expect(screen.getByTestId("rename-options-column")).toBeInTheDocument();
  expect(screen.getByTestId("rename-preview-column")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "Rename 2 items" })).toBeEnabled();
});

it("shows each preset only for an empty focused input", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(screen.queryByRole("option", { name: "^.*" })).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "${start=1,padding=3}" })).not.toBeInTheDocument();

  const search = screen.getByLabelText("Search");
  const replace = screen.getByLabelText("Replace");
  await userEvent.click(search);
  expect(screen.getByRole("option", { name: "^.*" })).toBeInTheDocument();

  await userEvent.type(search, "name");
  expect(screen.queryByRole("option", { name: "^.*" })).not.toBeInTheDocument();
  await userEvent.clear(search);
  expect(screen.getByRole("option", { name: "^.*" })).toBeInTheDocument();

  await userEvent.click(replace);
  expect(screen.getByRole("option", { name: "${start=1,padding=3}" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "^.*" })).not.toBeInTheDocument();
});

it("fills and closes the selected preset without changing other options", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  const search = screen.getByLabelText("Search");
  await userEvent.click(search);
  await userEvent.click(screen.getByRole("option", { name: "^.*" }));

  expect(search).toHaveValue("^.*");
  expect(screen.queryByRole("option", { name: "^.*" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Use regular expressions")).not.toBeChecked();
  await waitFor(() =>
    expect(api.renamePreview).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ search: "^.*", replace: "" }) }),
    ),
  );

  await userEvent.clear(search);
  expect(screen.getByRole("option", { name: "^.*" })).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("Use regular expressions"));
  expect(screen.queryByRole("option", { name: "^.*" })).not.toBeInTheDocument();
});

it("supports keyboard preset selection and Escape dismissal", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  const replace = screen.getByLabelText("Replace");
  await userEvent.click(replace);
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(replace).toHaveValue("${start=1,padding=3}");
  expect(screen.queryByRole("option", { name: "${start=1,padding=3}" })).not.toBeInTheDocument();

  await userEvent.clear(replace);
  expect(screen.getByRole("option", { name: "${start=1,padding=3}" })).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("option", { name: "${start=1,padding=3}" })).not.toBeInTheDocument();
  await userEvent.click(replace);
  expect(screen.getByRole("option", { name: "${start=1,padding=3}" })).toBeInTheDocument();
});

it("keeps the input label distinct from the preset list label", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  const search = screen.getByRole("combobox", { name: "Search" });
  await userEvent.click(search);

  expect(screen.getByLabelText("Search")).toBe(search);
  expect(screen.getByRole("listbox", { name: "Search presets" })).toBeInTheDocument();
});
