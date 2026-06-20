import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { strings } from "../i18n";
import { JobsPanel } from "./JobsPanel";

vi.mock("../api/client", () => ({
  api: {
    jobs: vi.fn(),
    job: vi.fn(),
    cancelJob: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(api.jobs).mockReset();
  vi.mocked(api.job).mockReset();
  vi.mocked(api.cancelJob).mockReset();
});

it("polls job progress and renders completed status", async () => {
  vi.mocked(api.jobs).mockResolvedValue([{ id: "job_1", type: "copy", status: "completed", progressTotal: 1, progressDone: 1, errorMessage: "" }]);
  vi.mocked(api.job).mockResolvedValue({ id: "job_1", type: "copy", status: "completed", progressTotal: 1, progressDone: 1, errorMessage: "", items: [] });
  render(<JobsPanel open />);

  expect(await screen.findByText(/copy completed/)).toBeInTheDocument();
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 2100));
  });
  expect(api.jobs).toHaveBeenCalledTimes(2);
});

it("sends cancel request for a running job", async () => {
  vi.mocked(api.jobs).mockResolvedValue([{ id: "job_1", type: "copy", status: "running", progressTotal: 2, progressDone: 1, errorMessage: "" }]);
  vi.mocked(api.job).mockResolvedValue({ id: "job_1", type: "copy", status: "running", progressTotal: 2, progressDone: 1, errorMessage: "", items: [] });
  vi.mocked(api.cancelJob).mockResolvedValue({ id: "job_1" });
  render(<JobsPanel open />);

  await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(api.cancelJob).toHaveBeenCalledWith("job_1");
});

it("renders jobs labels and statuses in Chinese", async () => {
  vi.mocked(api.jobs).mockResolvedValue([{ id: "job_1", type: "copy", status: "running", progressTotal: 2, progressDone: 1, errorMessage: "" }]);
  vi.mocked(api.job).mockResolvedValue({ id: "job_1", type: "copy", status: "running", progressTotal: 2, progressDone: 1, errorMessage: "", items: [] });
  vi.mocked(api.cancelJob).mockResolvedValue({ id: "job_1" });

  render(<JobsPanel open labels={strings["zh-CN"]} />);

  expect(await screen.findByRole("complementary", { name: "任务" })).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "复制 运行中 1/2" })).toBeInTheDocument();
  expect(await screen.findByText("运行中")).toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: "取消" }));
  expect(api.cancelJob).toHaveBeenCalledWith("job_1");
});
