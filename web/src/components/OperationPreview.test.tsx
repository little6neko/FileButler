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
  expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
});

it("creates a job from a conflict-free operation plan", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "a.txt", destPath: "a.txt", conflict: false }],
  });
  vi.mocked(api.opsCreateJob).mockResolvedValue({ id: "job_1" });
  const onJobCreated = vi.fn();
  render(<OperationPreview request={request()} onJobCreated={onJobCreated} onClose={vi.fn()} />);

  await waitFor(() => expect(screen.getByRole("button", { name: "Confirm" })).not.toBeDisabled());
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(onJobCreated).toHaveBeenCalledWith("job_1");
});

it("renders operation preview labels in Chinese", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "a.txt", destPath: "target/a.txt", conflict: false }],
  });

  render(<OperationPreview request={request()} labels={strings["zh-CN"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(await screen.findByRole("heading", { name: "复制预览" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "来源" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "目标" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "状态" })).toBeInTheDocument();
  expect(screen.getByText("就绪")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "确认" })).toBeInTheDocument();
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

function request() {
  return { type: "copy" as const, sourceRoot: "a", sources: ["a.txt"], destRoot: "b", destPath: "." };
}
