import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { strings } from "../i18n";
import { OperationPreview } from "./OperationPreview";

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
  expect(onJobCreated).toHaveBeenCalledWith("job_1");
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
  await waitFor(() => expect(onJobCreated).toHaveBeenCalledWith("job_1"));
});

it("keeps confirmation disabled when the operation preview fails", async () => {
  vi.mocked(api.opsDryRun).mockRejectedValue(new Error("preview unavailable"));
  render(<OperationPreview request={request()} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(await screen.findByRole("alert")).toHaveTextContent("preview unavailable");
  expect(screen.getByRole("button", { name: "Start copy" })).toBeDisabled();
});

function request() {
  return { type: "copy" as const, sourceRoot: "a", sources: ["a.txt"], destRoot: "b", destPath: "." };
}
