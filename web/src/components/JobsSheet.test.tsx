import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { strings } from "../i18n";
import { JobsSheet } from "./JobsSheet";

vi.mock("../api/client", () => ({
  api: { jobs: vi.fn(), job: vi.fn(), cancelJob: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(api.jobs).mockReset();
  vi.mocked(api.job).mockReset();
  vi.mocked(api.cancelJob).mockReset();
});

it("reports active jobs even while the sheet is closed", async () => {
  const onActiveCountChange = vi.fn();
  vi.mocked(api.jobs).mockResolvedValue([
    { id: "job_1", type: "copy", status: "running", progressTotal: 4, progressDone: 2, errorMessage: "" },
    { id: "job_2", type: "move", status: "completed", progressTotal: 1, progressDone: 1, errorMessage: "" },
  ]);

  render(<JobsSheet open={false} onOpenChange={vi.fn()} onActiveCountChange={onActiveCountChange} />);

  await waitFor(() => expect(onActiveCountChange).toHaveBeenCalledWith(1));
  expect(api.job).not.toHaveBeenCalled();
});

it("renders progress and selected-job details in the open sheet", async () => {
  vi.mocked(api.jobs).mockResolvedValue([
    { id: "job_1", type: "copy", status: "running", progressTotal: 4, progressDone: 2, errorMessage: "" },
  ]);
  vi.mocked(api.job).mockResolvedValue({
    id: "job_1",
    type: "copy",
    status: "running",
    progressTotal: 4,
    progressDone: 2,
    errorMessage: "",
    items: [{ sourcePath: "a.txt", destPath: "archive/a.txt", conflict: false }],
  });

  render(<JobsSheet open onOpenChange={vi.fn()} onActiveCountChange={vi.fn()} />);

  expect(await screen.findByRole("dialog", { name: "Jobs" })).toBeInTheDocument();
  expect(await screen.findByRole("progressbar", { name: "copy progress" })).toHaveAttribute("aria-valuenow", "50");
  expect(await screen.findByText("a.txt")).toBeInTheDocument();
  expect(screen.getByText(/archive\/a\.txt/)).toBeInTheDocument();
});

it("cancels a running selected job", async () => {
  vi.mocked(api.jobs).mockResolvedValue([
    { id: "job_1", type: "copy", status: "running", progressTotal: 2, progressDone: 1, errorMessage: "" },
  ]);
  vi.mocked(api.job).mockResolvedValue({
    id: "job_1",
    type: "copy",
    status: "running",
    progressTotal: 2,
    progressDone: 1,
    errorMessage: "",
    items: [],
  });
  vi.mocked(api.cancelJob).mockResolvedValue({ id: "job_1" });

  render(<JobsSheet open onOpenChange={vi.fn()} onActiveCountChange={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));

  expect(api.cancelJob).toHaveBeenCalledWith("job_1");
});

it("hides stale detail actions while another job detail is loading", async () => {
  vi.mocked(api.jobs).mockResolvedValue([
    { id: "job_1", type: "copy", status: "running", progressTotal: 2, progressDone: 1, errorMessage: "" },
    { id: "job_2", type: "move", status: "completed", progressTotal: 1, progressDone: 1, errorMessage: "" },
  ]);
  vi.mocked(api.job)
    .mockResolvedValueOnce({
      id: "job_1",
      type: "copy",
      status: "running",
      progressTotal: 2,
      progressDone: 1,
      errorMessage: "",
      items: [],
    })
    .mockReturnValueOnce(new Promise(() => undefined));

  render(<JobsSheet open onOpenChange={vi.fn()} onActiveCountChange={vi.fn()} />);
  expect(await screen.findByRole("button", { name: "Cancel" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /move.*completed/i }));

  expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
});

it("filters jobs with translated controls", async () => {
  vi.mocked(api.jobs).mockResolvedValue([
    { id: "job_1", type: "copy", status: "running", progressTotal: 2, progressDone: 1, errorMessage: "" },
    { id: "job_2", type: "move", status: "completed", progressTotal: 1, progressDone: 1, errorMessage: "" },
  ]);
  vi.mocked(api.job).mockResolvedValue({
    id: "job_1",
    type: "copy",
    status: "running",
    progressTotal: 2,
    progressDone: 1,
    errorMessage: "",
    items: [],
  });

  render(
    <JobsSheet
      open
      onOpenChange={vi.fn()}
      onActiveCountChange={vi.fn()}
      labels={strings["zh-CN"]}
    />,
  );

  expect(await screen.findByRole("dialog", { name: "任务" })).toBeInTheDocument();
  expect(await screen.findByRole("progressbar", { name: "复制进度" })).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "移动进度" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "已完成" }));

  expect(screen.queryByRole("progressbar", { name: "复制进度" })).not.toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "移动进度" })).toBeInTheDocument();
});

it("keeps background list polling failures contained", async () => {
  vi.mocked(api.jobs).mockRejectedValue(new Error("offline"));
  const onActiveCountChange = vi.fn();

  render(<JobsSheet open={false} onOpenChange={vi.fn()} onActiveCountChange={onActiveCountChange} />);

  await waitFor(() => expect(api.jobs).toHaveBeenCalled());
  expect(onActiveCountChange).not.toHaveBeenCalled();
});

it("keeps detail polling failures contained", async () => {
  vi.mocked(api.jobs).mockResolvedValue([
    { id: "job_1", type: "copy", status: "running", progressTotal: 2, progressDone: 1, errorMessage: "" },
  ]);
  vi.mocked(api.job).mockRejectedValue(new Error("offline"));

  render(<JobsSheet open onOpenChange={vi.fn()} onActiveCountChange={vi.fn()} />);

  await waitFor(() => expect(api.job).toHaveBeenCalledWith("job_1"));
  expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
});
