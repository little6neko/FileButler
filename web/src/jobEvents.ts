import type { Job, JobDetail, JobEvent, JobItem, JobSnapshot } from "./api/types";

export type JobConnectionState = "connecting" | "connected" | "reconnecting";

export type JobEventsState = {
  jobs: Job[];
  activeCount: number;
  connectionState: JobConnectionState;
  runtimeId: string | null;
  cursor: number;
  snapshotRevision: number;
};

type EventMessage = MessageEvent<string>;

export type EventSourceLike = {
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  addEventListener(type: string, listener: (event: EventMessage) => void): void;
  close(): void;
};

export type EventSourceFactory = (url: string) => EventSourceLike;

export const activeJobStatuses = new Set(["pending", "running", "cancel_requested"]);
export const terminalJobStatuses = new Set([
  "completed",
  "completed_with_errors",
  "failed",
  "canceled",
  "interrupted",
]);

export class JobEventsStore {
  private readonly eventSourceFactory: EventSourceFactory;
  private readonly jobsByID = new Map<string, Job>();
  private readonly itemsByJob = new Map<string, Map<number, JobItem>>();
  private readonly listeners = new Set<() => void>();
  private readonly terminalListeners = new Set<(jobs: Job[]) => void>();
  private readonly createdJobIDs = new Set<string>();
  private readonly notifiedTerminalVersions = new Map<string, number>();
  private source: EventSourceLike | null = null;
  private started = false;
  private hasBaseline = false;
  private state: JobEventsState = {
    jobs: [],
    activeCount: 0,
    connectionState: "connecting",
    runtimeId: null,
    cursor: 0,
    snapshotRevision: 0,
  };

  constructor(eventSourceFactory: EventSourceFactory = defaultEventSourceFactory) {
    this.eventSourceFactory = eventSourceFactory;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.setConnectionState("connecting");
    try {
      const source = this.eventSourceFactory("/api/jobs/events");
      this.source = source;
      source.onopen = () => {
        if (this.started) this.setConnectionState("connected");
      };
      source.onerror = () => {
        if (this.started) this.setConnectionState("reconnecting");
      };
      source.addEventListener("jobs.snapshot", (event) => this.handleSnapshot(event));
      source.addEventListener("job.changed", (event) => this.handleChanged(event));
    } catch {
      this.setConnectionState("reconnecting");
    }
  }

  stop() {
    this.started = false;
    this.source?.close();
    this.source = null;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  subscribeTerminal = (listener: (jobs: Job[]) => void) => {
    this.terminalListeners.add(listener);
    const pendingCreatedJobs = [...this.createdJobIDs]
      .map((id) => this.jobsByID.get(id))
      .filter((job): job is Job => Boolean(job && terminalJobStatuses.has(job.status)));
    this.notifyTerminalJobs(pendingCreatedJobs);
    return () => {
      this.terminalListeners.delete(listener);
    };
  };

  getSnapshot = () => this.state;

  getItems(jobID: string): JobItem[] {
    return [...(this.itemsByJob.get(jobID)?.values() ?? [])].sort((left, right) => left.index - right.index);
  }

  getDetail(jobID: string): JobDetail | null {
    const job = this.jobsByID.get(jobID);
    return job ? { ...job, items: this.getItems(jobID) } : null;
  }

  registerCreatedJob(jobID: string) {
    this.createdJobIDs.add(jobID);
    const job = this.jobsByID.get(jobID);
    if (job && terminalJobStatuses.has(job.status)) {
      this.notifyTerminalJobs([job]);
    }
  }

  handleSnapshot(snapshot: JobSnapshot | EventMessage) {
    const payload = this.parsePayload<JobSnapshot>(snapshot);
    if (!isJobSnapshot(payload)) return;

    const firstSnapshot = !this.hasBaseline;
    const runtimeChanged = this.state.runtimeId !== null && this.state.runtimeId !== payload.runtimeId;
    const authoritativeReset = payload.reset || runtimeChanged;
    const activeIDs = new Set(payload.jobs.map((detail) => detail.id));
    const terminalChanges: Job[] = [];

    if (authoritativeReset) {
      const interruptedAt = Math.floor(Date.now() / 1000);
      for (const [id, job] of this.jobsByID) {
        if (!activeJobStatuses.has(job.status) || activeIDs.has(id)) continue;
        const interrupted = {
          ...job,
          status: "interrupted",
          cancelRequested: false,
          updatedAtUnix: interruptedAt,
          finishedAtUnix: interruptedAt,
        };
        this.jobsByID.set(id, interrupted);
        terminalChanges.push(interrupted);
      }
    }

    for (const detail of payload.jobs) {
      const previous = this.jobsByID.get(detail.id);
      if (previous && terminalJobStatuses.has(previous.status)) continue;
      const snapshotJob = jobFromDetail(detail);
      const accepted = authoritativeReset ? true : this.mergeJob(snapshotJob);
      if (authoritativeReset) this.jobsByID.set(detail.id, jobFromDetail(detail));
      if (!accepted) continue;
      this.replaceItems(detail.id, detail.items);
      if (terminalJobStatuses.has(detail.status)) {
        if (!firstSnapshot || this.createdJobIDs.has(detail.id)) terminalChanges.push(detail);
      }
    }

    this.hasBaseline = true;
    this.state = {
      ...this.state,
      runtimeId: payload.runtimeId,
      cursor: payload.cursor,
      snapshotRevision: this.state.snapshotRevision + 1,
    };
    this.rebuildState();
    this.emit();
    this.notifyTerminalJobs(terminalChanges);
  }

  handleChanged(event: JobEvent | EventMessage) {
    const payload = this.parsePayload<JobEvent>(event);
    if (!isJobEvent(payload)) return;
    if (this.state.runtimeId !== null && payload.runtimeId !== this.state.runtimeId) return;
    if (payload.cursor <= this.state.cursor) return;

    const accepted = this.mergeJob(payload.job);
    this.state = { ...this.state, runtimeId: payload.runtimeId, cursor: payload.cursor };
    if (!accepted) return;
    if (payload.item) {
      const byIndex = this.itemsByJob.get(payload.job.id) ?? new Map<number, JobItem>();
      byIndex.set(payload.item.index, payload.item);
      this.itemsByJob.set(payload.job.id, byIndex);
    }
    if (Array.isArray(payload.items)) this.replaceItems(payload.job.id, payload.items);
    this.rebuildState();
    this.emit();
    if (this.hasBaseline && terminalJobStatuses.has(payload.job.status)) {
      this.notifyTerminalJobs([payload.job]);
    }
  }

  private mergeJob(job: Job) {
    const previous = this.jobsByID.get(job.id);
    if (previous && job.eventVersion <= previous.eventVersion) return false;
    this.jobsByID.set(job.id, job);
    return true;
  }

  private replaceItems(jobID: string, items: JobItem[]) {
    this.itemsByJob.set(jobID, new Map(items.map((item) => [item.index, item])));
  }

  private rebuildState() {
    const jobs = [...this.jobsByID.values()].sort(compareNewestJobs);
    this.state = {
      ...this.state,
      jobs,
      activeCount: jobs.filter((job) => activeJobStatuses.has(job.status)).length,
    };
  }

  private notifyTerminalJobs(jobs: Job[]) {
    if (!this.terminalListeners.size) return;
    const unique = new Map<string, Job>();
    for (const job of jobs) {
      const notifiedVersion = this.notifiedTerminalVersions.get(job.id) ?? -1;
      if (job.eventVersion <= notifiedVersion) continue;
      this.notifiedTerminalVersions.set(job.id, job.eventVersion);
      unique.set(job.id, job);
    }
    if (!unique.size) return;
    const changed = [...unique.values()].sort(compareNewestJobs);
    for (const listener of this.terminalListeners) listener(changed);
    for (const job of changed) this.createdJobIDs.delete(job.id);
  }

  private setConnectionState(connectionState: JobConnectionState) {
    if (this.state.connectionState === connectionState) return;
    this.state = { ...this.state, connectionState };
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private parsePayload<T>(value: T | EventMessage): T | null {
    if (typeof value === "object" && value !== null && "data" in value) {
      try {
        return JSON.parse(value.data) as T;
      } catch {
        return null;
      }
    }
    return value as T;
  }
}

function isJobSnapshot(value: JobSnapshot | null): value is JobSnapshot {
  return Boolean(
    value &&
    typeof value.runtimeId === "string" &&
    value.runtimeId.length > 0 &&
    Number.isFinite(value.cursor) &&
    typeof value.reset === "boolean" &&
    Array.isArray(value.jobs),
  );
}

function isJobEvent(value: JobEvent | null): value is JobEvent {
  return Boolean(
    value?.job &&
    typeof value.runtimeId === "string" &&
    value.runtimeId.length > 0 &&
    Number.isFinite(value.cursor),
  );
}

function jobFromDetail(detail: JobDetail): Job {
  const { items, ...job } = detail;
  void items;
  return job;
}

function compareNewestJobs(left: Job, right: Job) {
  return right.createdAtUnix - left.createdAtUnix || right.eventVersion - left.eventVersion || right.id.localeCompare(left.id);
}

function defaultEventSourceFactory(url: string): EventSourceLike {
  return new EventSource(url) as unknown as EventSourceLike;
}
