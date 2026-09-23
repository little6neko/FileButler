import { useCallback, useEffect, useRef, useState } from "react";
import { Cloud, CloudDownload, FolderArchive, Plus, RefreshCw } from "lucide-react";
import { cloudCall } from "../cloud115";
import { Button } from "./ui/button";
import { Cloud115LoginDialog } from "./Cloud115LoginDialog";
import { ActionToolbar } from "./ActionToolbar";
import { createClipboardActions, createWindowFileActions } from "./fileActions";
import { strings, type UIStrings } from "../i18n";

const noop = () => {};

type Account = { accountId: string; name: string; avatar: string; usedBytes: number | null; totalBytes: number | null; invalid?: boolean; error?: string };
function capacity(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${Number(value.toFixed(2))} ${units[index]}`;
}

export function Cloud115Accounts({ onOpen, labels = strings["zh-CN"] }: { onOpen(accountId: string): void; labels?: UIStrings }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [login, setLogin] = useState<{ accountId?: string } | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError("");
    try {
      const list = await cloudCall<Account[]>("accounts");
      if (current !== generation.current) return;
      setAccounts(list); setLoading(false);
      await Promise.all(list.map(async (account) => {
        try {
          const status = await cloudCall<{ loggedIn: boolean }>("status", { accountId: account.accountId });
          const profile = status.loggedIn ? await cloudCall<Account>("profile", { accountId: account.accountId }) : { ...account, invalid: true };
          if (current === generation.current) setAccounts((items) => items.map((a) => a.accountId === account.accountId ? profile : a));
        } catch {
          if (current === generation.current) setAccounts((items) => items.map((a) => a.accountId === account.accountId ? { ...a, error: "账号资料暂时无法读取" } : a));
        }
      }));
    } catch (e) { if (current === generation.current) { setError(String(e)); setLoading(false); } }
  }, []);
  useEffect(() => {
    // Load the external account registry when this page mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const changed = () => { void refresh(); };
    window.addEventListener("cloud115-accounts-updated", changed);
    function dispose() { generation.current++; window.removeEventListener("cloud115-accounts-updated", changed); }
    return dispose;
  }, [refresh]);
  const succeeded = useCallback(() => {
    setLogin(null); setError("");
  }, []);
  function open(account: Account) { if (account.invalid) setLogin({ accountId: account.accountId }); else onOpen(account.accountId); }
  const actions = createWindowFileActions({ selectedCount: 0, locationReady: false, labels, commands: { onOperation: noop, onLink: noop, onMkdir: noop, onRename: noop, onPowerRename: noop, onSuperRename: noop } });
  actions.splice(actions.findIndex((action) => action.id === "delete"), 0,
    { kind: "command", id: "offline", label: "离线下载", icon: CloudDownload, separatorBefore: true, disabled: true, run: noop },
    { kind: "command", id: "extract", label: "在线解压", icon: FolderArchive, disabled: true, run: noop },
  );
  const moreActions = createClipboardActions({ selectedCount: 0, canPaste: false, canOpenInNewWindow: false, labels, commands: { onCopy: noop, onCut: noop, onPaste: noop, onOpenInNewWindow: noop } });
  return <div className="file-window-layout relative" data-no-file-drop data-testid="cloud-accounts">
    <ActionToolbar actions={actions} moreActions={moreActions} labels={labels} selectedCount={0} disabled />
    <section className="virtual-root" aria-label="115网盘账号">
    <header className="justify-between"><div><strong>115网盘账号</strong><span>选择账号或添加新账号</span></div><Button size="sm" variant="outline" aria-label="刷新账号" disabled={loading} onClick={() => void refresh()}><RefreshCw size={16} /></Button></header>
    <div className="virtual-root-grid">
      {accounts.map((account) => <button key={account.accountId} type="button" className="virtual-root-card" title={account.invalid ? "登录已失效，双击重新登录" : account.error} onClick={(event) => { if (event.detail === 0) open(account); }} onDoubleClick={() => open(account)}>
        {account.avatar ? <img className="h-[43px] w-[43px] rounded-lg object-cover" src={account.avatar} alt="" referrerPolicy="no-referrer" onError={() => { setAccounts((items) => items.map((a) => a.accountId === account.accountId ? { ...a, avatar: "" } : a)); }} /> : <span className="virtual-root-icon"><Cloud /></span>}
        <span className="min-w-0 flex-1"><strong className={account.invalid || account.error ? "text-destructive" : undefined}>{account.name || account.accountId}{account.invalid ? "（登录失效）" : ""}</strong>
          <span role="progressbar" aria-label={`${account.name || account.accountId}空间占用`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={account.usedBytes !== null && account.totalBytes && account.totalBytes > 0 ? Math.min(100, Math.max(0, account.usedBytes / account.totalBytes * 100)) : undefined} className="my-0.5 block h-1 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-blue-500" style={{ width: `${account.usedBytes !== null && account.totalBytes && account.totalBytes > 0 ? Math.min(100, Math.max(0, account.usedBytes / account.totalBytes * 100)) : 0}%` }} />
          </span>
          <small>{capacity(account.usedBytes)} / {capacity(account.totalBytes)}</small>
        </span>
      </button>)}
      <button type="button" className="virtual-root-card cloud-account-add" onClick={() => setLogin({})}><Plus size={24} /><strong>添加新账号</strong></button>
    </div>
    <footer role={error ? "alert" : "status"}>{error || (loading ? "加载账号中…" : `${accounts.length} 个账号`)}</footer>
    </section>
    {login ? <Cloud115LoginDialog accountId={login.accountId} onSuccess={succeeded} onClose={() => setLogin(null)} /> : null}
  </div>;
}
