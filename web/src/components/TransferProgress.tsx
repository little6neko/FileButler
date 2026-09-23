import { useState, useSyncExternalStore } from "react";
import type { Job } from "../api/types";
import { api } from "../api/client";
import { activeJobStatuses, type JobEventsStore } from "../jobEvents";
import { strings, type UIStrings } from "../i18n";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { hasTransferProgress } from "../transferProgress";

function bytes(value: number) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
}

export function TransferDetails({ job, labels }: { job: Job; labels: UIStrings }) {
  const transfer = job.transfer;
  if (!transfer) return null;
  const zh = labels === strings["zh-CN"];
  const phases: Record<string, string> = zh
    ? { copy: "复制", scan: "扫描", hash: "校验秒传", upload: "上传", download: "下载", extract: "在线解压", waiting: "等待服务端" }
    : { copy: "Copying", scan: "Scanning", hash: "Checking instant upload", upload: "Uploading", download: "Downloading", extract: "Extracting", waiting: "Waiting for server" };
  const percent = transfer.percent ?? (transfer.bytesTotal > 0 ? Math.min(100, transfer.bytesDone / transfer.bytesTotal * 100) : null);
  return <div className="grid gap-1 text-xs">
    <span className="truncate" title={transfer.file}>{phases[transfer.phase] ?? transfer.phase} · {transfer.file}</span>
    <Progress aria-label={zh ? "阶段进度" : "Phase progress"} value={percent} />
    <span>{transfer.percent !== undefined ? `${transfer.percent}%` : `${bytes(transfer.bytesDone)} / ${transfer.bytesTotal > 0 ? bytes(transfer.bytesTotal) : "—"}`}</span>
    <span>{transfer.bytesPerSecond > 0 ? `${bytes(transfer.bytesPerSecond)}/s` : "—"} · {zh ? "本阶段剩余" : "Phase remaining"} {transfer.remainingSeconds === undefined ? "—" : `${transfer.remainingSeconds}s`}</span>
  </div>;
}

export function TransferProgressWindows({ store, labels }: { store: JobEventsStore; labels: UIStrings }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const visible = state.jobs.filter((job) => state.progressJobIDs.includes(job.id) && hasTransferProgress(job) && !["completed", "canceled"].includes(job.status));
  return <div className="pointer-events-none fixed right-4 bottom-14 z-[100] grid max-h-[75vh] gap-3 overflow-auto">
    {visible.map((job) => <TransferWindow key={job.id} job={job} store={store} labels={labels} />)}
  </div>;
}

function TransferWindow({ job, store, labels }: { job: Job; store: JobEventsStore; labels: UIStrings }) {
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState("");
  const zh = labels === strings["zh-CN"];
  const active = activeJobStatuses.has(job.status);
  async function cancel() {
    setCanceling(true); setError("");
    try { await api.cancelJob(job.id); }
    catch { setCanceling(false); setError(labels.cancelJobFailed); }
  }
  return <section data-no-file-drop role="dialog" aria-modal="false" aria-label={`${labels.operationType(job.type)} ${zh ? "进度" : "progress"}`} className="pointer-events-auto grid w-[min(400px,calc(100vw-32px))] gap-3 rounded-lg border bg-background p-4 text-foreground shadow-xl">
    <header className="flex items-center justify-between gap-3"><strong>{labels.operationType(job.type)} · {labels.jobStatus(job.status)}</strong><button type="button" aria-label={labels.closeWindow} onClick={() => store.closeProgress(job.id)}>×</button></header>
    <span className="text-xs">{job.progressDone}/{job.progressTotal}</span>
    <span className="truncate text-xs text-muted-foreground">{job.sourceRootId === "@115" ? "115" : job.sourceRootId}{job.destRootId ? ` → ${job.destRootId === "@115" ? "115" : job.destRootId}` : ""}</span>
    <TransferDetails job={job} labels={labels} />
    {job.errorMessage || error ? <p role="alert" className="text-sm text-destructive">{error || job.errorMessage}</p> : null}
    {active && job.transfer?.cancelable === false ? <p className="text-xs">{zh ? "当前服务端阶段不可取消" : "This server phase cannot be canceled"}</p> : null}
    <footer className="flex justify-end gap-2">
      <Button variant="outline" disabled={!active || canceling || job.status === "cancel_requested" || job.transfer?.cancelable === false} onClick={() => void cancel()}>{canceling || job.status === "cancel_requested" ? (zh ? "正在取消" : "Canceling") : (zh ? "取消" : "Cancel")}</Button>
      <Button onClick={() => store.closeProgress(job.id)}>{zh ? "后台运行" : "Run in background"}</Button>
    </footer>
  </section>;
}
