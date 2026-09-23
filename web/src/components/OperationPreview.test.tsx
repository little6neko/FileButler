import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { strings } from "../i18n";
import { OperationPreview, OperationPreviewContent } from "./OperationPreview";

vi.mock("../api/client", () => ({
  api: {
    opsDryRun: vi.fn(),
    opsCreateJob: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(api.opsDryRun).mockReset();
  vi.mocked(api.opsCreateJob).mockReset();
});

it("aborts the local preview request when its window closes", () => {
  vi.mocked(api.opsDryRun).mockImplementation(() => new Promise(() => {}));
  const view = render(<OperationPreview request={request()} onJobCreated={vi.fn()} onClose={vi.fn()} />);
  const signal = vi.mocked(api.opsDryRun).mock.calls[0][1]!;
  expect(signal.aborted).toBe(false);
  view.unmount();
  expect(signal.aborted).toBe(true);
  expect(api.opsCreateJob).not.toHaveBeenCalled();
});

it("renders reusable operation content and delegates the active request", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({ hasConflict: false, items: [] });
  const onSubmit = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

  render(
    <OperationPreviewContent
      request={request()}
      titleId="local-operation-title"
      onSubmit={onSubmit}
      onClose={vi.fn()}
    />,
  );

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "copy preview" })).toHaveAttribute("id", "local-operation-title");
  await waitFor(() => expect(screen.getByRole("button", { name: "Start copy" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "Start copy" }));

  expect(onSubmit).toHaveBeenCalledWith(request(), undefined);
});

it("shows conflicts in operation preview and disables confirmation", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: true,
    items: [{ sourcePath: "a.txt", destPath: "a.txt", conflict: true, errorText: "exists" }],
  });
  render(<OperationPreview request={request()} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(await screen.findByText("exists")).toBeInTheDocument();
  expect(screen.getByText("1 conflict must be resolved before continuing.")).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "copy preview" })).toHaveClass("sm:max-w-3xl");
  expect(screen.getByRole("button", { name: "Start copy" })).toBeDisabled();
});

it("creates a job from a conflict-free operation plan", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "a.txt", destPath: "a.txt", conflict: false }],
  });
  vi.mocked(api.opsCreateJob).mockResolvedValue({ id: "job_1" });
  const onJobCreated = vi.fn();
  render(<OperationPreview request={request()} onJobCreated={onJobCreated} onClose={vi.fn()} />);

  await waitFor(() => expect(screen.getByRole("button", { name: "Start copy" })).not.toBeDisabled());
  await userEvent.click(screen.getByRole("button", { name: "Start copy" }));
  expect(onJobCreated).toHaveBeenCalledWith("job_1", request());
});

it("renders operation preview labels in Chinese", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "a.txt", destPath: "target/a.txt", conflict: false }],
  });

  render(<OperationPreview request={request()} labels={strings["zh-CN"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(await screen.findByRole("heading", { name: "复制预览" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "来源" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "目标" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "状态" })).toBeInTheDocument();
  expect(screen.getByText("就绪")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "开始复制" })).toBeInTheDocument();
});

it("omits the source column when previewing a new directory", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "", destPath: "new-folder", conflict: false }],
  });
  render(
    <OperationPreview
      request={{ type: "mkdir", sourceRoot: "root", sources: [], destRoot: "root", destPath: "new-folder" }}
      onJobCreated={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  expect(await screen.findByRole("columnheader", { name: "Destination" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Source" })).not.toBeInTheDocument();
});

it("omits the destination column when previewing deletion", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "old.txt", conflict: false }],
  });
  render(
    <OperationPreview
      request={{ type: "delete", sourceRoot: "root", sources: ["old.txt"] }}
      onJobCreated={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  expect(await screen.findByRole("columnheader", { name: "Source" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Destination" })).not.toBeInTheDocument();
});

it("keeps both path columns for copy previews", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "old.txt", destPath: "copy/old.txt", conflict: false }],
  });
  render(<OperationPreview request={request()} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(await screen.findByRole("columnheader", { name: "Source" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Destination" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
  expect(screen.getByTestId("operation-preview-scroll")).toHaveClass("overflow-auto", "min-w-0", "min-h-0");
  expect(screen.getByRole("table")).toHaveClass("min-w-max");
  expect(screen.getByRole("table").parentElement).toHaveClass("overflow-visible");
});

it("shows the destination root in operation preview paths", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "a.txt", destRoot: "media", destPath: "target/a.txt", conflict: false }],
  });

  render(<OperationPreview request={request()} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(await screen.findByText("media:/target/a.txt")).toBeInTheDocument();
});

it("shows the source root in operation preview paths", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [{ sourceRoot: "downloads", sourcePath: "a.txt", destPath: "target/a.txt", conflict: false }],
  });

  render(<OperationPreview request={request()} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(await screen.findByText("downloads:/a.txt")).toBeInTheDocument();
});

it("uses a destructive item-count label for delete", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [
      { sourcePath: "a.txt", conflict: false },
      { sourcePath: "b.txt", conflict: false },
    ],
  });
  render(
    <OperationPreview
      request={{ type: "delete", sourceRoot: "root", sources: ["a.txt", "b.txt"] }}
      onJobCreated={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  const confirm = await screen.findByRole("button", { name: "Delete 2 items" });
  expect(screen.getByText("Deleted items cannot be restored by FileButler.")).toBeInTheDocument();
  expect(confirm).toHaveAttribute("data-variant", "destructive");
});

it("prevents duplicate submission while a job is being created", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "a.txt", destPath: "a.txt", conflict: false }],
  });
  let resolveJob!: (value: { id: string }) => void;
  vi.mocked(api.opsCreateJob).mockReturnValue(new Promise((resolve) => { resolveJob = resolve; }));
  const onJobCreated = vi.fn();
  render(<OperationPreview request={request()} onJobCreated={onJobCreated} onClose={vi.fn()} />);

  const confirm = await screen.findByRole("button", { name: "Start copy" });
  await waitFor(() => expect(confirm).toBeEnabled());
  await userEvent.click(confirm);

  expect(confirm).toBeDisabled();
  await userEvent.click(confirm);
  expect(api.opsCreateJob).toHaveBeenCalledTimes(1);

  resolveJob({ id: "job_1" });
  await waitFor(() => expect(onJobCreated).toHaveBeenCalledWith("job_1", request()));
});

it("keeps confirmation disabled when the operation preview fails", async () => {
  vi.mocked(api.opsDryRun).mockRejectedValue(new Error("preview unavailable"));
  render(<OperationPreview request={request()} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(await screen.findByRole("alert")).toHaveTextContent("preview unavailable");
  expect(screen.getByRole("button", { name: "Start copy" })).toBeDisabled();
});

it("switches a drag preview from move to copy and submits the selected request", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "a.txt", destPath: "target/a.txt", conflict: false }],
  });
  vi.mocked(api.opsCreateJob).mockResolvedValue({ id: "job-copy" });
  const onJobCreated = vi.fn();
  const moveRequest = { type: "move" as const, sourceRoot: "a", sources: ["a.txt"], destRoot: "a", destPath: "target" };

  render(
    <OperationPreview
      request={moveRequest}
      operationChoices={["move", "copy"]}
      onJobCreated={onJobCreated}
      onClose={vi.fn()}
    />,
  );

  expect(await screen.findByRole("radio", { name: "move" })).toBeChecked();
  await userEvent.click(screen.getByRole("radio", { name: "copy" }));
  await waitFor(() => expect(api.opsDryRun).toHaveBeenLastCalledWith({ ...moveRequest, type: "copy" }, expect.any(AbortSignal)));
  const confirm = screen.getByRole("button", { name: "Start copy" });
  await waitFor(() => expect(confirm).toBeEnabled());
  await userEvent.click(confirm);

  expect(api.opsCreateJob).toHaveBeenCalledWith({ ...moveRequest, type: "copy" });
  expect(onJobCreated).toHaveBeenCalledWith("job-copy", { ...moveRequest, type: "copy" });
});

it("does not let an older dry run re-enable the wrong operation", async () => {
  let resolveMove!: (value: { hasConflict: boolean; items: never[] }) => void;
  vi.mocked(api.opsDryRun)
    .mockReturnValueOnce(new Promise((resolve) => { resolveMove = resolve; }))
    .mockResolvedValueOnce({ hasConflict: false, items: [] });
  const moveRequest = { type: "move" as const, sourceRoot: "a", sources: ["a.txt"], destRoot: "a", destPath: "target" };

  render(
    <OperationPreview
      request={moveRequest}
      operationChoices={["move", "copy"]}
      onJobCreated={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  await userEvent.click(screen.getByRole("radio", { name: "copy" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Start copy" })).toBeEnabled());
  resolveMove({ hasConflict: false, items: [] });
  await waitFor(() => expect(screen.getByRole("button", { name: "Start copy" })).toBeEnabled());
  expect(screen.queryByRole("button", { name: "Start move" })).not.toBeInTheDocument();
});

it("keeps toolbar previews fixed when operation choices are absent", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({ hasConflict: false, items: [] });
  render(<OperationPreview request={request()} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  await waitFor(() => expect(api.opsDryRun).toHaveBeenCalled());
  expect(screen.queryByRole("radiogroup", { name: "Operation" })).not.toBeInTheDocument();
});

it("focuses the popup and creates a job with Enter when the preview is ready", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "a.txt", destPath: "a.txt", conflict: false }],
  });
  vi.mocked(api.opsCreateJob).mockResolvedValue({ id: "job-enter" });
  const onJobCreated = vi.fn();
  render(<OperationPreview request={request()} onJobCreated={onJobCreated} onClose={vi.fn()} />);

  screen.getByRole("dialog", { name: "copy preview" });
  const content = screen.getByTestId("operation-preview-content");
  await waitFor(() => expect(screen.getByRole("button", { name: "Start copy" })).toBeEnabled());
  await waitFor(() => expect(content).toHaveFocus());
  await userEvent.keyboard("{Enter}");

  expect(api.opsCreateJob).toHaveBeenCalledWith(request());
  expect(onJobCreated).toHaveBeenCalledWith("job-enter", request());
});

it("ignores Enter while the operation preview has conflicts", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: true,
    items: [{ sourcePath: "a.txt", destPath: "a.txt", conflict: true }],
  });
  render(<OperationPreview request={request()} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  const dialog = screen.getByRole("dialog", { name: "copy preview" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Start copy" })).toBeDisabled());
  dialog.focus();
  await userEvent.keyboard("{Enter}");

  expect(api.opsCreateJob).not.toHaveBeenCalled();
});

function request() {
  return { type: "copy" as const, sourceRoot: "a", sources: ["a.txt"], destRoot: "b", destPath: "." };
}
