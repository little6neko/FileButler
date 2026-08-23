import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "../api/client";
import type { Job } from "../api/types";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";
import { activeJobStatuses, JobEventsStore } from "../jobEvents";
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
  const [filter, setFilter] = useState<Filter>("all");
  const [cancelingJobIDs, setCancelingJobIDs] = useState(() => new Set<string>());
  const [cancelErrors, setCancelErrors] = useState<Record<string, string>>({});
  const jobs = eventState.jobs;

  useEffect(() => {
    onActiveCountChange?.(eventState.activeCount);
  }, [eventState.activeCount, onActiveCountChange]);

  const filteredJobs = useMemo(
    () =>
      jobs.filter((job) => {
        if (filter === "running") return activeJobStatuses.has(job.status);
        if (filter === "completed") return !activeJobStatuses.has(job.status);
        return true;
      }),
    [filter, jobs],
  );
  function requestCancel(job: Job) {
    if (cancelingJobIDs.has(job.id) || job.status === "cancel_requested") return;
    setCancelingJobIDs((current) => new Set(current).add(job.id));
    setCancelErrors((current) => removeRecordKey(current, job.id));
    void api.cancelJob(job.id).catch(() => {
      setCancelingJobIDs((current) => {
        const next = new Set(current);
        next.delete(job.id);
        return next;
      });
      setCancelErrors((current) => ({ ...current, [job.id]: labels.cancelJobFailed }));
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-label={labels.jobs} className="jobs-sheet-content w-[420px] gap-0 overflow-hidden sm:max-w-[420px]">
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
                const active = activeJobStatuses.has(job.status);
                const canceling = cancelingJobIDs.has(job.id) && (job.status === "pending" || job.status === "running");
                const cancelDisabled = canceling || job.status === "cancel_requested";
                const displayedStatus = canceling ? "cancel_requested" : job.status;
                const cancelLabel = labels.cancelJob(labels.operationType(job.type));
                const summaryError = failureSummary(job, labels);
                return (
                  <div key={job.id} className="grid gap-1">
                    <div className="job-row-shell">
                      <article
                        className={`job-row-main${active ? " job-row-main--cancelable" : ""}`}
                        aria-label={`${labels.operationType(job.type)} · ${labels.jobStatus(displayedStatus)}`}
                      >
                        <span className="flex items-center justify-between text-xs font-semibold">
                          <span>{labels.operationType(job.type)}</span>
                          <span>{labels.jobStatus(displayedStatus)}</span>
                        </span>
                        <Progress aria-label={labels.jobProgress(job.type)} value={percent} className="mt-2" />
                        <span className="mt-1 flex justify-between text-[11px] text-slate-500">
                          <span>{job.progressDone}/{job.progressTotal}</span>
                          <span>{percent}%</span>
                        </span>
                        {summaryError ? <p className="mt-1 text-[11px] text-destructive">{summaryError}</p> : null}
                      </article>
                      {active ? (
                        <button
                          type="button"
                          className="job-row-cancel"
                          aria-label={cancelLabel}
                          title={cancelLabel}
                          disabled={cancelDisabled}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            requestCancel(job);
                          }}
                        >
                          <X aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                    {cancelErrors[job.id] ? (
                      <p role="alert" className="px-1 text-xs text-destructive">{cancelErrors[job.id]}</p>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <p className="py-10 text-center text-sm text-slate-500">{labels.emptyJobs}</p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
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

function failureSummary(job: Job, labels: UIStrings) {
  const parts: string[] = [];
  if (job.failedCount > 0) parts.push(labels.failedItems(job.failedCount));
  if (job.errorMessage.trim()) parts.push(job.errorMessage.trim());
  return parts.join(" · ");
}

function removeRecordKey(record: Record<string, string>, key: string) {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}
