import { expect, it, vi } from "vitest";
import type { Job } from "./api/types";
import { JobEventsStore } from "./jobEvents";

it("loads active job summaries from the initial snapshot", () => {
  const store = new JobEventsStore();
  const onTerminal = vi.fn();
  store.subscribeTerminal(onTerminal);

  const running = makeJob({ status: "running", progressDone: 37, progressTotal: 100, eventVersion: 2 });
  store.handleSnapshot(makeSnapshot({ cursor: 2, jobs: [running] }));

  expect(store.getSnapshot()).toMatchObject({ runtimeId: "runtime-a", cursor: 2, activeCount: 1 });
  expect(store.getSnapshot().jobs).toEqual([running]);
  expect(onTerminal).not.toHaveBeenCalled();
});

it("merges coalesced progress and retains the terminal summary", () => {
  const store = new JobEventsStore();
  const onTerminal = vi.fn();
  store.subscribeTerminal(onTerminal);
  store.handleSnapshot(makeSnapshot({ cursor: 1, jobs: [makeJob({ status: "running", eventVersion: 1 })] }));

  store.handleChanged(makeEvent({
    cursor: 2,
    job: makeJob({ status: "running", progressDone: 70, progressTotal: 100, failedCount: 1, eventVersion: 2 }),
  }));
  const completed = makeJob({
    status: "completed_with_errors",
    progressDone: 100,
    progressTotal: 100,
    failedCount: 1,
    errorMessage: "permission denied",
    eventVersion: 3,
  });
  store.handleChanged(makeEvent({ cursor: 3, job: completed }));
  store.handleChanged(makeEvent({ cursor: 3, job: completed }));

  expect(store.getSnapshot().jobs).toEqual([completed]);
  expect(onTerminal).toHaveBeenCalledTimes(1);
  expect(onTerminal).toHaveBeenCalledWith([completed]);
});

it("marks missing active jobs interrupted on a reset and preserves page-local terminal history", () => {
  const store = new JobEventsStore();
  const onTerminal = vi.fn();
  store.subscribeTerminal(onTerminal);
  store.handleSnapshot(makeSnapshot({
    cursor: 5,
    jobs: [
      makeJob({ id: "missing", status: "running", eventVersion: 4, createdAtUnix: 3 }),
      makeJob({ id: "still-active", status: "running", eventVersion: 5, createdAtUnix: 2 }),
    ],
  }));
  store.handleChanged(makeEvent({
    cursor: 6,
    job: makeJob({ id: "done", status: "completed", eventVersion: 6, createdAtUnix: 1 }),
  }));

  store.handleSnapshot(makeSnapshot({
    runtimeId: "runtime-b",
    cursor: 1,
    reset: true,
    jobs: [makeJob({ id: "still-active", status: "running", eventVersion: 1, createdAtUnix: 2 })],
  }));

  expect(store.getSnapshot()).toMatchObject({ runtimeId: "runtime-b", cursor: 1, activeCount: 1 });
  expect(store.getSnapshot().jobs.find((job) => job.id === "missing")?.status).toBe("interrupted");
  expect(store.getSnapshot().jobs.find((job) => job.id === "still-active")?.eventVersion).toBe(1);
  expect(store.getSnapshot().jobs.find((job) => job.id === "done")?.status).toBe("completed");
  expect(onTerminal.mock.calls.flatMap(([jobs]) => jobs).some((job: Job) => job.status === "interrupted")).toBe(true);
});

it("retains every terminal job for the page lifetime", () => {
  const store = new JobEventsStore();
  store.handleSnapshot(makeSnapshot());
  for (let index = 1; index <= 75; index += 1) {
    store.handleChanged(makeEvent({
      cursor: index,
      job: makeJob({ id: `job_${index}`, status: "completed", eventVersion: index, createdAtUnix: index }),
    }));
  }

  expect(store.getSnapshot().jobs).toHaveLength(75);
  expect(store.getSnapshot().activeCount).toBe(0);
});

it("a newly created page store has no completed history", () => {
  const firstPage = new JobEventsStore();
  firstPage.handleSnapshot(makeSnapshot({ cursor: 1, jobs: [makeJob({ status: "running", eventVersion: 1 })] }));
  firstPage.handleChanged(makeEvent({ cursor: 2, job: makeJob({ status: "completed", eventVersion: 2 }) }));

  const refreshedPage = new JobEventsStore();
  refreshedPage.handleSnapshot(makeSnapshot({ cursor: 2, jobs: [] }));

  expect(firstPage.getSnapshot().jobs).toHaveLength(1);
  expect(refreshedPage.getSnapshot().jobs).toEqual([]);
});

it("handles a job that completed before its create response was observed", () => {
  const store = new JobEventsStore();
  const onTerminal = vi.fn();
  store.subscribeTerminal(onTerminal);
  store.handleSnapshot(makeSnapshot());
  const completed = makeJob({ id: "fast", status: "completed", eventVersion: 1 });
  store.handleChanged(makeEvent({ cursor: 1, job: completed }));

  store.registerCreatedJob("fast");
  store.registerCreatedJob("fast");

  expect(onTerminal).toHaveBeenCalledTimes(1);
  expect(onTerminal).toHaveBeenCalledWith([completed]);
});

it("ignores duplicate cursors and events from another runtime", () => {
  const store = new JobEventsStore();
  store.handleSnapshot(makeSnapshot({ cursor: 1, jobs: [makeJob({ status: "running", eventVersion: 1 })] }));
  store.handleChanged(makeEvent({ cursor: 2, job: makeJob({ status: "running", progressDone: 1, eventVersion: 2 }) }));
  store.handleChanged(makeEvent({ cursor: 2, job: makeJob({ status: "completed", eventVersion: 2 }) }));
  store.handleChanged(makeEvent({ runtimeId: "runtime-b", cursor: 3, job: makeJob({ status: "failed", eventVersion: 3 }) }));

  expect(store.getSnapshot().jobs[0]).toMatchObject({ status: "running", progressDone: 1 });
});

it("opens one EventSource, reports reconnecting, and closes it", () => {
  const source = new FakeEventSource();
  const factory = vi.fn(() => source);
  const store = new JobEventsStore(factory);
  const listener = vi.fn();
  store.subscribe(listener);

  store.start();
  store.start();
  expect(factory).toHaveBeenCalledTimes(1);
  expect(factory).toHaveBeenCalledWith("/api/jobs/events");

  source.onopen?.();
  expect(store.getSnapshot().connectionState).toBe("connected");
  source.emit("jobs.snapshot", makeSnapshot({
    cursor: 1,
    jobs: [makeJob({ status: "running", eventVersion: 1 })],
  }));
  expect(store.getSnapshot().jobs[0].status).toBe("running");
  source.onerror?.();
  expect(store.getSnapshot().connectionState).toBe("reconnecting");

  store.stop();
  expect(source.close).toHaveBeenCalledTimes(1);
});

class FakeEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  listeners = new Map<string, (event: MessageEvent<string>) => void>();

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, listener);
  }

  emit(type: string, payload: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }
}

function makeSnapshot(overrides: Partial<{
  runtimeId: string;
  cursor: number;
  reset: boolean;
  jobs: Job[];
}> = {}) {
  return {
    runtimeId: "runtime-a",
    cursor: 0,
    reset: false,
    jobs: [],
    ...overrides,
  };
}

function makeEvent(overrides: Partial<{
  runtimeId: string;
  cursor: number;
  job: Job;
}> = {}) {
  return {
    runtimeId: "runtime-a",
    cursor: 1,
    job: makeJob(),
    ...overrides,
  };
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
