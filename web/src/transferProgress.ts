import type { Job } from "./api/types";

export function hasTransferProgress(job: Job) {
  return Boolean(job.transfer) || ["copy", "move", "upload", "download", "extract"].includes(job.type);
}

export function dismissCompletedProgress(job: Job) {
  return job.status === "completed" || (job.status === "canceled" && !(job.type === "extract" && job.sourceRootId !== "@115" && job.errorMessage));
}
