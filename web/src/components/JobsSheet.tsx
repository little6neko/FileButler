import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "../api/client";
import type { Job, PlanItem } from "../api/types";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";

type JobDetail = Job & { items: PlanItem[] };
type Filter = "all" | "running" | "completed";

const activeStatuses = new Set(["pending", "running", "cancel_requested"]);

export function JobsSheet({
  open,
  onOpenChange,
  onActiveCountChange,
  labels = strings.en,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onActiveCountChange(count: number): void;
  labels?: UIStrings;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let active = true;

    async function loadJobs() {
      let list: Job[];
      try {
        list = await api.jobs();
      } catch {
        return;
      }
      if (!active) return;
      setJobs(list);
      setSelectedID((current) => (current && list.some((job) => job.id === current) ? current : list[0]?.id ?? null));
      onActiveCountChange(list.filter((job) => activeStatuses.has(job.status)).length);
    }

    void loadJobs();
    const interval = window.setInterval(loadJobs, 2000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [onActiveCountChange]);

  useEffect(() => {
    if (!open || !selectedID) return;
    const jobID = selectedID;
    let active = true;

    async function loadDetail() {
      let next: JobDetail;
      try {
        next = await api.job(jobID);
      } catch {
        return;
      }
      if (active) setDetail(next);
    }

    void loadDetail();
    const interval = window.setInterval(loadDetail, 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [open, selectedID]);

  const filteredJobs = useMemo(
    () =>
      jobs.filter((job) => {
        if (filter === "running") return activeStatuses.has(job.status);
        if (filter === "completed") return !activeStatuses.has(job.status);
        return true;
      }),
    [filter, jobs],
  );
  const activeCount = jobs.filter((job) => activeStatuses.has(job.status)).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-label={labels.jobs} className="w-[420px] gap-0 overflow-hidden sm:max-w-[420px]">
        <SheetHeader className="border-b">
          <SheetTitle>{labels.jobs}</SheetTitle>
          <SheetDescription>{labels.activeJobs(activeCount)}</SheetDescription>
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
                    onClick={() => setSelectedID(job.id)}
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

          {detail?.id === selectedID ? <JobDetails detail={detail} labels={labels} /> : null}
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
          {detail.items.map((item, index) => {
            const destination = item.destPath ?? item.targetPath;
            return (
              <li key={`${item.sourcePath}-${destination ?? index}`} className="rounded border bg-slate-50 px-2 py-1.5">
                <span className="font-medium text-slate-800">{item.sourcePath}</span>
                {destination ? <span className="ml-2 text-slate-400">→ {destination}</span> : null}
                {item.conflict ? <span className="ml-2 text-destructive">{item.errorText || item.errorCode}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {activeStatuses.has(detail.status) ? (
        <Button className="mt-3" variant="outline" size="sm" onClick={() => void api.cancelJob(detail.id)}>
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
