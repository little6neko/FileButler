import type { Job } from "./api/types";

export function hasTransferProgress(job: Job) {
  return Boolean(job.transfer) || ["copy", "move", "upload", "download", "extract"].includes(job.type);
}

export function dismissCompletedProgress(job: Job) {
  return job.status === "completed" || (job.status === "canceled" && !(job.type === "extract" && job.sourceRootId !== "@115" && job.errorMessage));
}

export function jobFileProgress(job: Job) {
  const batch = ["copy", "move", "download", "upload"].includes(job.type)
    && !(job.type === "move" && job.sourceRootId === "@115" && job.destRootId === "@115");
  const done = batch ? job.transfer?.filesDone : job.progressDone;
  const total = batch ? job.transfer?.filesTotal : job.progressTotal;
  if (done === undefined || total === undefined) return { count: "-/-", percent: null };
  const percent = job.status === "completed" ? 100 : total ? Math.min(batch ? 99.9 : 100, done / total * 100) : 0;
  return { count: `${done}/${total}`, percent: Number(percent.toFixed(1)) };
}
