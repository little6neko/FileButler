import { useEffect, useId, useRef, useState } from "react";
import { ArrowUp, Folder } from "lucide-react";
import { api } from "../api/client";
import type { Entry, Root } from "../api/types";
import type { ExtractRequest, ExtractTarget } from "../localExtract";
import { strings, type UIStrings } from "../i18n";
import { displayPath, normalizeInput } from "../pathSegments";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogFooter } from "./ui/dialog";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  target: ExtractTarget;
  roots: Root[];
  labels: UIStrings;
  onClose(): void;
  onSubmit(request: ExtractRequest): Promise<void>;
};

export function ExtractDialog(props: Props) {
  const id = useId();
  return <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }}>
    <DialogContent aria-labelledby={id} showCloseButton={false} className="sm:max-w-md">
      <ExtractContent {...props} titleId={id} />
    </DialogContent>
  </Dialog>;
}

export function ExtractContent({ target, roots, labels, titleId, onClose, onSubmit }: Props & { titleId: string }) {
  const zh = labels === strings["zh-CN"];
  const [destRoot, setRoot] = useState(target.destRoot);
  const [destPath, setPath] = useState(target.destPath);
  const [pathDraft, setPathDraft] = useState(displayPath(target.destPath));
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const navigationGeneration = useRef(0);
  const [name, setName] = useState(target.name);
  const [password, setPassword] = useState("");
  const [browse, setBrowse] = useState(false);
  const [folders, setFolders] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalidName = name === "." || name === ".." || /[\\/:]/.test(name) || [...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
  useEffect(() => () => { navigationGeneration.current++; }, []);
  async function navigate(path: string, root = destRoot, showBrowser = true) {
    const normalized = normalizeInput(path);
    const generation = ++navigationGeneration.current;
    setLoading(true); setError(null); setBrowse(showBrowser);
    try {
      const entries = await api.browse(root, normalized);
      if (generation !== navigationGeneration.current) return false;
      setPath(normalized); setPathDraft(displayPath(normalized));
      setFolders(entries.filter((entry) => entry.type === "directory"));
      setSelectedFolder(null);
      return true;
    } catch (err) {
      if (generation === navigationGeneration.current) {
        setError(err instanceof Error ? err.message : String(err));
        setPathDraft(displayPath(root === destRoot ? destPath : "."));
      }
      return false;
    } finally { if (generation === navigationGeneration.current) setLoading(false); }
  }
  function changeRoot(root: string) {
    navigationGeneration.current++;
    setRoot(root); setPath("."); setPathDraft("/"); setSelectedFolder(null);
    setFolders([]); setError(null); setLoading(false);
    if (browse) void navigate(".", root);
  }
  async function submit() {
    if (busy || loading) return;
    setBusy(true); setError(null);
    try {
      const path = normalizeInput(pathDraft);
      if (path !== destPath && !await navigate(path, destRoot, browse)) return;
      await onSubmit({ ...target, destRoot, destPath: path, name, password });
    }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  return <form className="contents" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <h2 id={titleId} className="font-heading text-base leading-none font-medium">{zh ? "解压" : "Extract archive"}</h2>
    <div className="grid min-w-0 gap-3">
      <p className="truncate text-sm" title={target.sourcePath}>{target.sourcePath.split("/").pop()}</p>
      <label className="grid gap-2 text-sm">{zh ? "目标位置" : "Destination"}
        <select aria-label={zh ? "目标根目录" : "Destination root"} disabled={busy} className="h-8 min-w-0 rounded-lg border bg-background px-2" value={destRoot} onChange={(event) => changeRoot(event.target.value)}>
          {roots.map((root) => <option key={root.id} value={root.id}>{root.name}</option>)}
        </select>
      </label>
      <div className="flex gap-2">
        <Input aria-label={zh ? "目标路径" : "Destination path"} className="h-7 min-w-0 text-xs" disabled={busy} value={pathDraft} onChange={(event) => {
          navigationGeneration.current++; setLoading(false); setPathDraft(event.target.value);
        }} onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault(); event.stopPropagation();
            if (!event.nativeEvent.isComposing) void navigate(pathDraft);
          }
        }} />
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => {
          if (browse) { navigationGeneration.current++; setLoading(false); setBrowse(false); }
          else void navigate(pathDraft);
        }}>{zh ? "浏览" : "Browse"}</Button>
      </div>
      {browse ? <div className="max-h-36 overflow-auto rounded-lg border p-1" aria-label={zh ? "选择目标文件夹" : "Choose destination folder"}>
        <Button type="button" variant="ghost" size="sm" disabled={busy || loading || destPath === "."} onClick={() => void navigate(destPath.split("/").slice(0, -1).join("/") || ".")}><ArrowUp />{zh ? "上移" : "Up"}</Button>
        {loading ? <p className="px-2 text-sm text-muted-foreground">{zh ? "加载中…" : "Loading…"}</p> : folders.map((folder) => <button key={folder.relativePath} type="button"
          className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none select-none hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset data-[selected=true]:bg-blue-50 data-[selected=true]:ring-2 data-[selected=true]:ring-blue-500 data-[selected=true]:ring-inset disabled:opacity-50"
          data-selected={selectedFolder === folder.relativePath} aria-pressed={selectedFolder === folder.relativePath} disabled={busy}
          onClick={() => setSelectedFolder(folder.relativePath)}
          onDoubleClick={() => void navigate(folder.relativePath)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void navigate(folder.relativePath); } }}>
          <Folder className="size-4 shrink-0" /><span className="truncate">{folder.name}</span>
        </button>)}
      </div> : null}
      <label className="grid gap-2 text-sm">{zh ? "输出文件夹名称" : "Output folder name"}<Input autoFocus disabled={busy} value={name} placeholder={zh ? "留空则直接解压到目标位置" : "Leave blank to extract directly into the destination"} onChange={(event) => setName(event.target.value)} /></label>
      <Input aria-label={zh ? "解压密码" : "Archive password"} type="password" autoComplete="off" disabled={busy} placeholder={zh ? "解压密码（可选）" : "Password (optional)"} value={password} onChange={(event) => setPassword(event.target.value)} />
      <p className="text-xs text-muted-foreground">{name
        ? (zh ? "解压到新文件夹，不覆盖已有目录。失败或取消后保留部分文件。" : "Extract into a new folder without overwriting. Partial files remain on failure or cancellation.")
        : (zh ? "直接解压到目标位置，可复用已有子目录，不覆盖同名文件。失败或取消后保留部分文件。" : "Extract directly into the destination, reusing existing directories without overwriting files. Partial files remain on failure or cancellation.")}</p>
    </div>
    <ErrorBanner message={error} />
    <DialogFooter>
      <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{labels.cancel}</Button>
      <Button type="submit" disabled={busy || loading || !destRoot || invalidName}>{labels.confirm}</Button>
    </DialogFooter>
  </form>;
}
