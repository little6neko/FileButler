import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Job, PlanItem } from "../api/types";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";

type JobDetail = Job & { items: PlanItem[] };

export function JobsPanel({ open, labels = strings.en }: { open: boolean; labels?: UIStrings }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    async function load() {
      const list = await api.jobs();
      if (!active) return;
      setJobs(list);
      setSelectedID((current) => current ?? list[0]?.id ?? null);
    }
    void load();
    const id = window.setInterval(load, 2000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !selectedID) return;
    const jobID = selectedID;
    let active = true;
    async function loadDetail() {
      const next = await api.job(jobID);
      if (!active) return;
      setDetail(next);
    }
    void loadDetail();
    const id = window.setInterval(loadDetail, 1000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [open, selectedID]);

  if (!open) return null;
  return (
    <aside className="jobs-panel" aria-label={labels.jobs}>
      <h2>{labels.jobs}</h2>
      <ul>
        {jobs.map((job) => (
          <li key={job.id}>
            <button type="button" onClick={() => setSelectedID(job.id)}>
              {labels.operationType(job.type)} {labels.jobStatus(job.status)} {job.progressDone}/{job.progressTotal}
            </button>
          </li>
        ))}
      </ul>
      {detail ? (
        <section>
          <h3>{detail.id}</h3>
          <p>{labels.jobStatus(detail.status)}</p>
          {(detail.status === "running" || detail.status === "cancel_requested") && (
            <button type="button" onClick={() => api.cancelJob(detail.id)}>
              {labels.cancel}
            </button>
          )}
        </section>
      ) : null}
    </aside>
  );
}
