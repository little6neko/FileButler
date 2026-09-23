import { useId, useState } from "react";
import { cloudCall } from "../cloud115";
import { Button } from "./ui/button";
import { WindowDialogLayer } from "./WindowDialogLayer";

export function Cloud115OfflineDialog({ target, onClose }: { target: { id: string; name: string }; onClose(): void }) {
  const titleId = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ url: string; error?: string }[]>([]);
  const links = [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];

  async function submit() {
    setBusy(true);
    setResults([]);
    const failed: string[] = [];
    for (const url of links) {
      try {
        await cloudCall("offline.add", { url, destId: target.id });
        setResults((current) => [...current, { url }]);
      } catch (error) {
        failed.push(url);
        setResults((current) => [...current, { url, error: String(error) }]);
      }
    }
    setText(failed.join("\n"));
    setBusy(false);
  }

  return <WindowDialogLayer labelledBy={titleId} onClose={() => { if (!busy) onClose(); }}>
    <div className="grid gap-3" data-no-file-drop="">
      <h2 id={titleId} className="font-semibold">离线下载</h2>
      <p className="break-all text-sm">保存到：{target.name}</p>
      <form className="grid min-w-0 gap-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <textarea aria-label="下载链接" placeholder="支持磁力、ed2k、HTTP/HTTPS、FTP，每行一条" autoFocus rows={6} className="w-full resize-y rounded border bg-background p-2 placeholder:text-muted-foreground" value={text} disabled={busy} onChange={(event) => setText(event.target.value)} />
        {links.length > 100 ? <p role="alert">每次最多提交100条链接</p> : null}
        {results.length ? <ul aria-live="polite" className="max-h-48 space-y-2 overflow-auto text-sm">{results.map((result) => <li key={result.url} className="break-all"><span className={result.error ? "text-destructive" : "text-green-700"}>{result.error ? `提交失败：${result.error}` : "已提交到115"}</span><p className="text-xs text-muted-foreground">{result.url}</p></li>)}</ul> : null}
        {results.some((result) => result.error) ? <p className="text-xs text-muted-foreground">失败项已保留。若连接中断或超时，请先到115核实任务是否已创建，再决定是否重试。</p> : null}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{results.length ? "关闭" : "取消"}</Button><Button type="submit" disabled={busy || !links.length || links.length > 100}>{busy ? `提交中（${results.length}/${links.length}）` : "提交"}</Button></div>
      </form>
    </div>
  </WindowDialogLayer>;
}
