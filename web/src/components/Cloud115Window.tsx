import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CloudDownload, FolderArchive, FolderPlus, LogOut, Pencil, ScanText, Trash2, WandSparkles, Info } from "lucide-react";
import type { DetailsTarget } from "../fileDetails";
import { cloudCall, cloudDirectory, isCloudArchive, type CloudEntry, type CloudLocation, type CloudRequest } from "../cloud115";
import { createAppClipboard, setAppClipboard, useAppClipboard, type ClipboardTarget } from "../appClipboard";
import type { FileDropFeedback } from "../fileDrag";
import type { OpsRequest } from "../api/types";
import { toast } from "sonner";
import { Cloud115Accounts } from "./Cloud115Accounts";
import { Cloud115AccountMenu } from "./Cloud115AccountMenu";
import { Cloud115LoginDialog } from "./Cloud115LoginDialog";
import { createFileSelectionStore } from "../fileSelectionStore";
import { fileSelectionMode } from "../fileSelection";
import { fileOpenKind } from "../fileOpenKind";
import type { Entry } from "../api/types";
import { strings, type UIStrings } from "../i18n";
import { useOptionalJobEventsStore } from "../jobEventsContext";
import { Button } from "./ui/button";
import { DialogFooter } from "./ui/dialog";
import { Input } from "./ui/input";
import { Cloud115OfflineDialog } from "./Cloud115OfflineDialog";
import { WindowDialogLayer } from "./WindowDialogLayer";
import { MkdirContent } from "./MkdirDialog";
import { SingleRenameContent } from "./SingleRenameDialog";
import { FilePane } from "./FilePane";
import { ActionToolbar } from "./ActionToolbar";
import { createClipboardActions, type FileAction } from "./fileActions";

type Prompt =
  | { method: "mkdir"; destId: string }
  | { method: "rename"; ids: string[]; name: string; entryType: Entry["type"] }
  | { method: "extract"; password: string; ids: string[]; destId: string };
export type CloudFileController = { copy(operation: "copy" | "move"): boolean; paste(): void; selectAll(): void; back(): void; blocked: boolean };
const rootLocation: CloudLocation = [{ id: "0", name: "115网盘" }];

type Cloud115WindowProps = {
  onTitle?(windowId: string, title: string): void;
  onDetails?(target: DetailsTarget): void;
  onOperation?(request: OpsRequest): void;
  onPaste?(target: ClipboardTarget): void;
  onRegister?(id: string, controller: CloudFileController | null): void;
  operationOpen?: boolean;
  dropFeedback?: FileDropFeedback | null;
  windowId: string; layer: number; onJobCreated(id: string): void;
  initialAccountId?: string;
  initialTrail?: CloudLocation; onOpenNewWindow?(trail: CloudLocation, accountId: string): void; labels?: UIStrings;
  onPowerRename?(parentId: string, ids: string[], sourceTitle: string, accountId: string): void;
  onSuperRename?(parentId: string, sourceTitle: string, accountId: string): void;
  onPreview?(entry: CloudEntry, entries: CloudEntry[], accountId: string): void;
};

export function Cloud115Window(props: Cloud115WindowProps) {
  const [location, setLocation] = useState({ accountId: props.initialAccountId ?? "", trail: props.initialTrail });
  const [addingAccount, setAddingAccount] = useState(false);
  const accountId = location.accountId;
  const { onTitle, windowId } = props;
  useEffect(() => { if (!accountId) onTitle?.(windowId, "115网盘"); }, [accountId, onTitle, windowId]);
  const open = useCallback((next: string) => setLocation({ accountId: next, trail: undefined }), []);
  const added = useCallback((next: string) => { setAddingAccount(false); open(next); }, [open]);
  useEffect(() => {
    const changed = (event: Event) => { if ((event as CustomEvent<{ accountId: string }>).detail?.accountId === accountId) setLocation({ accountId: "", trail: undefined }); };
    window.addEventListener("cloud115-account-changed", changed);
    return () => window.removeEventListener("cloud115-account-changed", changed);
  }, [accountId]);
  return <div className="relative h-full min-h-0">
    {accountId ? <Cloud115Files key={accountId} {...props} operationOpen={props.operationOpen || addingAccount} initialTrail={location.trail} accountId={accountId} onSwitch={open} onAdd={() => setAddingAccount(true)} /> : <Cloud115Accounts onOpen={open} labels={props.labels} />}
    {addingAccount ? <Cloud115LoginDialog onSuccess={added} onClose={() => setAddingAccount(false)} /> : null}
  </div>;
}

function Cloud115Files({ accountId, onSwitch, onAdd, onTitle, windowId, layer, onJobCreated, initialTrail = rootLocation, onOpenNewWindow, onPowerRename, onSuperRename, onPreview, onOperation, onPaste, onRegister, onDetails, operationOpen = false, dropFeedback = null, labels = strings["zh-CN"] }: Cloud115WindowProps & { accountId: string; onSwitch(id: string): void; onAdd(): void }) {
  const events = useOptionalJobEventsStore();
  const [loggedIn, setLoggedIn] = useState(false);
  const [profile, setProfile] = useState({ accountId, name: accountId });
  useEffect(() => { onTitle?.(windowId, profile.name); }, [onTitle, windowId, profile.name]);
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
  const clipboard = useAppClipboard();
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
      const next = await cloudDirectory(parent.id, accountId, () => requestGeneration === generation.current);
      if (requestGeneration !== generation.current) return;
      setCloudEntries(next);
      setListError("");
    } catch (error) { if (requestGeneration === generation.current) setListError(String(error)); }
    finally { if (requestGeneration === generation.current) setLoading(false); }
  }, [parent.id, accountId]);

  const refreshProfile = useCallback(async () => {
    const current = ++profileGeneration.current;
    try {
      const next = await cloudCall<{ accountId: string; name: string }>("profile", { accountId });
      if (current === profileGeneration.current) setProfile(next);
    } catch (error) { if (current === profileGeneration.current) setError(String(error)); }
  }, [accountId]);

  useEffect(() => {
    let disposed = false;
    void cloudCall<{ loggedIn: boolean }>("status", { accountId }).then((status) => {
      if (disposed) return;
      setLoggedIn(status.loggedIn);
      if (status.loggedIn) void refreshProfile();
      else setError("登录已失效，请从账号菜单添加账号以重新登录");
    }).catch((e) => { if (!disposed) setError(String(e)); });
    function dispose() { disposed = true; generation.current++; pathGeneration.current++; profileGeneration.current++; }
    return dispose;
  }, [accountId, refreshProfile]);
  useEffect(() => {
    // Synchronize the remote directory after login and navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (loggedIn) void refresh();
  }, [loggedIn, refresh]);
  useEffect(() => events?.subscribeTerminal((jobs) => {
    if (loggedIn && jobs.some((job) => job.accountId === accountId)) void refresh();
  }), [events, loggedIn, refresh, accountId]);

  function navigate(next: CloudLocation) {
    generation.current++; pathGeneration.current++;
    selection.clear(); setCloudEntries([]); setContextPath(null); setListError(""); setError("");
    setHistory((current) => ({ locations: [...current.locations.slice(0, current.index + 1), next], index: current.index + 1 }));
  }
  async function navigatePath(path: string) {
    const requested = ++pathGeneration.current;
    try {
      const next = await cloudCall<{ trail: CloudLocation }>("resolve", { path, accountId });
      if (requested === pathGeneration.current) navigate(next.trail);
    } catch (error) { if (requested === pathGeneration.current) setError(String(error)); }
  }
  function moveHistory(index: number) {
    generation.current++; pathGeneration.current++; selection.clear(); setCloudEntries([]); setListError("");
    setHistory((h) => ({ ...h, index }));
  }
  async function logout() {
    setBusy(true); setError("");
    try {
      await cloudCall("logout", { accountId });
      window.dispatchEvent(new CustomEvent("cloud115-account-changed", { detail: { accountId } }));
      window.dispatchEvent(new Event("cloud115-accounts-updated"));
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }
  async function submit(method: string, params: CloudRequest) {
    setBusy(true); setError("");
    try {
      const result = await cloudCall<{ id: string }>(method, { ...params, accountId });
      onJobCreated(result.id);
      setPrompt(null); selection.clear();
    } finally { setBusy(false); }
  }
  function openPrompt(method: Prompt["method"]) {
    const ids = selection.getOrderedPaths();
    setError("");
    if (method === "mkdir") setPrompt({ method, destId: parent.id });
    else if (method === "extract") setPrompt({ method, ids, destId: parent.id, password: "" });
    else {
      const entry = cloudEntries.find((entry) => entry.id === ids[0]);
      if (entry) setPrompt({ method, ids, name: entry.name, entryType: entry.isDirectory ? "directory" : "file" });
    }
  }
  const ready = !busy && !loading && !listError && Boolean(profile.accountId) && !operationOpen;
  function copySelection(operation: "copy" | "move") {
    if (!ready || prompt || offlineTarget) return false;
    const selected = selection.getOrderedPaths().flatMap((id) => entries.filter((entry) => entry.relativePath === id));
    const next = createAppClipboard(operation, "@115", parent.id, selected);
    if (!next) return false;
    setAppClipboard({ ...next, accountId: profile.accountId });
    toast.success(operation === "copy" ? labels.clipboardCopied(selected.length) : labels.clipboardCut(selected.length));
    return true;
  }
  useEffect(() => {
    onRegister?.(windowId, { copy: copySelection, paste: () => onPaste?.({ rootId: "@115", path: parent.id, accountId: profile.accountId }), selectAll: () => selection.selectAll(true), back: () => { if (history.index > 0) moveHistory(history.index - 1); }, blocked: !loggedIn || !ready || Boolean(prompt || offlineTarget) });
    return () => onRegister?.(windowId, null);
  });
  function baseActions(): FileAction[] {
    const ids = selection.getOrderedPaths();
    return [
      { kind: "command", id: "rename", label: labels.rename, icon: Pencil, disabled: !ready || ids.length !== 1, run: () => openPrompt("rename") },
      { kind: "command", id: "powerRename", label: labels.powerRename, icon: ScanText, disabled: !ready || !ids.length || !onPowerRename, run: () => onPowerRename?.(parent.id, ids, profile.name + " / " + currentPath, accountId) },
      { kind: "command", id: "superRename", label: labels.superRename, icon: WandSparkles, disabled: !ready || !onSuperRename, run: () => onSuperRename?.(parent.id, profile.name + " / " + currentPath, accountId) },
      { kind: "command", id: "mkdir", label: labels.mkdir, icon: FolderPlus, disabled: !ready, run: () => openPrompt("mkdir") },
      { kind: "command", id: "offline", label: "离线下载", icon: CloudDownload, separatorBefore: true, disabled: !ready, run: () => setOfflineTarget({ id: parent.id, name: profile.name + (currentPath === "." ? "" : " / " + currentPath) }) },
      { kind: "command", id: "extract", label: "在线解压", icon: FolderArchive, disabled: !ready || ids.length !== 1 || !isCloudArchive(cloudEntries.find((entry) => entry.id === ids[0])), run: () => openPrompt("extract") },
      { kind: "command", id: "delete", label: labels.delete, icon: Trash2, separatorBefore: true, destructive: true, disabled: !ready || !ids.length, run: () => onOperation?.({ type: "delete", sourceRoot: "@115", sources: ids, accountId, sourceAccountId: accountId }) },
    ];
  }
  function menuActions(context = false): FileAction[] {
    const ids = selection.getOrderedPaths();
    const entry = cloudEntries.find((entry) => entry.id === (context ? contextPath : ids.length === 1 ? ids[0] : null));
    const dest = context && entry?.isDirectory ? entry : parent;
    const clipboardActions = createClipboardActions({
      selectedCount: ready ? ids.length : 0, canPaste: ready && Boolean(clipboard && (!clipboard.accountId || clipboard.accountId === profile.accountId)),
      canOpenInNewWindow: ready && Boolean(entry?.isDirectory && onOpenNewWindow), labels,
      commands: {
        onCopy: () => { copySelection("copy"); },
        onCut: () => { copySelection("move"); },
        onPaste: () => onPaste?.({ rootId: "@115", path: dest.id, accountId: profile.accountId }),
        onOpenInNewWindow: () => { if (entry?.isDirectory) onOpenNewWindow?.([...trail, { id: entry.id, name: entry.name }], accountId); },
      },
    });
    const ordinary = baseActions().map((action, index) => ({
      ...action, separatorBefore: index === 0 || action.separatorBefore,
      ...(action.id === "offline" ? { run: () => setOfflineTarget({ id: dest.id, name: dest.id === parent.id ? profile.name + (currentPath === "." ? "" : " / " + currentPath) : profile.name + " / " + (currentPath === "." ? "" : currentPath + "/") + dest.name }) } : {}),
    }));
    return [...clipboardActions, ...ordinary, { kind: "command", id: "details", label: labels.details.title, icon: Info, separatorBefore: true, disabled: !ready || !onDetails, run: () => {
      const paths = (!context || contextPath) && ids.length ? ids : [parent.id];
      const names = paths.map((id) => cloudEntries.find((item) => item.id === id)?.name ?? (parent.id === "0" ? profile.name : parent.name));
      onDetails?.({ rootId: "@115", accountId: profile.accountId, paths, names });
    } }];
  }
  const accountMenu = <Cloud115AccountMenu accountId={accountId} name={profile.name} disabled={operationOpen || Boolean(prompt || offlineTarget) || busy} onSelect={onSwitch} onAdd={onAdd} />;
  if (!loggedIn) return <div className="grid gap-3 p-4">{accountMenu}<p role={error ? "alert" : "status"}>{error || "正在连接115账号…"}</p></div>;

  return <div className="file-window-layout relative" data-no-file-drop={prompt || offlineTarget || operationOpen ? "" : undefined}>
    <ActionToolbar actions={[...baseActions(), { kind: "command", id: "logout", label: "退出登录", icon: LogOut, separatorBefore: true, disabled: busy || operationOpen, run: () => void logout() }]} moreActions={menuActions()} selectedCount={summary.selectedCount} labels={labels} />
    <div className="relative min-h-0 [&>.file-pane]:h-full" aria-label="115文件列表">
      <FilePane paneKey={windowId} provider="cloud115" directoryId={parent.id} title="115网盘" roots={[]} selectedRootId="@115" currentPath={currentPath}
        accountId={profile.accountId} ancestorIds={trail.map((part) => part.id)} dropFeedback={dropFeedback}
        cutPaths={clipboard?.operation === "move" && clipboard.sourceRootId === "@115" && clipboard.accountId === profile.accountId && clipboard.sourceParentPath === parent.id ? new Set(clipboard.paths) : undefined}
        entries={entries} selectionStore={selection} showRootSelector={false} pathRootLabel={profile.name} pathRootControl={accountMenu} labels={labels}
        loading={loading} error={listError} isActive dropLayer={layer} dropWindowId={windowId} dropDisabled={!ready || Boolean(prompt || offlineTarget)}
        onRootChange={() => {}} onPathChange={(path) => void navigatePath(path)} onOpenDirectory={(entry) => navigate([...trail, { id: entry.relativePath, name: entry.name }])}
        onOpenFile={(entry) => {
          if (!ready || prompt || offlineTarget) return;
          const source = cloudEntries.find((item) => item.id === entry.relativePath);
          if (!source) return;
          if (isCloudArchive(source)) { setError(""); setPrompt({ method: "extract", ids: [source.id], destId: parent.id, password: "" }); }
          else {
            const kind = fileOpenKind(entry).kind;
            if (kind !== "media" && kind !== "text") return;
            if (profile.accountId) onPreview?.(source, cloudEntries, profile.accountId);
            else setError("正在读取账号信息，请稍后重试");
          }
        }}
        onToggleSelection={selection.toggle} onSelectEntry={(id, modifiers) => selection.select(id, fileSelectionMode(modifiers))}
        onSelectAll={selection.selectAll} onSelectPaths={(paths) => selection.replace(paths)} onVisibleOrderChange={selection.setVisibleOrder}
        onRefresh={() => { void refresh(); void refreshProfile(); }}
        onActivate={() => {}} onContextTarget={(path) => { selection.selectContextTarget(path); setContextPath(path); }}
        actionsForSelection={() => menuActions(true)}
        dragData={(entry) => ({ kind: "file-entry", pane: windowId, rootId: "@115", parentPath: parent.id, accountId: profile.accountId, entry, get entries() { const ids = selection.isSelected(entry.relativePath) ? selection.getOrderedPaths() : [entry.relativePath]; return ids.flatMap((id) => entries.filter((item) => item.relativePath === id)); } })}
        navigation={{
          backTarget: history.index > 0 ? history.locations[history.index - 1].at(-1)!.name : null,
          forwardTarget: history.index < history.locations.length - 1 ? history.locations[history.index + 1].at(-1)!.name : null,
          upTarget: trail.length > 1 ? trail[trail.length - 2].name : null,
          onBack: () => moveHistory(history.index - 1), onForward: () => moveHistory(history.index + 1), onUp: () => navigate(trail.slice(0, -1)),
        }} />
      {error && !prompt ? <p role="alert" className="absolute bottom-8 left-2 right-2 rounded border bg-background p-2 text-sm text-destructive">{error}</p> : null}
    </div>
    {prompt ? <WindowDialogLayer labelledBy={promptId} onClose={() => { if (!busy) setPrompt(null); }}>
      {prompt.method === "mkdir" ? <MkdirContent
        titleId={promptId} labels={labels} onClose={() => setPrompt(null)}
        onSubmit={(name) => submit("mkdir", { parentId: prompt.destId, name })}
      /> : prompt.method === "rename" ? <SingleRenameContent
        titleId={promptId} labels={labels} initialName={prompt.name} entryType={prompt.entryType}
        onClose={() => setPrompt(null)} onSubmit={(name) => submit("rename", { ids: prompt.ids, name })}
      /> : <form className="contents" onSubmit={(event) => {
        event.preventDefault();
        void submit("extract", { ids: prompt.ids, destId: prompt.destId, password: prompt.password }).catch((error) => setError(String(error)));
      }}>
        <h2 id={promptId} className="font-heading text-base leading-none font-medium">在线解压</h2>
        <div className="grid min-w-0 gap-2">
          <p>解压到以压缩包命名的新文件夹，不覆盖已有目录</p>
          <Input type="password" autoFocus disabled={busy} autoComplete="off" placeholder="解压密码（可选）" aria-label="解压密码" value={prompt.password} onChange={(event) => setPrompt({ ...prompt, password: event.target.value })} />
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setPrompt(null)}>{labels.cancel}</Button><Button type="submit" disabled={busy}>{labels.confirm}</Button></DialogFooter>
      </form>}
    </WindowDialogLayer> : null}
    {offlineTarget ? <Cloud115OfflineDialog target={{ ...offlineTarget, accountId }} onClose={() => setOfflineTarget(null)} /> : null}
  </div>;
}
