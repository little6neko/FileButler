import { useEffect, useState } from "react";
import { cloudCall, type CloudEntry } from "../cloud115";
import { cloudTextLimit, readCloudText, type CloudPreviewLink } from "../cloud115Preview";
import { mediaKindForPath } from "../media";
import { fileOpenKind } from "../fileOpenKind";
import { copyText } from "../copyText";
import { TextEditorSession } from "../textEditorSession";
import type { UIStrings } from "../i18n";
import { TextEditor } from "./TextEditor";
import { MediaPreviewContent } from "./MediaPreview";
import { Button } from "./ui/button";

export type CloudPreviewInstance = { entries: CloudEntry[]; entryId: string; accountId: string };
type PreviewState = { key: string; url: string; session?: TextEditorSession; loading: boolean; error: string };

export function Cloud115Preview({ instance, labels, onNavigate }: { instance: CloudPreviewInstance; labels: UIStrings; onNavigate(id: string): void }) {
  const entry = instance.entries.find((item) => item.id === instance.entryId)!;
  const openKind = fileOpenKind({ name: entry.name, type: entry.isDirectory ? "directory" : "file" });
  const kind = openKind.kind === "media" ? openKind.mediaKind : null;
  const descriptor = openKind.kind === "text" ? openKind.text : null;
  const supported = Boolean(kind || descriptor);
  const gallery = kind ? instance.entries.filter((item) => !item.isDirectory && mediaKindForPath(item.name) === kind) : [entry];
  const index = gallery.findIndex((item) => item.id === entry.id);
  const [attempt, setAttempt] = useState(0);
  const [invalidated, setInvalidated] = useState(false);
  const [state, setState] = useState<PreviewState | null>(null);
  const [copyResult, setCopyResult] = useState({ key: "", message: "" });
  const key = `${entry.id}:${attempt}`;
  const current = state?.key === key ? state : null;

  useEffect(() => {
    if (invalidated || !supported) return;
    const controller = new AbortController();
    let session: TextEditorSession | undefined;
    let url = "";
    async function load() {
      try {
        const link = await cloudCall<CloudPreviewLink>("preview.url", { id: entry.id, accountId: instance.accountId }, controller.signal);
        if (controller.signal.aborted) return;
        if (link.accountId !== instance.accountId) throw new Error("115账号已变化，请重新打开预览");
        const parsed = new URL(link.url);
        if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("无效预览直链");
        url = parsed.href;
        if (kind) { setState({ key, url, loading: true, error: "" }); return; }
        if (!descriptor) return;
        if (link.size > cloudTextLimit) throw new Error("文本超过10 MiB预览上限，请直接下载。");
        const document = await readCloudText(url, controller.signal);
        if (controller.signal.aborted) return;
        session = new TextEditorSession({ id: `cloud-preview-${entry.id}`, rootId: "@115", path: entry.id, fileName: entry.name, text: descriptor });
        session.applyLoadedDocument(document);
        setState({ key, url, session, loading: false, error: "" });
      } catch (error) {
        if (!controller.signal.aborted) setState({ key, url, loading: false, error: error instanceof Error ? error.message : "直链预览失败" });
      }
    }
    function accountChanged(event: Event) { if ((event as CustomEvent<{ accountId: string }>).detail?.accountId !== instance.accountId) return; controller.abort(); session?.dispose(); setState(null); setInvalidated(true); }
    window.addEventListener("cloud115-account-changed", accountChanged);
    void load();
    return () => { controller.abort(); session?.dispose(); window.removeEventListener("cloud115-account-changed", accountChanged); };
  }, [entry.id, entry.name, instance.accountId, key, kind, descriptor, supported, invalidated]);

  async function copyLink() {
    if (!current?.url || invalidated) return;
    try {
      await copyText(current.url);
      setCopyResult({ key, message: "直链已复制" });
    } catch {
      setCopyResult({ key, message: "复制失败，请检查浏览器剪贴板权限" });
    }
  }

  function mediaResult(error = "") { setState((value) => value?.key === key ? { ...value, loading: false, error } : value); }
  if (!supported) return null;
  return <div className="relative flex h-full min-h-0 flex-col" data-no-file-drop data-testid="cloud-preview">
    <div className="flex shrink-0 items-center gap-3 border-b p-2 text-sm" role="toolbar" aria-label="直链操作">
      {!invalidated && (!current || current.loading) ? <span role="status" className="min-w-0 truncate text-sm text-muted-foreground">正在直接从115加载…</span> : null}
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <Button size="sm" variant="outline" disabled={invalidated} onClick={() => setAttempt((value) => value + 1)}>重新获取直链</Button>
        <Button size="sm" variant="outline" disabled={!current?.url || invalidated} onClick={() => void copyLink()}>复制直链</Button>
      </div>
    </div>
    {invalidated ? <p role="alert" className="p-4">115账号已变化，请关闭并重新打开预览</p> : <>
      {copyResult.key === key && copyResult.message ? <p role="status" className="p-2 text-sm">{copyResult.message}</p> : null}
      {current?.error ? <p role="alert" className="p-3 text-sm text-destructive">{current.error}</p> : null}
      {current?.session ? <div className="min-h-0 flex-1"><TextEditor session={current.session} labels={labels} readOnly /></div> : null}
      {kind && current?.url ? <div className="media-preview-window-layout relative min-h-0 flex-1"><MediaPreviewContent kind={kind} name={entry.name} url={current.url} mediaKey={key} onLoad={() => mediaResult()} onError={() => mediaResult("浏览器无法显示该文件，可能是直链失效、格式或跨域限制")}
        canPrevious={index > 0} canNext={index < gallery.length - 1} previousLabel={labels.previousMedia} nextLabel={labels.nextMedia}
        onPrevious={() => { if (index > 0) onNavigate(gallery[index - 1].id); }} onNext={() => { if (index < gallery.length - 1) onNavigate(gallery[index + 1].id); }} /></div> : null}
    </>}
  </div>;
}
