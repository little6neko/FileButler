import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Cloud, Plus, RefreshCw } from "lucide-react";
import { cloudCall } from "../cloud115";
import { useCloud115Login } from "../useCloud115Login";
import { Button } from "./ui/button";
import { WindowDialogLayer } from "./WindowDialogLayer";

type Account = { accountId: string; name: string; avatar: string; usedBytes: number | null; totalBytes: number | null; invalid?: boolean; error?: string };
function capacity(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${Number(value.toFixed(2))} ${units[index]}`;
}

export function Cloud115Accounts({ onOpen }: { onOpen(accountId: string): void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [login, setLogin] = useState<{ accountId?: string; image: string; session: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const loginGeneration = useRef(0);
  const sessionRef = useRef("");
  const dialogId = useId();
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
    function dispose() { generation.current++; loginGeneration.current++; window.removeEventListener("cloud115-accounts-updated", changed); if (sessionRef.current) void cloudCall("login.cancel", { loginSession: sessionRef.current }).catch(() => {}); }
    return dispose;
  }, [refresh]);
  const succeeded = useCallback((accountId: string) => {
    sessionRef.current = "";
    setLogin(null); setError("");
    window.dispatchEvent(new CustomEvent("cloud115-account-changed", { detail: { accountId } }));
    window.dispatchEvent(new Event("cloud115-accounts-updated"));
  }, []);
  const message = useCloud115Login(login?.session ?? "", succeeded);
  async function start(accountId?: string) {
    const current = ++loginGeneration.current;
    const old = sessionRef.current; sessionRef.current = "";
    setBusy(true); setError(""); setLogin({ accountId, image: "", session: "" });
    if (old) void cloudCall("login.cancel", { loginSession: old }).catch(() => {});
    try {
      const result = await cloudCall<{ image: string; loginSession: string }>("login.start", { accountId });
      if (current !== loginGeneration.current) { void cloudCall("login.cancel", { loginSession: result.loginSession }).catch(() => {}); return; }
      sessionRef.current = result.loginSession;
      setLogin({ accountId, image: result.image, session: result.loginSession });
    } catch (e) { if (current === loginGeneration.current) setError(String(e)); }
    finally { if (current === loginGeneration.current) setBusy(false); }
  }
  function close() {
    loginGeneration.current++; setBusy(false); setLogin(null);
    const session = sessionRef.current; sessionRef.current = "";
    if (session) void cloudCall("login.cancel", { loginSession: session }).catch(() => {});
  }
  return <div className="relative h-full overflow-auto p-4" data-no-file-drop data-testid="cloud-accounts">
    <div className="mb-4 flex items-center justify-between border-b pb-3"><h2 className="font-semibold">115网盘账号</h2><Button size="sm" variant="outline" aria-label="刷新账号" disabled={loading} onClick={() => void refresh()}><RefreshCw size={16} /></Button></div>
    {loading ? <p role="status">加载账号中…</p> : null}
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(220px,100%),1fr))] gap-3">
      {accounts.map((account) => <button key={account.accountId} type="button" className="virtual-root-card cloud-account-card" onClick={() => account.invalid ? void start(account.accountId) : onOpen(account.accountId)}>
        {account.avatar ? <img className="h-11 w-11 shrink-0 rounded-lg object-cover" src={account.avatar} alt="" referrerPolicy="no-referrer" onError={() => { setAccounts((items) => items.map((a) => a.accountId === account.accountId ? { ...a, avatar: "" } : a)); }} /> : <Cloud className="h-11 w-11 shrink-0 text-blue-500" />}
        <span className="min-w-0 flex-1"><strong>{account.name || account.accountId}</strong>
          <span role="progressbar" aria-label={`${account.name || account.accountId}空间占用`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={account.usedBytes !== null && account.totalBytes && account.totalBytes > 0 ? Math.min(100, Math.max(0, account.usedBytes / account.totalBytes * 100)) : undefined} className="my-1 block h-2 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-blue-500" style={{ width: `${account.usedBytes !== null && account.totalBytes && account.totalBytes > 0 ? Math.min(100, Math.max(0, account.usedBytes / account.totalBytes * 100)) : 0}%` }} />
          </span>
          <small>{capacity(account.usedBytes)} / {capacity(account.totalBytes)}</small>
          {account.invalid || account.error ? <small className="text-destructive">{account.invalid ? "登录已失效，点击重新登录" : account.error}</small> : null}
        </span>
      </button>)}
      <button type="button" className="virtual-root-card cloud-account-card cloud-account-add" onClick={() => void start()}><Plus size={28} /><span>添加新账号</span></button>
    </div>
    {error && !login ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
    {login ? <WindowDialogLayer labelledBy={dialogId} onClose={close}><div className="grid justify-items-center gap-3">
      <h2 id={dialogId}>{login.accountId ? "重新登录115账号" : "添加115账号"}</h2><p className="text-sm">使用115客户端扫码并确认登录</p>
      {login.image ? <img src={login.image} width={220} height={220} alt="115登录二维码" /> : null}
      {message ? <p role="status">{message}</p> : null}{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2"><Button variant="outline" onClick={close}>取消</Button><Button disabled={busy} onClick={() => void start(login.accountId)}>重新获取二维码</Button></div>
    </div></WindowDialogLayer> : null}
  </div>;
}
