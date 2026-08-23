import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Job } from "../api/types";
import { strings } from "../i18n";
import { JobEventsStore } from "../jobEvents";
import { JobsSheet } from "./JobsSheet";

vi.mock("../api/client", () => ({
  api: { cancelJob: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(api.cancelJob).mockReset();
});

it("reports active jobs from the event store while the sheet is closed", async () => {
  const store = storeWithJobs([
    makeJob({ id: "job_1", status: "running", eventVersion: 1 }),
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
});

it("renders an empty active snapshot without requesting REST history", async () => {
  const store = storeWithJobs([]);
  render(<JobsSheet open onOpenChange={vi.fn()} eventsStore={store} />);

  expect(await screen.findByRole("dialog", { name: "Jobs" })).toHaveClass("jobs-sheet-content");
  expect(screen.getByText("No background jobs yet")).toBeInTheDocument();
  expect(api.cancelJob).not.toHaveBeenCalled();
});

it("renders aggregate progress and failure summaries as a static task row", async () => {
  const store = storeWithJobs([
    makeJob({ status: "running", progressTotal: 4, progressDone: 1, failedCount: 1 }),
  ]);
  render(<JobsSheet open onOpenChange={vi.fn()} eventsStore={store} />);

  expect(await screen.findByRole("progressbar", { name: "copy progress" })).toHaveAttribute("aria-valuenow", "25");
  expect(screen.getByText("1 item failed")).toBeInTheDocument();
  expect(screen.getByRole("article", { name: /copy.*Running/i })).toHaveClass("job-row-main--cancelable");
  expect(screen.queryByRole("button", { name: /copy.*Running/i })).not.toBeInTheDocument();

  act(() => {
    store.handleChanged({
      runtimeId: "runtime-a",
      cursor: 2,
      job: makeJob({
        status: "running",
        progressTotal: 4,
        progressDone: 2,
        failedCount: 2,
        errorMessage: "permission denied",
        eventVersion: 2,
      }),
    });
  });

  expect(await screen.findByText("2 items failed · permission denied")).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "copy progress" })).toHaveAttribute("aria-valuenow", "50");
});

it("overlays a sibling cancel control without making the task row interactive", async () => {
  const store = storeWithJobs([
    makeJob({ id: "job_1", type: "copy", status: "running", createdAtUnix: 2, eventVersion: 1 }),
    makeJob({ id: "job_2", type: "move", status: "running", createdAtUnix: 1, eventVersion: 2 }),
  ]);
  vi.mocked(api.cancelJob).mockReturnValue(new Promise(() => undefined));
  render(<JobsSheet open onOpenChange={vi.fn()} eventsStore={store} />);

  const cancel = await screen.findByRole("button", { name: "Cancel move job" });
  const moveRow = screen.getByRole("article", { name: /move.*Running/i });
  const copyRow = screen.getByRole("article", { name: /copy.*Running/i });
  expect(cancel).toHaveClass("job-row-cancel");
  expect(cancel.parentElement).toBe(moveRow.parentElement);
  expect(moveRow.contains(cancel)).toBe(false);
  expect(moveRow).toHaveClass("job-row-main--cancelable");
  expect(copyRow).toHaveClass("job-row-main--cancelable");

  await userEvent.click(cancel);

  expect(api.cancelJob).toHaveBeenCalledWith("job_2");
  expect(cancel).toBeDisabled();
  expect(screen.getByRole("article", { name: /move.*Canceling/i })).toBeInTheDocument();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

  act(() => {
    store.handleChanged({
      runtimeId: "runtime-a",
      cursor: 3,
      job: makeJob({ id: "job_2", type: "move", status: "canceled", createdAtUnix: 1, eventVersion: 3 }),
    });
  });
  expect(screen.getByRole("article", { name: /move.*Canceled/i })).not.toHaveClass("job-row-main--cancelable");
  expect(screen.queryByRole("button", { name: "Cancel move job" })).not.toBeInTheDocument();
});

it("restores the cancel control and shows a row error when cancellation fails", async () => {
  const store = storeWithJobs([makeJob({ status: "running" })]);
  vi.mocked(api.cancelJob).mockRejectedValue(new Error("offline"));
  render(<JobsSheet open onOpenChange={vi.fn()} eventsStore={store} />);

  const cancel = await screen.findByRole("button", { name: "Cancel copy job" });
  await userEvent.click(cancel);

  await waitFor(() => expect(cancel).toBeEnabled());
  expect(screen.getByRole("alert")).toHaveTextContent("Unable to cancel this job");
  expect(screen.getByRole("article", { name: /copy.*Running/i })).toBeInTheDocument();
});

it("keeps a disabled X for cancel-requested work and removes it for terminal work", async () => {
  const store = storeWithJobs([
    makeJob({ id: "canceling", type: "move", status: "cancel_requested", createdAtUnix: 2, eventVersion: 2 }),
    makeJob({ id: "done", type: "copy", status: "completed", createdAtUnix: 1, eventVersion: 1 }),
  ]);
  render(<JobsSheet open onOpenChange={vi.fn()} eventsStore={store} />);

  expect(await screen.findByRole("button", { name: "Cancel move job" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Cancel copy job" })).not.toBeInTheDocument();
  expect(screen.getByRole("article", { name: /move.*Canceling/i })).toHaveClass("job-row-main--cancelable");
  expect(screen.getByRole("article", { name: /copy.*Completed/i })).not.toHaveClass("job-row-main--cancelable");
  expect(within(screen.getByRole("dialog", { name: "Jobs" })).getAllByRole("button", { name: /Cancel .* job/ })).toHaveLength(1);
});

it("filters terminal states, translates Rename, and shows aggregate failures", async () => {
  const store = storeWithJobs([
    makeJob({ id: "ordinary", type: "rename", status: "completed", createdAtUnix: 2, eventVersion: 2 }),
    makeJob({
      id: "power",
      type: "power_rename",
      status: "completed_with_errors",
      failedCount: 2,
      errorMessage: "权限不足",
      createdAtUnix: 1,
      eventVersion: 1,
    }),
    makeJob({ id: "active", type: "copy", status: "running", createdAtUnix: 3, eventVersion: 3 }),
  ]);
  render(<JobsSheet open onOpenChange={vi.fn()} labels={strings["zh-CN"]} eventsStore={store} />);

  expect(await screen.findByRole("progressbar", { name: "重命名进度" })).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "PowerRename进度" })).toBeInTheDocument();
  expect(screen.getByText("2 项失败 · 权限不足")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "已完成" }));

  expect(screen.queryByRole("progressbar", { name: "复制进度" })).not.toBeInTheDocument();
  expect(screen.getByText("重命名")).toBeInTheDocument();
  expect(screen.getByText("PowerRename")).toBeInTheDocument();
  expect(screen.getByText("完成但有错误")).toBeInTheDocument();
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
});

function storeWithJobs(jobs: Job[]) {
  const store = new JobEventsStore();
  store.handleSnapshot({
    runtimeId: "runtime-a",
    cursor: Math.max(0, ...jobs.map((job) => job.eventVersion)),
    reset: false,
    jobs,
  });
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
    failedCount: 0,
    cancelRequested: false,
    errorMessage: "",
    createdAtUnix: 1,
    updatedAtUnix: 1,
    eventVersion: 1,
    ...overrides,
  };
}
