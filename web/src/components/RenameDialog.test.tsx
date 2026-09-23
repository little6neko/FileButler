import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { PlanItem, RenameOptions } from "../api/types";
import { strings } from "../i18n";
import { defaultRenameOptions } from "./powerRenameOptions";
import { PowerRenameContent, RenameDialog } from "./RenameDialog";

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

function PowerRenameHarness({
  rootId,
  paths,
  submitting = false,
  onClose = vi.fn(),
  onSubmit = vi.fn(),
}: {
  rootId: string;
  paths: string[];
  submitting?: boolean;
  onClose?: () => void;
  onSubmit?: () => void;
}) {
  const [options, setOptions] = useState<RenameOptions>(() => ({ ...defaultRenameOptions }));
  return (
    <PowerRenameContent
      rootId={rootId}
      paths={paths}
      options={options}
      submitting={submitting}
      submitError={null}
      labels={strings.en}
      onOptionsChange={setOptions}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}

it("defaults metadata reading off and lets local users opt in", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  render(<PowerRenameHarness rootId="local" paths={["photo.jpg"]} />);
  const checkbox = screen.getByRole("checkbox", { name: "Modify file properties" });
  expect(checkbox).not.toBeChecked();
  await userEvent.click(checkbox);
  expect(checkbox).toBeChecked();
  await waitFor(() => expect(api.renamePreview).toHaveBeenLastCalledWith(expect.objectContaining({ options: expect.objectContaining({ readMetadata: true }) })));
  await userEvent.click(checkbox);
  await waitFor(() => expect(api.renamePreview).toHaveBeenLastCalledWith(expect.objectContaining({ options: expect.objectContaining({ readMetadata: false }) })));
});

it("disables metadata reading for 115 even if inherited options enabled it", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  render(<PowerRenameContent rootId="@115" paths={["photo.jpg"]} options={{ ...defaultRenameOptions, readMetadata: true }} submitting={false} submitError={null} onOptionsChange={vi.fn()} onSubmit={vi.fn()} onClose={vi.fn()} />);
  const checkbox = screen.getByRole("checkbox", { name: "Modify file properties" });
  expect(checkbox).not.toBeChecked();
  expect(checkbox).toBeDisabled();
  await waitFor(() => expect(api.renamePreview).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ readMetadata: false }) })));
});

it("isolates options and control IDs across simultaneous PowerRename bodies", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  const { container } = render(
    <>
      <PowerRenameHarness rootId="root-a" paths={["a.txt"]} />
      <PowerRenameHarness rootId="root-b" paths={["b.txt"]} />
    </>,
  );

  const searches = screen.getAllByLabelText("Search");
  await userEvent.type(searches[0], "alpha");

  expect(searches[0]).toHaveValue("alpha");
  expect(searches[1]).toHaveValue("");
  await waitFor(() => expect(api.renamePreview).toHaveBeenCalledWith(
    expect.objectContaining({ rootId: "root-a", paths: ["a.txt"], options: expect.objectContaining({ search: "alpha" }) }),
  ));

  const controlIDs = [...container.querySelectorAll<HTMLElement>("input[id], button[role='checkbox'][id]")]
    .map((control) => control.id)
    .filter(Boolean);
  expect(new Set(controlIDs).size).toBe(controlIDs.length);
});

it("reserves left-side space for both PowerRename input focus rings", () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  render(<PowerRenameHarness rootId="root-a" paths={["a.txt"]} />);

  const optionsColumn = screen.getByTestId("rename-options-column");
  expect(optionsColumn).toHaveClass("overflow-auto", "pl-1");
  expect(within(optionsColumn).getByLabelText("Search")).toBeInTheDocument();
  expect(within(optionsColumn).getByLabelText("Replace")).toBeInTheDocument();
});

it("keeps close and submit disabled while an external rename submission is pending", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  const onClose = vi.fn();
  const onSubmit = vi.fn();
  render(
    <PowerRenameHarness
      rootId="root-a"
      paths={["a.txt"]}
      submitting
      onClose={onClose}
      onSubmit={onSubmit}
    />,
  );

  await waitFor(() => expect(api.renamePreview).toHaveBeenCalled());
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Rename 1 item" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).not.toHaveBeenCalled();
  expect(onSubmit).not.toHaveBeenCalled();
});

it("ignores an older PowerRename preview that resolves after the latest options", async () => {
  type Preview = { hasConflict: boolean; items: PlanItem[] };
  let resolveInitial!: (preview: Preview) => void;
  let resolveLatest!: (preview: Preview) => void;
  vi.mocked(api.renamePreview).mockImplementation(({ options }) => new Promise((resolve) => {
    if (options.search === "x") resolveLatest = resolve;
    else resolveInitial = resolve;
  }));
  render(<PowerRenameHarness rootId="root-a" paths={["a.txt"]} />);

  await waitFor(() => expect(resolveInitial).toBeTypeOf("function"));
  await userEvent.type(screen.getByLabelText("Search"), "x");
  await waitFor(() => expect(resolveLatest).toBeTypeOf("function"));
  await act(async () => resolveLatest({
    hasConflict: false,
    items: [{ sourcePath: "a.txt", oldName: "a.txt", newName: "latest.txt", conflict: false }],
  }));
  expect(await screen.findByText("latest.txt")).toBeInTheDocument();

  await act(async () => resolveInitial({
    hasConflict: false,
    items: [{ sourcePath: "a.txt", oldName: "a.txt", newName: "stale.txt", conflict: false }],
  }));
  expect(screen.queryByText("stale.txt")).not.toBeInTheDocument();
  expect(screen.getByText("latest.txt")).toBeInTheDocument();
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
  screen.getByLabelText("Search").focus();
  await userEvent.keyboard("{Enter}");
  expect(api.renameCreateJob).not.toHaveBeenCalled();
});

it("creates a rename job from selected files", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  vi.mocked(api.renameCreateJob).mockResolvedValue({ id: "job_1" });
  const onJobCreated = vi.fn();
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={onJobCreated} onClose={vi.fn()} />);

  const renameButton = screen.getByRole("button", { name: "Rename 1 item" });
  await waitFor(() => expect(renameButton).toBeEnabled());
  await userEvent.click(renameButton);
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

it("uses the visible preview body as the single native scroll owner", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({
    hasConflict: false,
    items: [{
      sourcePath: "a_very_long_filename.txt",
      oldName: "a_very_long_filename.txt",
      newName: "another_very_long_filename.txt",
      changed: true,
      conflict: false,
    }],
  });
  render(<RenameDialog rootId="data" paths={["a_very_long_filename.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(await screen.findByText("another_very_long_filename.txt")).toBeInTheDocument();
  const scrollViewport = screen.getByTestId("rename-preview-scroll");
  const tableContainer = within(scrollViewport).getByRole("table").parentElement;

  expect(scrollViewport).toHaveClass("overflow-auto");
  expect(tableContainer).toHaveClass("overflow-visible");
  expect(tableContainer).not.toHaveClass("overflow-x-auto");
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
  vi.mocked(api.renameCreateJob).mockClear();
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(replace).toHaveValue("${start=1,padding=3}");
  expect(screen.queryByRole("option", { name: "${start=1,padding=3}" })).not.toBeInTheDocument();
  expect(api.renameCreateJob).not.toHaveBeenCalled();

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

it("creates a PowerRename job with Enter from a text input", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  vi.mocked(api.renameCreateJob).mockResolvedValue({ id: "job-enter" });
  const onJobCreated = vi.fn();
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={onJobCreated} onClose={vi.fn()} />);

  const search = screen.getByLabelText("Search");
  await userEvent.type(search, "file");
  await waitFor(() => expect(api.renamePreview).toHaveBeenLastCalledWith(
    expect.objectContaining({ options: expect.objectContaining({ search: "file" }) }),
  ));
  await waitFor(() => expect(screen.getByRole("button", { name: "Rename 1 item" })).toBeEnabled());
  await userEvent.keyboard("{Enter}");

  expect(api.renameCreateJob).toHaveBeenCalledWith(
    expect.objectContaining({ rootId: "data", paths: ["file.txt"] }),
  );
  expect(onJobCreated).toHaveBeenCalledWith("job-enter");
});

it("ignores Enter while the current PowerRename preview is loading", async () => {
  vi.mocked(api.renamePreview).mockReturnValue(new Promise<never>(() => undefined));
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  const search = screen.getByLabelText("Search");
  expect(screen.getByRole("button", { name: "Rename 1 item" })).toBeDisabled();
  await userEvent.type(search, "file{Enter}");

  expect(api.renameCreateJob).not.toHaveBeenCalled();
});
