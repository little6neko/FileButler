import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
    ? { copy: "复制", scan: "扫描", statistics: "正在统计…", hash: "校验秒传", upload: "上传", download: "下载", extract: "在线解压", waiting: "等待服务端", "delete-source": "删除源文件" }
    : { copy: "Copying", scan: "Scanning", statistics: "Calculating…", hash: "Checking instant upload", upload: "Uploading", download: "Downloading", extract: "Extracting", waiting: "Waiting for server", "delete-source": "Deleting source" };
  const percent = transfer.percent ?? (transfer.bytesTotal > 0 ? Math.min(100, transfer.bytesDone / transfer.bytesTotal * 100) : null);
  return <div className="grid gap-1 text-xs">
    <span className="truncate" title={transfer.file}>{phases[transfer.phase] ?? transfer.phase} · {transfer.file}</span>
    <Progress aria-label={transfer.scope ? (zh ? "文件夹总进度" : "Folder progress") : (zh ? "阶段进度" : "Phase progress")} value={percent} />
    <div className="flex flex-wrap items-center gap-x-3"><span>{transfer.scope
      ? `${bytes(transfer.bytesDone)} / ${transfer.bytesTotal > 0 || transfer.percent === 100 ? bytes(transfer.bytesTotal) : "—"}${percent !== null ? ` · ${Number(percent.toFixed(1))}%` : ""}`
      : transfer.percent !== undefined ? `${transfer.percent}%` : `${bytes(transfer.bytesDone)} / ${transfer.bytesTotal > 0 ? bytes(transfer.bytesTotal) : "—"}`}</span>
      {transfer.filesDone !== undefined && transfer.filesTotal !== undefined ? <span aria-label={zh ? "文件数进度" : "File count progress"}>{transfer.filesDone}/{transfer.filesTotal}</span> : null}
    </div>
    <span>{transfer.bytesPerSecond > 0 ? `${bytes(transfer.bytesPerSecond)}/s` : "—"} · {transfer.scope ? (zh ? "文件夹剩余" : "Folder remaining") : (zh ? "本阶段剩余" : "Phase remaining")} {transfer.remainingSeconds === undefined ? "—" : `${transfer.remainingSeconds}s`}</span>
    {transfer.warning ? <p role="status" className="whitespace-pre-wrap break-words text-amber-700">{transfer.warning}</p> : null}
  </div>;
}

export function TransferProgressWindows({ store, labels }: { store: JobEventsStore; labels: UIStrings }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const visible = state.jobs.filter((job) => state.progressJobIDs.includes(job.id) && hasTransferProgress(job) && !["completed", "canceled"].includes(job.status));
  const [orders, setOrders] = useState<Record<string, number>>({});
  const unopened = state.progressJobIDs.filter((id) => visible.some((job) => job.id === id) && orders[id] === undefined);
  if (unopened.length) {
    const top = Math.max(100, ...Object.values(orders));
    setOrders({ ...orders, ...Object.fromEntries(unopened.map((id, index) => [id, top + index + 1])) });
  }
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    function resize() { setViewport({ width: window.innerWidth, height: window.innerHeight }); }
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return visible.map((job, index) => {
    return <TransferWindow key={job.id} job={job} store={store} labels={labels} viewport={viewport} order={orders[job.id] ?? 100 + index}
      onFocus={() => {
        setOrders((current) => ({ ...current, [job.id]: Math.max(100, ...Object.values(current)) + 1 }));
      }} />;
  });
}

function TransferWindow({ job, store, labels, viewport, order, onFocus }: { job: Job; store: JobEventsStore; labels: UIStrings; viewport: { width: number; height: number }; order: number; onFocus(): void }) {
  const [anchor] = useState(() => store.getProgressAnchor(job.id) ?? { x: viewport.width / 2, y: viewport.height / 2 });
  const width = Math.max(180, Math.min(400, viewport.width - 24));
  const [point, setPoint] = useState(() => ({ x: anchor.x - width / 2, y: anchor.y - 130 }));
  const measure = useCallback((node: HTMLElement | null) => {
    if (node) setPoint({ x: anchor.x - node.getBoundingClientRect().width / 2, y: anchor.y - node.getBoundingClientRect().height / 2 });
  }, [anchor]);
  const position = { x: Math.max(8, Math.min(point.x, viewport.width - width - 8)), y: Math.max(8, Math.min(point.y, viewport.height - 160)), width, order };
  const gesture = useRef<(() => void) | null>(null);
  useEffect(() => () => gesture.current?.(), []);
  function beginMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button"))) return;
    event.preventDefault(); event.stopPropagation(); onFocus();
    gesture.current?.();
    gesture.current = bindPointerGesture(event, (dx, dy) => setPoint({ x: position.x + dx, y: position.y + dy }));
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
  return <section ref={measure} data-no-file-drop data-progress-job={job.id} role="dialog" aria-modal="false" aria-label={`${labels.operationType(job.type)} ${zh ? "进度" : "progress"}`} className="fixed overflow-auto rounded-lg border bg-background text-foreground shadow-xl"
    style={{ left: position.x, top: position.y, width: position.width, maxHeight: `calc(100dvh - ${position.y + 8}px)`, zIndex: position.order }} onPointerDown={onFocus}>
    <div className="desktop-window-titlebar sticky top-0 cursor-move" onPointerDown={beginMove}>
      <ListChecks /><strong>{labels.operationType(job.type)} · {labels.jobStatus(job.status)}</strong>
      <div className="desktop-window-controls">
        <Button size="icon-sm" variant="ghost" aria-label={labels.closeWindow} title={labels.closeWindow} onClick={() => store.closeProgress(job.id)}><X /></Button>
      </div>
    </div>
    <div className="grid gap-3 p-4">
    <span className="text-xs">{job.progressDone}/{job.progressTotal}</span>
    <span className="truncate text-xs text-muted-foreground">{job.sourceRootId === "@115" ? "115" : job.sourceRootId}{job.destRootId ? ` → ${job.destRootId === "@115" ? "115" : job.destRootId}` : ""}</span>
    <TransferDetails job={job} labels={labels} />
    {job.errorMessage || error ? <p role="alert" className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm text-destructive">{error || job.errorMessage}</p> : null}
    {active && job.transfer?.cancelable === false ? <p className="text-xs">{zh ? "当前服务端阶段不可取消" : "This server phase cannot be canceled"}</p> : null}
    <footer className="flex justify-end gap-2">
      <Button variant="outline" disabled={!active || canceling || job.status === "cancel_requested" || job.transfer?.cancelable === false} onClick={() => void cancel()}>{canceling || job.status === "cancel_requested" ? (zh ? "正在取消" : "Canceling") : (zh ? "取消" : "Cancel")}</Button>
      <Button onClick={() => store.closeProgress(job.id)}>{zh ? "后台运行" : "Run in background"}</Button>
    </footer>
    </div>
  </section>;
}
