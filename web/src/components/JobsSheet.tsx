import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "../api/client";
import type { Job, JobDetail } from "../api/types";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";
import { activeJobStatuses, JobEventsStore, mergeJobDetail } from "../jobEvents";
import { useOptionalJobEventsStore } from "../jobEventsContext";

type Filter = "all" | "running" | "completed";

export function JobsSheet({
  open,
  onOpenChange,
  onActiveCountChange,
  eventsStore,
  labels = strings.en,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onActiveCountChange?(count: number): void;
  eventsStore?: JobEventsStore;
  labels?: UIStrings;
}) {
  const contextEventsStore = useOptionalJobEventsStore();
  const [fallbackEventsStore] = useState(() => new JobEventsStore());
  const jobEvents = eventsStore ?? contextEventsStore ?? fallbackEventsStore;
  const eventState = useSyncExternalStore(jobEvents.subscribe, jobEvents.getSnapshot, jobEvents.getSnapshot);
  const [requestedSelectedID, setRequestedSelectedID] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const reconciledSnapshots = useRef(new Map<string, number>());
  const jobs = eventState.jobs;
  const selectedID = requestedSelectedID && jobs.some((job) => job.id === requestedSelectedID)
    ? requestedSelectedID
    : jobs[0]?.id ?? null;

  useEffect(() => {
    onActiveCountChange?.(eventState.activeCount);
  }, [eventState.activeCount, onActiveCountChange]);

  useEffect(() => {
    if (!open || !selectedID) return;
    const jobID = selectedID;
    let active = true;

    void api.job(jobID).then(
      (next) => {
        if (!active) return;
        jobEvents.hydrateItems(jobID, next.items);
        setDetail(next);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [jobEvents, open, selectedID]);

  useEffect(() => {
    if (!open || !selectedID || !detail || detail.id !== selectedID || eventState.snapshotRevision <= 1) return;
    const snapshotRevision = eventState.snapshotRevision;
    const previousRevision = reconciledSnapshots.current.get(selectedID) ?? 1;
    if (snapshotRevision <= previousRevision) return;
    reconciledSnapshots.current.set(selectedID, snapshotRevision);
    const eventJob = jobs.find((job) => job.id === selectedID);
    if (!eventJob || eventJob.eventVersion <= detail.eventVersion) return;

    let active = true;
    void api.job(selectedID).then(
      (next) => {
        if (!active) return;
        jobEvents.hydrateItems(selectedID, next.items);
        setDetail(next);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [detail, eventState.snapshotRevision, jobEvents, jobs, open, selectedID]);

  const filteredJobs = useMemo(
    () =>
      jobs.filter((job) => {
        if (filter === "running") return activeJobStatuses.has(job.status);
        if (filter === "completed") return !activeJobStatuses.has(job.status);
        return true;
      }),
    [filter, jobs],
  );
  const selectedEventJob = selectedID ? jobs.find((job) => job.id === selectedID) : undefined;
  const displayedDetail = detail && selectedEventJob
    ? mergeJobDetail(detail, selectedEventJob, jobEvents.getItems(selectedEventJob.id))
    : detail;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-label={labels.jobs} className="w-[420px] gap-0 overflow-hidden sm:max-w-[420px]">
        <SheetHeader className="border-b">
          <SheetTitle>{labels.jobs}</SheetTitle>
          <SheetDescription className="flex items-center gap-2">
            <span>{labels.activeJobs(eventState.activeCount)}</span>
            {eventState.connectionState === "reconnecting" ? (
              <span className="text-amber-700">{labels.jobsReconnecting}</span>
            ) : null}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <div className="mt-4 flex gap-1 rounded-md bg-slate-100 p-1">
            {(["all", "running", "completed"] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={filter === value ? "secondary" : "ghost"}
                className="flex-1"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {filterLabel(value, labels)}
              </Button>
            ))}
          </div>

          <div className="mt-4 grid gap-2">
            {filteredJobs.length ? (
              filteredJobs.map((job) => {
                const percent = progressPercent(job);
                return (
                  <button
                    key={job.id}
                    type="button"
                    className="rounded-lg border bg-white p-3 text-left"
                    aria-pressed={selectedID === job.id}
                    onClick={() => setRequestedSelectedID(job.id)}
                  >
                    <span className="flex items-center justify-between text-xs font-semibold">
                      <span>{labels.operationType(job.type)}</span>
                      <span>{labels.jobStatus(job.status)}</span>
                    </span>
                    <Progress aria-label={labels.jobProgress(job.type)} value={percent} className="mt-2" />
                    <span className="mt-1 flex justify-between text-[11px] text-slate-500">
                      <span>{job.progressDone}/{job.progressTotal}</span>
                      <span>{percent}%</span>
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="py-10 text-center text-sm text-slate-500">{labels.emptyJobs}</p>
            )}
          </div>

          {displayedDetail?.id === selectedID ? <JobDetails detail={displayedDetail} labels={labels} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function JobDetails({ detail, labels }: { detail: JobDetail; labels: UIStrings }) {
  return (
    <section className="mt-5 border-t pt-4">
      <h3 className="text-sm font-semibold">{labels.operationType(detail.type)}</h3>
      <p className="mt-1 text-xs text-slate-500">
        {labels.jobStatus(detail.status)} · {detail.progressDone}/{detail.progressTotal}
      </p>
      {detail.items.length ? (
        <ul className="mt-3 grid gap-1 text-xs text-slate-600">
          {detail.items.map((item) => (
            <li key={item.index} className="rounded border bg-slate-50 px-2 py-1.5">
              <span className="font-medium text-slate-800">{item.sourcePath}</span>
              {item.destPath ? <span className="ml-2 text-slate-400">→ {item.destPath}</span> : null}
              {item.status === "failed" ? (
                <span className="ml-2 text-destructive">{item.errorMessage || item.errorCode}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {activeJobStatuses.has(detail.status) ? (
        <Button
          className="mt-3"
          variant="outline"
          size="sm"
          onClick={() => void api.cancelJob(detail.id).catch(() => undefined)}
        >
          {labels.cancel}
        </Button>
      ) : null}
    </section>
  );
}

function filterLabel(filter: Filter, labels: UIStrings) {
  if (filter === "running") return labels.runningJobs;
  if (filter === "completed") return labels.completedJobs;
  return labels.allJobs;
}

function progressPercent(job: Job) {
  return job.progressTotal ? Math.round((job.progressDone / job.progressTotal) * 100) : 0;
}
