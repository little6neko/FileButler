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
import { TransferDetails } from "./TransferProgress";
import { hasTransferProgress, jobFileProgress } from "../transferProgress";
import { useWorkspaceViewport } from "../workspaceViewport";
import { useMobileBack } from "../mobileBack";

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
  const { mobile } = useWorkspaceViewport();
  const [detailId, setDetailId] = useState<string | null>(null);
  const contextEventsStore = useOptionalJobEventsStore();
  const [fallbackEventsStore] = useState(() => new JobEventsStore());
  const jobEvents = eventsStore ?? contextEventsStore ?? fallbackEventsStore;
  const eventState = useSyncExternalStore(jobEvents.subscribe, jobEvents.getSnapshot, jobEvents.getSnapshot);
  const [filter, setFilter] = useState<Filter>("all");
  const [cancelingJobIDs, setCancelingJobIDs] = useState(() => new Set<string>());
  const [cancelErrors, setCancelErrors] = useState<Record<string, string>>({});
  const jobs = eventState.jobs;
  const detail = mobile ? jobs.find(job => job.id === detailId && activeJobStatuses.has(job.status)) : undefined;
  useMobileBack(open && Boolean(detail), () => setDetailId(null), 25, detail?.id);

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
    <Sheet open={open} onOpenChange={onOpenChange} modal={!mobile} disablePointerDismissal={mobile}>
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

        {detail ? <div className="min-h-0 flex-1 overflow-auto p-4 space-y-4">
          <Button variant="ghost" onClick={() => setDetailId(null)}>{labels.back}</Button>
          <h2>{labels.operationType(detail.type)} · {labels.jobStatus(detail.status)}</h2>
          <p>{jobFileProgress(detail, "current").count}</p>
          <TransferDetails job={detail} labels={labels} />
          {cancelErrors[detail.id] ? <p role="alert">{cancelErrors[detail.id]}</p> : null}
          <div className="flex gap-2">
            <Button variant="outline" disabled={cancelingJobIDs.has(detail.id) || detail.status === "cancel_requested" || detail.transfer?.cancelable === false} onClick={() => requestCancel(detail)}>{labels.cancel}</Button>
            <Button onClick={() => { setDetailId(null); onOpenChange(false); }}>{labels === strings["zh-CN"] ? "后台运行" : "Run in background"}</Button>
          </div>
        </div> : null}
        <div hidden={Boolean(detail)} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
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
                const fileProgress = jobFileProgress(job);
                const percent = fileProgress.percent;
                const active = activeJobStatuses.has(job.status);
                const canceling = cancelingJobIDs.has(job.id) && (job.status === "pending" || job.status === "running");
                const cancelDisabled = canceling || job.status === "cancel_requested" || job.transfer?.cancelable === false;
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
                          <span>{fileProgress.count}</span>
                          <span>{percent ?? "--"}%</span>
                        </span>
                        {summaryError ? <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px] text-destructive">{summaryError}</p> : null}
                        <TransferDetails job={job} labels={labels} />
                        {hasTransferProgress(job) && !["completed", "canceled"].includes(job.status) ? <Button size="sm" variant="ghost" onClick={() => { if (mobile) setDetailId(job.id); else { jobEvents.openProgress(job.id); onOpenChange(false); } }}>{labels === strings["zh-CN"] ? "查看进度" : "View progress"}</Button> : null}
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
