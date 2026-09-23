import type { Job } from "./api/types";

export function hasTransferProgress(job: Job) {
  return Boolean(job.transfer) || ["copy", "move", "upload", "download", "extract"].includes(job.type);
}
