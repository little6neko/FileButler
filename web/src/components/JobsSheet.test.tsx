import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Job, JobDetail } from "../api/types";
import { strings } from "../i18n";
import { JobEventsStore } from "../jobEvents";
import { JobsSheet } from "./JobsSheet";

vi.mock("../api/client", () => ({
  api: { jobs: vi.fn(), job: vi.fn(), cancelJob: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(api.jobs).mockReset();
  vi.mocked(api.job).mockReset();
  vi.mocked(api.cancelJob).mockReset();
});

it("reports active jobs from the event store while the sheet is closed", async () => {
  const store = storeWithJobs([
    makeJob({ id: "job_1", status: "running", eventVersion: 1 }),
    makeJob({ id: "job_2", status: "completed", eventVersion: 2 }),
  ]);
  const onActiveCountChange = vi.fn();

  render(
    <JobsSheet
      open={false}
      onOpenChange={vi.fn()}
      onActiveCountChange={onActiveCountChange}
      eventsStore={store}
    />,
  );

  await waitFor(() => expect(onActiveCountChange).toHaveBeenCalledWith(1));
  expect(api.jobs).not.toHaveBeenCalled();
  expect(api.job).not.toHaveBeenCalled();
});

it("renders an empty event snapshot without requesting a REST job list", async () => {
  const store = storeWithJobs([]);
  render(<JobsSheet open onOpenChange={vi.fn()} eventsStore={store} />);

  expect(await screen.findByText("No background jobs yet")).toBeInTheDocument();
  expect(api.jobs).not.toHaveBeenCalled();
  expect(api.job).not.toHaveBeenCalled();
});

it("renders progress, detail, and live item deltas", async () => {
  const store = storeWithJobs([makeJob({ status: "running", progressTotal: 4, progressDone: 1 })]);
  vi.mocked(api.job).mockResolvedValue(makeDetail({ status: "running", progressTotal: 4, progressDone: 1 }));

  render(<JobsSheet open onOpenChange={vi.fn()} eventsStore={store} />);

  expect(await screen.findByRole("progressbar", { name: "copy progress" })).toHaveAttribute("aria-valuenow", "25");
  expect(await screen.findByText("a.txt")).toBeInTheDocument();

  act(() => {
    store.handleChanged({
      job: makeJob({ status: "running", progressTotal: 4, progressDone: 2, eventVersion: 2 }),
      item: {
        index: 1,
        sourcePath: "b.txt",
        destPath: "archive/b.txt",
        status: "failed",
        errorCode: "operation_failed",
        errorMessage: "permission denied",
      },
    });
  });

  expect(await screen.findByText("b.txt")).toBeInTheDocument();
  expect(screen.getByText("permission denied")).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "copy progress" })).toHaveAttribute("aria-valuenow", "50");
  expect(api.job).toHaveBeenCalledTimes(1);
});

it("cancels through REST and waits for the event stream to update state", async () => {
  const store = storeWithJobs([makeJob({ status: "running" })]);
  vi.mocked(api.job).mockResolvedValue(makeDetail({ status: "running" }));
  vi.mocked(api.cancelJob).mockResolvedValue({ id: "job_1" });

  render(<JobsSheet open onOpenChange={vi.fn()} eventsStore={store} />);
  await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));

  expect(api.cancelJob).toHaveBeenCalledWith("job_1");
  expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
});

it("hides stale detail actions while another job detail is loading", async () => {
  const store = storeWithJobs([
    makeJob({ id: "job_1", status: "running", createdAtUnix: 2, eventVersion: 1 }),
    makeJob({ id: "job_2", type: "move", status: "completed", createdAtUnix: 1, eventVersion: 2 }),
  ]);
  vi.mocked(api.job)
    .mockResolvedValueOnce(makeDetail({ id: "job_1", status: "running", createdAtUnix: 2 }))
    .mockReturnValueOnce(new Promise(() => undefined));

  render(<JobsSheet open onOpenChange={vi.fn()} eventsStore={store} />);
  expect(await screen.findByRole("button", { name: "Cancel" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /move.*completed/i }));

  expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
});

it("filters event-driven jobs with translated controls", async () => {
  const store = storeWithJobs([
    makeJob({ id: "job_1", status: "running", eventVersion: 1 }),
    makeJob({ id: "job_2", type: "move", status: "completed", eventVersion: 2 }),
  ]);
  vi.mocked(api.job).mockResolvedValue(makeDetail({ id: "job_2", type: "move", status: "completed", eventVersion: 2 }));

  render(
    <JobsSheet open onOpenChange={vi.fn()} labels={strings["zh-CN"]} eventsStore={store} />,
  );

  expect(await screen.findByRole("dialog", { name: "任务" })).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "复制进度" })).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "移动进度" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "已完成" }));

  expect(screen.queryByRole("progressbar", { name: "复制进度" })).not.toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "移动进度" })).toBeInTheDocument();
});

it("reconciles selected detail once after a reconnect snapshot advances it", async () => {
  const store = storeWithJobs([makeJob({ status: "running", eventVersion: 1 })]);
  vi.mocked(api.job)
    .mockResolvedValueOnce(makeDetail({ status: "running", eventVersion: 1 }))
    .mockResolvedValueOnce(makeDetail({ status: "completed", progressDone: 1, eventVersion: 3 }));
  render(<JobsSheet open onOpenChange={vi.fn()} eventsStore={store} />);
  await waitFor(() => expect(api.job).toHaveBeenCalledTimes(1));

  act(() => {
    store.handleSnapshot({
      cursor: 3,
      jobs: [makeJob({ status: "completed", progressDone: 1, eventVersion: 3 })],
    });
  });

  await waitFor(() => expect(api.job).toHaveBeenCalledTimes(2));
  expect(await screen.findByText(/completed.*1\/1/i)).toBeInTheDocument();
});

it("shows reconnecting state without starting polling", async () => {
  const source = {
    onopen: null as (() => void) | null,
    onerror: null as (() => void) | null,
    addEventListener: vi.fn(),
    close: vi.fn(),
  };
  const store = new JobEventsStore(() => source);
  store.start();
  render(<JobsSheet open onOpenChange={vi.fn()} eventsStore={store} />);

  act(() => source.onerror?.());

  expect(await screen.findByText("Reconnecting")).toBeInTheDocument();
  expect(api.jobs).not.toHaveBeenCalled();
});

function storeWithJobs(jobs: Job[]) {
  const store = new JobEventsStore();
  store.handleSnapshot({ cursor: Math.max(0, ...jobs.map((job) => job.eventVersion)), jobs });
  return store;
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job_1",
    type: "copy",
    status: "pending",
    actorId: 1,
    sourceRootId: "root",
    progressTotal: 1,
    progressDone: 0,
    cancelRequested: false,
    errorMessage: "",
    createdAtUnix: 1,
    updatedAtUnix: 1,
    eventVersion: 1,
    ...overrides,
  };
}

function makeDetail(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    ...makeJob(),
    items: [{
      index: 0,
      sourcePath: "a.txt",
      destPath: "archive/a.txt",
      status: "completed",
      errorCode: "",
      errorMessage: "",
    }],
    ...overrides,
  };
}
