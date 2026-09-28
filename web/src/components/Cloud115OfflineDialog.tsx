import { useEffect, useId, useState } from "react";
import { cloudCall, type CloudOfflineQuota } from "../cloud115";
import { Button } from "./ui/button";
import { DialogFooter } from "./ui/dialog";
import { Textarea } from "./ui/textarea";
import { WindowDialogLayer } from "./WindowDialogLayer";

export function Cloud115OfflineDialog({ target, onClose, onSubmitted }: { target: { id: string; name: string; accountId: string }; onClose(): void; onSubmitted?(): void }) {
  const titleId = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ url: string; error?: string }[]>([]);
  const [quotaRevision, setQuotaRevision] = useState(0);
  const links = [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];

  async function submit() {
    if (busy || !links.length || links.length > 100) return;
    setBusy(true);
    setResults([]);
    const failed: string[] = [];
    for (const url of links) {
      try {
        await cloudCall("offline.add", { url, destId: target.id, accountId: target.accountId });
        setResults((current) => [...current, { url }]);
      } catch (error) {
        failed.push(url);
        setResults((current) => [...current, { url, error: String(error) }]);
      }
    }
    setText(failed.join("\n"));
    setBusy(false);
    if (!failed.length) {
      onClose();
      onSubmitted?.();
      return;
    }
    setQuotaRevision((revision) => revision + 1);
  }

  return <WindowDialogLayer labelledBy={titleId} panelClassName="grid-rows-[minmax(0,1fr)]" onClose={() => { if (!busy) onClose(); }}>
    <form className="flex min-h-0 min-w-0 flex-col gap-4" data-no-file-drop="" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h2 id={titleId} className="shrink-0 font-heading text-base leading-none font-medium">离线下载</h2>
      <div className="-mx-1 grid min-h-0 gap-3 overflow-auto px-1 pb-1">
        <p className="break-all text-sm">保存到：{target.name}</p>
        <Textarea aria-label="下载链接" placeholder="支持磁力、ed2k、HTTP/HTTPS、FTP，每行一条" autoFocus rows={6} value={text} disabled={busy} onChange={(event) => setText(event.target.value)} />
        <OfflineQuota key={target.accountId} accountId={target.accountId} revision={quotaRevision} />
        {links.length > 100 ? <p role="alert">每次最多提交100条链接</p> : null}
        {results.length ? <ul aria-live="polite" className="max-h-48 space-y-2 overflow-auto text-sm">{results.map((result) => <li key={result.url} className="break-all"><span className={result.error ? "text-destructive" : "text-green-700"}>{result.error ? `提交失败：${result.error}` : "已提交到115"}</span><p className="text-xs text-muted-foreground">{result.url}</p></li>)}</ul> : null}
        {results.some((result) => result.error) ? <p className="text-xs text-muted-foreground">失败项已保留。若连接中断或超时，请先到115核实任务是否已创建，再决定是否重试。</p> : null}
      </div>
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{results.length ? "关闭" : "取消"}</Button><Button type="submit" disabled={busy || !links.length || links.length > 100}>{busy ? `提交中（${results.length}/${links.length}）` : "提交"}</Button></DialogFooter>
    </form>
  </WindowDialogLayer>;
}

function OfflineQuota({ accountId, revision }: { accountId: string; revision: number }) {
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ revision: number; retry: number; data?: CloudOfflineQuota; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    cloudCall<CloudOfflineQuota>("offline.quota", { accountId }, controller.signal).then(
      (data) => { if (!controller.signal.aborted) setResult({ revision, retry, data }); },
      (error) => { if (!controller.signal.aborted) setResult({ revision, retry, error: String(error) }); },
    );
    return () => controller.abort();
  }, [accountId, revision, retry]);
  const current = result?.revision === revision && result.retry === retry ? result : undefined;
  const format = (value: number) => value.toLocaleString("zh-CN");
  return <div role="status" className="flex flex-wrap items-center gap-2 text-sm" title={current?.error}>
    <span>{current?.data
      ? `离线配额：剩余 ${format(current.data.remaining)} / ${format(current.data.total)}`
      : current?.error ? "配额获取失败" : "离线配额：加载中…"}</span>
    {current?.error ? <Button type="button" variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>重试</Button> : null}
  </div>;
}
