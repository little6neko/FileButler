import { expect, it, vi } from "vitest";
import type { Job } from "./api/types";
import { JobEventsStore } from "./jobEvents";

it("uses the first snapshot as a baseline without refreshing historical terminal jobs", () => {
  const store = new JobEventsStore();
  const onTerminal = vi.fn();
  store.subscribeTerminal(onTerminal);

  store.handleSnapshot({
    cursor: 2,
    jobs: [makeJob({ id: "done", status: "completed", eventVersion: 2 })],
  });

  expect(store.getSnapshot().jobs.map((job) => job.id)).toEqual(["done"]);
  expect(onTerminal).not.toHaveBeenCalled();
});

it("merges live progress and notifies each terminal version once", () => {
  const store = new JobEventsStore();
  const onTerminal = vi.fn();
  store.subscribeTerminal(onTerminal);
  store.handleSnapshot({ cursor: 1, jobs: [makeJob({ status: "running", eventVersion: 1 })] });

  store.handleChanged({
    job: makeJob({ status: "running", progressDone: 1, eventVersion: 2 }),
    item: makeItem(0),
  });
  expect(store.getSnapshot().jobs[0].progressDone).toBe(1);
  expect(store.getItems("job_1")).toEqual([makeItem(0)]);
  expect(onTerminal).not.toHaveBeenCalled();

  const completed = makeJob({ status: "completed", progressDone: 1, eventVersion: 3 });
  store.handleChanged({ job: completed });
  store.handleChanged({ job: completed });
  store.handleChanged({ job: makeJob({ status: "running", eventVersion: 2 }) });

  expect(onTerminal).toHaveBeenCalledTimes(1);
  expect(onTerminal).toHaveBeenCalledWith([completed]);
  expect(store.getSnapshot().jobs[0].status).toBe("completed");
});

it("batches reconnect compensation and prunes catch-up-only terminal jobs", () => {
  const store = new JobEventsStore();
  const onTerminal = vi.fn();
  store.subscribeTerminal(onTerminal);
  store.handleSnapshot({ cursor: 1, jobs: [] });

  const completed = Array.from({ length: 55 }, (_, index) =>
    makeJob({
      id: `job_${index}`,
      status: "completed",
      createdAtUnix: index,
      eventVersion: index + 2,
    }),
  );
  store.handleSnapshot({ cursor: 56, jobs: completed });

  expect(onTerminal).toHaveBeenCalledTimes(1);
  expect(onTerminal.mock.calls[0][0]).toHaveLength(55);
  expect(store.getSnapshot().jobs).toHaveLength(50);
  expect(store.getSnapshot().snapshotRevision).toBe(2);
});

it("handles a job that completed before its create response was observed", () => {
  const store = new JobEventsStore();
  const onTerminal = vi.fn();
  store.subscribeTerminal(onTerminal);
  const completed = makeJob({ id: "fast", status: "completed", eventVersion: 2 });
  store.handleSnapshot({ cursor: 2, jobs: [completed] });

  store.registerCreatedJob("fast");
  store.registerCreatedJob("fast");

  expect(onTerminal).toHaveBeenCalledTimes(1);
  expect(onTerminal).toHaveBeenCalledWith([completed]);
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
  source.emit("jobs.snapshot", {
    cursor: 1,
    jobs: [makeJob({ status: "running", eventVersion: 1 })],
  });
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

function makeItem(index: number) {
  return {
    index,
    sourcePath: `${index}.txt`,
    destPath: `archive/${index}.txt`,
    status: "completed",
    errorCode: "",
    errorMessage: "",
  };
}
