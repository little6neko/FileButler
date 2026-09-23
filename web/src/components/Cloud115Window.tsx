import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CloudDownload, FolderArchive, FolderPlus, LogOut, Pencil, ScanText, Trash2, WandSparkles } from "lucide-react";
import { cloudCall, cloudDirectory, isCloudArchive, type CloudEntry, type CloudLocation, type CloudRequest } from "../cloud115";
import { useCloudClipboard, setCloudClipboard, clearCloudClipboardIfUnchanged } from "../cloud115Clipboard";
import { useCloud115Login } from "../useCloud115Login";
import { createFileSelectionStore } from "../fileSelectionStore";
import { fileSelectionMode } from "../fileSelection";
import type { Entry } from "../api/types";
import { strings, type UIStrings } from "../i18n";
import { useOptionalJobEventsStore } from "../jobEventsContext";
import { Button } from "./ui/button";
import { Cloud115OfflineDialog } from "./Cloud115OfflineDialog";
import { WindowDialogLayer } from "./WindowDialogLayer";
import { FilePane } from "./FilePane";
import { ActionToolbar } from "./ActionToolbar";
import { createClipboardActions, type FileAction } from "./fileActions";

type Prompt = { method: "mkdir" | "rename" | "delete" | "extract"; name: string; password: string; ids: string[]; destId: string };
const rootLocation: CloudLocation = [{ id: "0", name: "115网盘" }];

export function Cloud115Window({ windowId, layer, onJobCreated, initialTrail = rootLocation, onOpenNewWindow, onPowerRename, onSuperRename, labels = strings["zh-CN"] }: {
  windowId: string; layer: number; onJobCreated(id: string): void;
  initialTrail?: CloudLocation; onOpenNewWindow?(trail: CloudLocation): void; labels?: UIStrings;
  onPowerRename?(parentId: string, ids: string[], sourceTitle: string): void;
  onSuperRename?(parentId: string, sourceTitle: string): void;
}) {
  const events = useOptionalJobEventsStore();
  const [loggedIn, setLoggedIn] = useState(false);
  const [profile, setProfile] = useState({ accountId: "", name: "115网盘" });
  const [image, setImage] = useState("");
  const [loginSession, setLoginSession] = useState("");
  const loginSucceeded = useCallback(() => {
    setImage(""); setLoginSession(""); setCloudClipboard(null);
    window.dispatchEvent(new Event("cloud115-account-changed"));
  }, []);
  const loginMessage = useCloud115Login(loginSession, loginSucceeded);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cloudEntries, setCloudEntries] = useState<CloudEntry[]>([]);
  const [selection] = useState(() => createFileSelectionStore([]));
  const summary = useSyncExternalStore(selection.subscribeSummary, selection.getSummary, selection.getSummary);
  const [history, setHistory] = useState<{ locations: CloudLocation[]; index: number }>({ locations: [initialTrail], index: 0 });
  const trail = history.locations[history.index];
  const parent = trail[trail.length - 1];
  const currentPath = trail.slice(1).map((part) => part.name).join("/") || ".";
  const clipboard = useCloudClipboard();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [offlineTarget, setOfflineTarget] = useState<{ id: string; name: string } | null>(null);
  const [contextPath, setContextPath] = useState<string | null>(null);
  const generation = useRef(0);
  const pathGeneration = useRef(0);
  const profileGeneration = useRef(0);
  const promptId = useId();
  const entries = useMemo<Entry[]>(() => cloudEntries.map((entry) => ({
    name: entry.name, relativePath: entry.id,
    navigationPath: (currentPath === "." ? "" : currentPath + "/") + entry.name,
    type: entry.isDirectory ? "directory" : "file", size: entry.size,
    mode: "", modifiedUnix: entry.modifiedUnix ?? 0, isSymlink: false,
  })), [cloudEntries, currentPath]);

  const refresh = useCallback(async () => {
    const requestGeneration = ++generation.current;
    setLoading(true);
    try {
      const next = await cloudDirectory(parent.id, () => requestGeneration === generation.current);
      if (requestGeneration !== generation.current) return;
      setCloudEntries(next);
      setListError("");
    } catch (error) { if (requestGeneration === generation.current) setListError(String(error)); }
    finally { if (requestGeneration === generation.current) setLoading(false); }
  }, [parent.id]);

  const refreshProfile = useCallback(async () => {
    const current = ++profileGeneration.current;
    try {
      const next = await cloudCall<{ accountId: string; name: string }>("profile");
      if (current === profileGeneration.current) setProfile(next);
    } catch (error) { if (current === profileGeneration.current) setError(String(error)); }
  }, []);

  useEffect(() => {
    let disposed = false;
    let checkGeneration = 0;
    async function check() {
      const current = ++checkGeneration;
      try {
        const status = await cloudCall<{ loggedIn: boolean }>("status");
        if (disposed || current !== checkGeneration) return;
        setLoggedIn(status.loggedIn);
        if (status.loggedIn) {
          await refreshProfile();
        }
      } catch (error) { if (!disposed && current === checkGeneration) setError(String(error)); }
    }
    function accountChanged() {
      generation.current++; pathGeneration.current++; profileGeneration.current++;
      selection.clear(); setCloudEntries([]); setProfile({ accountId: "", name: "115网盘" });
      setLoggedIn(false); setPrompt(null); setOfflineTarget(null);
      setLoginSession(""); setImage("");
      setHistory({ locations: [rootLocation], index: 0 });
      void check();
    }
    void check();
    window.addEventListener("cloud115-account-changed", accountChanged);
    function dispose() { disposed = true; generation.current++; pathGeneration.current++; profileGeneration.current++; window.removeEventListener("cloud115-account-changed", accountChanged); }
    return dispose;
  }, [selection, refreshProfile]);
  useEffect(() => {
    // Synchronize the remote directory after login and navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (loggedIn) void refresh();
  }, [loggedIn, refresh]);
  useEffect(() => events?.subscribeTerminal((jobs) => {
    if (loggedIn && jobs.some((job) => job.sourceRootId === "@115" || job.destRootId === "@115")) void refresh();
  }), [events, loggedIn, refresh]);

  function navigate(next: CloudLocation) {
    generation.current++; pathGeneration.current++;
    selection.clear(); setCloudEntries([]); setContextPath(null); setListError(""); setError("");
    setHistory((current) => ({ locations: [...current.locations.slice(0, current.index + 1), next], index: current.index + 1 }));
  }
  async function navigatePath(path: string) {
    const requested = ++pathGeneration.current;
    try {
      const next = await cloudCall<{ trail: CloudLocation }>("resolve", { path });
      if (requested === pathGeneration.current) navigate(next.trail);
    } catch (error) { if (requested === pathGeneration.current) setError(String(error)); }
  }
  function moveHistory(index: number) {
    generation.current++; pathGeneration.current++; selection.clear(); setCloudEntries([]); setListError("");
    setHistory((h) => ({ ...h, index }));
  }
  async function login(method: "login.start" | "logout") {
    setBusy(true); setError("");
    setLoginSession("");
    try {
      const result = await cloudCall<{ image?: string; loginSession?: string; loggedIn?: boolean }>(method);
      if (result.image && result.loginSession) { setImage(result.image); setLoginSession(result.loginSession); }
      if (result.loggedIn || method === "logout") {
        setImage(""); setCloudClipboard(null);
        window.dispatchEvent(new Event("cloud115-account-changed"));
      }
    } catch (error) {
      setError(String(error));
      // A previous check may have finished while a replacement QR was requested.
      if (method === "login.start") {
        try { if ((await cloudCall<{ loggedIn: boolean }>("status")).loggedIn) loginSucceeded(); } catch { /* Keep the original error. */ }
      }
    }
    finally { setBusy(false); }
  }
  async function submit(method: string, params: CloudRequest) {
    setBusy(true); setError("");
    const submittedClipboard = clipboard;
    try {
      const result = await cloudCall<{ id: string }>(method, params);
      onJobCreated(result.id);
      setPrompt(null); selection.clear();
      if (method === "move") clearCloudClipboardIfUnchanged(submittedClipboard);
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }
  function openPrompt(method: Prompt["method"]) {
    const ids = selection.getOrderedPaths();
    setError("");
    setPrompt({ method, ids, destId: parent.id, name: method === "rename" ? cloudEntries.find((entry) => entry.id === ids[0])?.name ?? "" : "", password: "" });
  }
  const ready = !busy && !loading && !listError;
  function baseActions(): FileAction[] {
    const ids = selection.getOrderedPaths();
    return [
      { kind: "command", id: "rename", label: labels.rename, icon: Pencil, disabled: !ready || ids.length !== 1, run: () => openPrompt("rename") },
      { kind: "command", id: "powerRename", label: labels.powerRename, icon: ScanText, disabled: !ready || !ids.length || !onPowerRename, run: () => onPowerRename?.(parent.id, ids, profile.name + " / " + currentPath) },
      { kind: "command", id: "superRename", label: labels.superRename, icon: WandSparkles, disabled: !ready || !onSuperRename, run: () => onSuperRename?.(parent.id, profile.name + " / " + currentPath) },
      { kind: "command", id: "mkdir", label: labels.mkdir, icon: FolderPlus, disabled: !ready, run: () => openPrompt("mkdir") },
      { kind: "command", id: "offline", label: "离线下载", icon: CloudDownload, separatorBefore: true, disabled: !ready, run: () => setOfflineTarget({ id: parent.id, name: profile.name + (currentPath === "." ? "" : " / " + currentPath) }) },
      { kind: "command", id: "extract", label: "在线解压", icon: FolderArchive, disabled: !ready || ids.length !== 1 || !isCloudArchive(cloudEntries.find((entry) => entry.id === ids[0])), run: () => openPrompt("extract") },
      { kind: "command", id: "delete", label: labels.delete, icon: Trash2, separatorBefore: true, destructive: true, disabled: !ready || !ids.length, run: () => openPrompt("delete") },
    ];
  }
  function menuActions(context = false): FileAction[] {
    const ids = selection.getOrderedPaths();
    const entry = cloudEntries.find((entry) => entry.id === (context ? contextPath : ids.length === 1 ? ids[0] : null));
    const dest = context && entry?.isDirectory ? entry : parent;
    const clipboardActions = createClipboardActions({
      selectedCount: ready ? ids.length : 0, canPaste: ready && Boolean(clipboard && clipboard.accountId === profile.accountId),
      canOpenInNewWindow: ready && Boolean(entry?.isDirectory && onOpenNewWindow), labels,
      commands: {
        onCopy: () => setCloudClipboard({ accountId: profile.accountId, method: "copy", ids }),
        onCut: () => setCloudClipboard({ accountId: profile.accountId, method: "move", ids }),
        onPaste: () => { if (clipboard) void submit(clipboard.method, { ids: clipboard.ids, destId: dest.id }); },
        onOpenInNewWindow: () => { if (entry?.isDirectory) onOpenNewWindow?.([...trail, { id: entry.id, name: entry.name }]); },
      },
    });
    const ordinary = baseActions().map((action, index) => ({
      ...action, separatorBefore: index === 0 || action.separatorBefore,
      ...(action.id === "offline" ? { run: () => setOfflineTarget({ id: dest.id, name: dest.id === parent.id ? profile.name + (currentPath === "." ? "" : " / " + currentPath) : profile.name + " / " + (currentPath === "." ? "" : currentPath + "/") + dest.name }) } : {}),
    }));
    return [...clipboardActions, ...ordinary];
  }
  if (!loggedIn) return <div className="grid h-full content-start justify-items-center gap-4 overflow-auto p-6">
    <h2 className="font-semibold">登录115网盘</h2><p className="text-sm">使用115客户端扫描二维码。凭证仅保存在服务端。</p>
    {image ? <img src={image} width={220} height={220} alt="115登录二维码" /> : null}
    <div className="flex gap-2"><Button disabled={busy} onClick={() => void login("login.start")}>{image ? "重新获取二维码" : "获取二维码"}</Button></div>
    {loginMessage ? <p role="status" className="text-sm">{loginMessage}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <Button variant="ghost" disabled={busy} onClick={() => void login("logout")}>清除失效登录</Button>
  </div>;

  return <div className="file-window-layout relative" data-no-file-drop={prompt || offlineTarget ? "" : undefined}>
    <ActionToolbar actions={[...baseActions(), { kind: "command", id: "logout", label: "退出登录", icon: LogOut, separatorBefore: true, disabled: busy, run: () => void login("logout") }]} moreActions={menuActions()} selectedCount={summary.selectedCount} labels={labels} />
    <div className="relative min-h-0 [&>.file-pane]:h-full" aria-label="115文件列表">
      <FilePane paneKey={windowId} provider="cloud115" directoryId={parent.id} title="115网盘" roots={[]} selectedRootId="@115" currentPath={currentPath}
        entries={entries} selectionStore={selection} showRootSelector={false} pathRootLabel={profile.name} labels={labels}
        loading={loading} error={listError} isActive dropLayer={layer} dropWindowId={windowId} dropDisabled={Boolean(prompt || offlineTarget)}
        onRootChange={() => {}} onPathChange={(path) => void navigatePath(path)} onOpenDirectory={(entry) => navigate([...trail, { id: entry.relativePath, name: entry.name }])}
        onToggleSelection={selection.toggle} onSelectEntry={(id, modifiers) => selection.select(id, fileSelectionMode(modifiers))}
        onSelectAll={selection.selectAll} onSelectPaths={(paths) => selection.replace(paths)} onVisibleOrderChange={selection.setVisibleOrder}
        onRefresh={() => { void refresh(); void refreshProfile(); }}
        onActivate={() => {}} onContextTarget={(path) => { selection.selectContextTarget(path); setContextPath(path); }}
        actionsForSelection={() => menuActions(true)}
        dragData={(entry) => ({ kind: "cloud115-entry", get entries() { const ids = selection.isSelected(entry.relativePath) ? selection.getOrderedPaths() : [entry.relativePath]; return cloudEntries.filter((item) => ids.includes(item.id)); } })}
        navigation={{
          backTarget: history.index > 0 ? history.locations[history.index - 1].at(-1)!.name : null,
          forwardTarget: history.index < history.locations.length - 1 ? history.locations[history.index + 1].at(-1)!.name : null,
          upTarget: trail.length > 1 ? trail[trail.length - 2].name : null,
          onBack: () => moveHistory(history.index - 1), onForward: () => moveHistory(history.index + 1), onUp: () => navigate(trail.slice(0, -1)),
        }} />
      {error && !prompt ? <p role="alert" className="absolute bottom-8 left-2 right-2 rounded border bg-background p-2 text-sm text-destructive">{error}</p> : null}
    </div>
    {prompt ? <WindowDialogLayer labelledBy={promptId} onClose={() => { if (!busy) setPrompt(null); }}>
      <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void submit(prompt.method, { ids: prompt.ids, parentId: prompt.destId, destId: prompt.destId, name: prompt.name, password: prompt.password }); }}>
        <h2 id={promptId} className="font-semibold">{prompt.method === "mkdir" ? labels.mkdir : prompt.method === "rename" ? labels.rename : prompt.method === "extract" ? "在线解压" : labels.delete}</h2>
        {prompt.method === "delete" ? <p>确认删除选中的 {prompt.ids.length} 项？</p> : prompt.method === "extract" ? <><p>解压到以压缩包命名的新文件夹，不覆盖已有目录</p><input className="rounded border bg-background p-2" type="password" autoComplete="off" placeholder="解压密码（可选）" aria-label="解压密码" value={prompt.password} onChange={(event) => setPrompt({ ...prompt, password: event.target.value })} /></> : <input className="rounded border bg-background p-2" autoFocus required aria-label="名称" value={prompt.name} onChange={(event) => setPrompt({ ...prompt, name: event.target.value })} />}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setPrompt(null)}>{labels.cancel}</Button><Button type="submit" disabled={busy}>确认</Button></div>
      </form>
    </WindowDialogLayer> : null}
    {offlineTarget ? <Cloud115OfflineDialog target={offlineTarget} onClose={() => setOfflineTarget(null)} /> : null}
  </div>;
}
