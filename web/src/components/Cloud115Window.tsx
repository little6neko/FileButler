import { useCallback, useEffect, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ArrowLeft, ArrowRight, ArrowUp, File, Folder, RefreshCw } from "lucide-react";
import { cloudCall, type CloudEntry, type CloudPage, type CloudRequest } from "../cloud115";
import { useOptionalJobEventsStore } from "../jobEventsContext";
import { Button } from "./ui/button";

type Location = { id: string; name: string }[];
type Prompt = { method: "mkdir" | "rename" | "delete" | "extract"; name: string; password: string };

export function Cloud115Window({ windowId, layer, onJobCreated }: { windowId: string; layer: number; onJobCreated(id: string): void }) {
  const events = useOptionalJobEventsStore();
  const [loggedIn, setLoggedIn] = useState(false);
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState<CloudPage>({ entries: [], total: 0, offset: 0 });
  const [selection, setSelection] = useState<string[]>([]);
  const [history, setHistory] = useState<{ locations: Location[]; index: number }>({ locations: [[{ id: "0", name: "115网盘" }]], index: 0 });
  const trail = history.locations[history.index];
  const parent = trail[trail.length - 1];
  const [clipboard, setClipboard] = useState<{ method: "copy" | "move"; ids: string[] } | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const generation = useRef(0);
  const { setNodeRef: setDropNodeRef, isOver } = useDroppable({ id: `cloud115:${windowId}`, data: { kind: "current-directory", provider: "cloud115", pane: windowId, rootId: "@115", path: parent.id, label: parent.name, layer, windowId }, disabled: !loggedIn });

  const refresh = useCallback(async (offset = 0) => {
    const requestGeneration = ++generation.current;
    setLoading(true);
    try {
      const next = await cloudCall<CloudPage>("browse", { parentId: parent.id, offset });
      if (requestGeneration !== generation.current) return;
      setPage((current) => offset ? { ...next, entries: [...current.entries, ...next.entries] } : next);
      setSelection((current) => current.filter((id) => offset || next.entries.some((entry) => entry.id === id)));
      setError("");
    } catch (error) { if (requestGeneration === generation.current) setError(String(error)); }
    finally { if (requestGeneration === generation.current) setLoading(false); }
  }, [parent.id]);

  useEffect(() => {
    let disposed = false;
    void cloudCall<{ loggedIn: boolean }>("status").then((result) => { if (!disposed) setLoggedIn(result.loggedIn); }).catch((error) => { if (!disposed) setError(String(error)); });
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    // Directory changes synchronize the view with the remote provider.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (loggedIn) void refresh();
  }, [loggedIn, refresh]);
  useEffect(() => events?.subscribeTerminal((jobs) => {
    if (loggedIn && jobs.some((job) => job.sourceRootId === "@115" || job.destRootId === "@115")) void refresh();
  }), [events, loggedIn, refresh]);

  function navigate(next: Location) {
    generation.current++;
    setSelection([]);
    setPage({ entries: [], offset: 0, total: 0 });
    setHistory((current) => ({ locations: [...current.locations.slice(0, current.index + 1), next], index: current.index + 1 }));
  }

  async function login(method: "login.start" | "login.check" | "logout") {
    setBusy(true); setError("");
    try {
      const result = await cloudCall<{ image?: string; loggedIn?: boolean; status?: number }>(method);
      if (result.image) setImage(result.image);
      if (result.loggedIn !== undefined) setLoggedIn(result.loggedIn);
      if (result.loggedIn || method === "logout") setImage("");
      if (method === "login.check" && !result.loggedIn) setError(result.status === -1 || result.status === -2 ? "二维码已过期或取消，请重新获取" : "尚未确认登录，请在115客户端确认后重试");
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }

  async function submit(method: string, params: CloudRequest) {
    setBusy(true); setError("");
    try {
      const result = await cloudCall<{ id: string }>(method, params);
      onJobCreated(result.id);
      setPrompt(null); setSelection([]);
      if (method === "move") setClipboard(null);
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }

  if (!loggedIn) return <div className="grid h-full content-start justify-items-center gap-4 overflow-auto p-6">
    <h2 className="font-semibold">登录115网盘</h2>
    <p className="text-sm">使用115客户端扫描二维码。凭证仅保存在服务端。</p>
    {image ? <img src={image} width={220} height={220} alt="115登录二维码" /> : null}
    <div className="flex gap-2"><Button disabled={busy} onClick={() => void login("login.start")}>获取二维码</Button>{image ? <Button disabled={busy} onClick={() => void login("login.check")}>我已扫码，检查登录</Button> : null}</div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <Button variant="ghost" disabled={busy} onClick={() => void login("logout")}>清除失效登录</Button>
  </div>;

  return <div ref={setDropNodeRef} className={`flex h-full min-h-0 flex-col bg-background text-foreground ${isOver ? "ring-2 ring-inset ring-blue-500" : ""}`}>
    <div className="flex items-center gap-1 border-b p-2">
      <Button size="icon-sm" variant="ghost" title="返回" disabled={history.index === 0} onClick={() => setHistory((h) => ({ ...h, index: h.index - 1 }))}><ArrowLeft /></Button>
      <Button size="icon-sm" variant="ghost" title="前进" disabled={history.index === history.locations.length - 1} onClick={() => setHistory((h) => ({ ...h, index: h.index + 1 }))}><ArrowRight /></Button>
      <Button size="icon-sm" variant="ghost" title="上移" disabled={trail.length === 1} onClick={() => navigate(trail.slice(0, -1))}><ArrowUp /></Button>
      <div className="flex min-w-0 flex-1 overflow-auto">{trail.map((part, index) => <Button key={part.id} variant="ghost" size="sm" onClick={() => navigate(trail.slice(0, index + 1))}>{part.name}</Button>)}</div>
      <Button size="icon-sm" variant="ghost" title="刷新" disabled={loading} onClick={() => void refresh()}><RefreshCw /></Button>
    </div>
    <div className="flex flex-wrap gap-1 border-b p-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => setPrompt({ method: "mkdir", name: "", password: "" })}>新建文件夹</Button>
      <Button size="sm" variant="outline" disabled={busy || selection.length !== 1} onClick={() => setPrompt({ method: "rename", name: page.entries.find((entry) => entry.id === selection[0])?.name ?? "", password: "" })}>重命名</Button>
      <Button size="sm" variant="outline" disabled={!selection.length} onClick={() => setClipboard({ method: "copy", ids: [...selection] })}>复制</Button>
      <Button size="sm" variant="outline" disabled={!selection.length} onClick={() => setClipboard({ method: "move", ids: [...selection] })}>剪切</Button>
      <Button size="sm" variant="outline" disabled={busy || !clipboard} onClick={() => clipboard && void submit(clipboard.method, { ids: clipboard.ids, destId: parent.id })}>粘贴</Button>
      <Button size="sm" variant="outline" disabled={busy || !selection.length} onClick={() => setPrompt({ method: "delete", name: "", password: "" })}>删除</Button>
      <Button size="sm" variant="outline" disabled={busy || selection.length !== 1 || page.entries.find((entry) => entry.id === selection[0])?.isDirectory} onClick={() => setPrompt({ method: "extract", name: "", password: "" })}>在线解压</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void login("logout")}>退出登录</Button>
    </div>
    {error ? <p role="alert" className="px-3 py-2 text-sm text-destructive">{error}</p> : null}
    {prompt ? <form className="grid gap-2 border-b bg-muted p-3" onSubmit={(event) => { event.preventDefault(); void submit(prompt.method, { ids: selection, parentId: parent.id, destId: parent.id, name: prompt.name, password: prompt.password }); }}>
      {prompt.method === "delete" ? <p>确认删除选中的 {selection.length} 项？</p> : prompt.method === "extract" ? <><p className="text-sm">解压到当前目录下以压缩包命名的新文件夹；不覆盖已有目录。</p><input className="rounded border bg-background p-2" type="password" autoComplete="off" placeholder="解压密码（可选）" aria-label="解压密码" value={prompt.password} onChange={(event) => setPrompt({ ...prompt, password: event.target.value })} /></> : <input className="rounded border bg-background p-2" autoFocus required aria-label="名称" value={prompt.name} onChange={(event) => setPrompt({ ...prompt, name: event.target.value })} />}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setPrompt(null)}>取消</Button><Button type="submit" disabled={busy}>确认</Button></div>
    </form> : null}
    <div className="min-h-0 flex-1 overflow-auto" aria-label="115文件列表">
      <label className="flex gap-2 border-b p-2 text-sm"><input type="checkbox" checked={page.entries.length > 0 && page.entries.every((entry) => selection.includes(entry.id))} onChange={(event) => setSelection(event.target.checked ? page.entries.map((entry) => entry.id) : [])} />选择已加载项</label>
      {page.entries.map((entry) => <CloudRow key={entry.id} entry={entry} windowId={windowId} entries={page.entries.filter((item) => selection.includes(item.id))} selected={selection.includes(entry.id)} onSelect={(multiple) => setSelection((current) => multiple ? current.includes(entry.id) ? current.filter((id) => id !== entry.id) : [...current, entry.id] : [entry.id])} onOpen={() => entry.isDirectory && navigate([...trail, { id: entry.id, name: entry.name }])} />)}
      {loading ? <p className="p-3 text-sm">加载中…</p> : page.entries.length < page.total ? <Button variant="ghost" onClick={() => void refresh(page.entries.length)}>加载更多（{page.entries.length}/{page.total}）</Button> : !page.entries.length ? <p className="p-3 text-sm">文件夹为空</p> : null}
    </div>
    <footer className="border-t p-2 text-xs text-muted-foreground">{page.total} 项 · 已选 {selection.length} 项 · 与本地文件窗口拖放可上传/下载，保留源文件</footer>
  </div>;
}

function CloudRow({ entry, windowId, entries, selected, onSelect, onOpen }: { entry: CloudEntry; windowId: string; entries: CloudEntry[]; selected: boolean; onSelect(multiple: boolean): void; onOpen(): void }) {
  const { setNodeRef, attributes, listeners } = useDraggable({ id: `cloud115:${windowId}:${entry.id}`, data: { kind: "cloud115-entry", entries: selected ? entries : [entry] } });
  return <div ref={setNodeRef} {...attributes} {...listeners} className={`flex cursor-default items-center gap-2 border-b px-3 py-2 text-sm ${selected ? "bg-blue-100 text-slate-900" : "hover:bg-muted"}`} onClick={(event) => onSelect(event.ctrlKey || event.metaKey)} onDoubleClick={onOpen}>
    <input aria-label={`选择 ${entry.name}`} type="checkbox" checked={selected} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onChange={() => onSelect(true)} />
    {entry.isDirectory ? <Folder className="size-4 shrink-0" /> : <File className="size-4 shrink-0" />}<span className="min-w-0 flex-1 truncate" title={entry.name}>{entry.name}</span><span className="text-xs">{entry.isDirectory ? "文件夹" : `${entry.size.toLocaleString()} B`}</span>
  </div>;
}
