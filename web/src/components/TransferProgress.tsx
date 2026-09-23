import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ListChecks, X } from "lucide-react";
import { bindPointerGesture } from "../pointerGesture";
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
    ? { copy: "复制", scan: "扫描", hash: "校验秒传", upload: "上传", download: "下载", extract: "在线解压", waiting: "等待服务端", "delete-source": "删除源文件" }
    : { copy: "Copying", scan: "Scanning", hash: "Checking instant upload", upload: "Uploading", download: "Downloading", extract: "Extracting", waiting: "Waiting for server", "delete-source": "Deleting source" };
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
  const [positions, setPositions] = useState<Record<string, { x: number; y: number; order: number }>>({});
  const nextOrder = useRef(100);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    function resize() { setViewport({ width: window.innerWidth, height: window.innerHeight }); }
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return visible.map((job, index) => {
    const position = positions[job.id] ?? { x: viewport.width - 424 - index * 28, y: viewport.height - 370 - index * 28, order: 100 + index };
    const width = Math.max(180, Math.min(400, viewport.width - 24));
    const x = Math.max(8, Math.min(position.x, viewport.width - width - 8));
    const y = Math.max(8, Math.min(position.y, viewport.height - 160));
    return <TransferWindow key={job.id} job={job} store={store} labels={labels} position={{ x, y, width, order: position.order }}
      onFocus={() => {
        nextOrder.current = Math.max(nextOrder.current, 100 + visible.length) + 1;
        const order = nextOrder.current;
        setPositions((current) => ({ ...current, [job.id]: { ...(current[job.id] ?? position), order } }));
      }}
      onMove={(x, y) => setPositions((current) => ({ ...current, [job.id]: { x, y, order: current[job.id]?.order ?? position.order } }))} />;
  });
}

function TransferWindow({ job, store, labels, position, onFocus, onMove }: { job: Job; store: JobEventsStore; labels: UIStrings; position: { x: number; y: number; width: number; order: number }; onFocus(): void; onMove(x: number, y: number): void }) {
  const gesture = useRef<(() => void) | null>(null);
  useEffect(() => () => gesture.current?.(), []);
  function beginMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button"))) return;
    event.preventDefault(); event.stopPropagation(); onFocus();
    gesture.current?.();
    gesture.current = bindPointerGesture(event, (dx, dy) => onMove(position.x + dx, position.y + dy));
  }
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState("");
  const zh = labels === strings["zh-CN"];
  const active = activeJobStatuses.has(job.status);
  async function cancel() {
    setCanceling(true); setError("");
    try { await api.cancelJob(job.id); }
    catch { setCanceling(false); setError(labels.cancelJobFailed); }
  }
  return <section data-no-file-drop data-progress-job={job.id} role="dialog" aria-modal="false" aria-label={`${labels.operationType(job.type)} ${zh ? "进度" : "progress"}`} className="fixed overflow-auto rounded-lg border bg-background text-foreground shadow-xl"
    style={{ left: position.x, top: position.y, width: position.width, maxHeight: `calc(100dvh - ${position.y + 8}px)`, zIndex: position.order }} onPointerDown={onFocus}>
    <div className="desktop-window-titlebar sticky top-0 cursor-move" onPointerDown={beginMove}><ListChecks /><strong>{labels.operationType(job.type)} · {labels.jobStatus(job.status)}</strong><Button size="icon-sm" variant="ghost" aria-label={labels.closeWindow} onClick={() => store.closeProgress(job.id)}><X /></Button></div>
    <div className="grid gap-3 p-4">
    <span className="text-xs">{job.progressDone}/{job.progressTotal}</span>
    <span className="truncate text-xs text-muted-foreground">{job.sourceRootId === "@115" ? "115" : job.sourceRootId}{job.destRootId ? ` → ${job.destRootId === "@115" ? "115" : job.destRootId}` : ""}</span>
    <TransferDetails job={job} labels={labels} />
    {job.errorMessage || error ? <p role="alert" className="text-sm text-destructive">{error || job.errorMessage}</p> : null}
    {active && job.transfer?.cancelable === false ? <p className="text-xs">{zh ? "当前服务端阶段不可取消" : "This server phase cannot be canceled"}</p> : null}
    <footer className="flex justify-end gap-2">
      <Button variant="outline" disabled={!active || canceling || job.status === "cancel_requested" || job.transfer?.cancelable === false} onClick={() => void cancel()}>{canceling || job.status === "cancel_requested" ? (zh ? "正在取消" : "Canceling") : (zh ? "取消" : "Cancel")}</Button>
      <Button onClick={() => store.closeProgress(job.id)}>{zh ? "后台运行" : "Run in background"}</Button>
    </footer>
    </div>
  </section>;
}
