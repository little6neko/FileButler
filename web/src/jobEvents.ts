import type { Job, JobDetail, JobEvent, JobItem, JobSnapshot } from "./api/types";

export type JobConnectionState = "connecting" | "connected" | "reconnecting";

export type JobEventsState = {
  jobs: Job[];
  activeCount: number;
  connectionState: JobConnectionState;
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
export const terminalJobStatuses = new Set(["completed", "completed_with_errors", "failed", "canceled"]);

const terminalLimit = 50;

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
      // There is no polling fallback. EventSource will be available in the
      // browser; keeping the store reconnecting makes the failure visible to
      // the workspace without breaking the rest of the UI.
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

  hydrateItems(jobID: string, items: JobItem[]) {
    const byIndex = this.itemsByJob.get(jobID) ?? new Map<number, JobItem>();
    for (const item of items) byIndex.set(item.index, item);
    this.itemsByJob.set(jobID, byIndex);
    this.state = { ...this.state };
    this.emit();
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
    if (!payload || !Number.isFinite(payload.cursor) || !Array.isArray(payload.jobs)) return;

    const firstSnapshot = !this.hasBaseline;
    const terminalChanges: Job[] = [];
    for (const job of payload.jobs) {
      const previous = this.jobsByID.get(job.id);
      if (!this.mergeJob(job)) continue;
      if (terminalJobStatuses.has(job.status)) {
        if (firstSnapshot) {
          if (this.createdJobIDs.has(job.id)) terminalChanges.push(job);
        } else if (!previous || previous.eventVersion < job.eventVersion || !terminalJobStatuses.has(previous.status)) {
          terminalChanges.push(job);
        }
      }
    }
    this.hasBaseline = true;
    this.state = {
      ...this.state,
      cursor: Math.max(this.state.cursor, payload.cursor),
      snapshotRevision: this.state.snapshotRevision + 1,
    };
    this.pruneJobs();
    this.emit();
    this.notifyTerminalJobs(terminalChanges);
  }

  handleChanged(event: JobEvent | EventMessage) {
    const payload = this.parsePayload<JobEvent>(event);
    if (!payload?.job) return;
    const accepted = this.mergeJob(payload.job);
    if (!accepted) return;
    if (payload.item) {
      const byIndex = this.itemsByJob.get(payload.job.id) ?? new Map<number, JobItem>();
      byIndex.set(payload.item.index, payload.item);
      this.itemsByJob.set(payload.job.id, byIndex);
    }
    this.state = { ...this.state, cursor: Math.max(this.state.cursor, payload.job.eventVersion) };
    this.pruneJobs();
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

  private pruneJobs() {
    const terminalJobs = [...this.jobsByID.values()]
      .filter((job) => terminalJobStatuses.has(job.status))
      .sort(compareNewestJobs);
    const keepIDs = new Set(
      [...this.jobsByID.values()]
        .filter((job) => activeJobStatuses.has(job.status))
        .map((job) => job.id),
    );
    for (const job of terminalJobs.slice(0, terminalLimit)) keepIDs.add(job.id);
    for (const id of this.jobsByID.keys()) {
      if (keepIDs.has(id)) continue;
      this.jobsByID.delete(id);
      this.itemsByJob.delete(id);
    }
    this.state = {
      ...this.state,
      jobs: [...this.jobsByID.values()].sort(compareNewestJobs),
      activeCount: [...this.jobsByID.values()].filter((job) => activeJobStatuses.has(job.status)).length,
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

function compareNewestJobs(left: Job, right: Job) {
  return right.createdAtUnix - left.createdAtUnix || right.eventVersion - left.eventVersion || right.id.localeCompare(left.id);
}

function defaultEventSourceFactory(url: string): EventSourceLike {
  return new EventSource(url) as unknown as EventSourceLike;
}

export function mergeJobDetail(detail: JobDetail, eventJob: Job, eventItems: JobItem[]): JobDetail {
  const byIndex = new Map(detail.items.map((item) => [item.index, item]));
  for (const item of eventItems) byIndex.set(item.index, item);
  const latestJob = eventJob.eventVersion >= detail.eventVersion ? eventJob : detail;
  return { ...detail, ...latestJob, items: [...byIndex.values()].sort((left, right) => left.index - right.index) };
}
