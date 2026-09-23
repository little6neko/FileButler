import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { cloudCall } from "../cloud115";
import { api } from "../api/client";
import { OperationPreview } from "./OperationPreview";

vi.mock("../cloud115", () => ({ cloudCall: vi.fn() }));
vi.mock("../api/client", () => ({ api: { opsDryRun: vi.fn(), opsCreateJob: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());

it("aborts an unfinished cloud preview on mode change and unmount without submitting a job", async () => {
  const signals: AbortSignal[] = [];
  vi.mocked(cloudCall).mockImplementation((_method, _params, signal) => {
    signals.push(signal!);
    return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  });
  const view = render(<OperationPreview request={{ type: "move", sourceRoot: "@115", sources: ["1"], destRoot: "@115", destPath: "9", accountId: "7" }} operationChoices={["copy", "move"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);
  expect(signals).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Start move" })).toBeDisabled();
  await userEvent.click(screen.getByRole("radio", { name: "copy" }));
  expect(signals).toHaveLength(2);
  expect(signals[0].aborted).toBe(true);
  expect(signals[1].aborted).toBe(false);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  view.unmount();
  expect(signals[1].aborted).toBe(true);
  expect(vi.mocked(cloudCall).mock.calls.map(([method]) => method)).toEqual(["ops.preview", "ops.preview"]);
});

it.each([true, false])("shares preview and copy/move choices, warns before deleting the source (download=%s)", async (download) => {
  vi.mocked(cloudCall).mockImplementation(async (method, params) => method === "ops.preview" ? { items: [{ sourcePath: "a.txt", destPath: "a.txt", conflict: false }], hasConflict: false, previewToken: params?.type } : { id: "job" });
  const created = vi.fn();
  render(<OperationPreview request={{ type: "copy", sourceRoot: download ? "@115" : "local", sources: [download ? "1" : "a.txt"], destRoot: download ? "local" : "@115", destPath: "0", accountId: "7" }} operationChoices={["copy", "move"]} onJobCreated={created} onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Start copy" })).toBeEnabled());
  expect(vi.mocked(cloudCall).mock.calls.map(([method]) => method)).toEqual(["ops.preview"]);
  expect(screen.queryByText(/将删除/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("radio", { name: "move" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Start move" })).toBeEnabled());
  expect(screen.getByText(download ? "下载成功后将删除115上的源文件。" : "上传成功后将删除本地源文件。")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Start move" }));
  expect(cloudCall).toHaveBeenLastCalledWith("ops.create", { previewToken: "move", accountId: "7" });
  expect(api.opsCreateJob).not.toHaveBeenCalled();
  expect(api.opsDryRun).not.toHaveBeenCalled();
  expect(created).toHaveBeenCalledWith("job", expect.objectContaining({ type: "move" }));
});
