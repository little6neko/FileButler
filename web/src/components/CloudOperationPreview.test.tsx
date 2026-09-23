import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { cloudCall } from "../cloud115";
import { api } from "../api/client";
import { OperationPreview } from "./OperationPreview";

vi.mock("../cloud115", () => ({ cloudCall: vi.fn() }));
vi.mock("../api/client", () => ({ api: { opsDryRun: vi.fn(), opsCreateJob: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());

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
