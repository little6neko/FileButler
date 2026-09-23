import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cloudCall } from "../cloud115";
import { useCloud115Login } from "../useCloud115Login";
import { Button } from "./ui/button";
import { WindowDialogLayer } from "./WindowDialogLayer";

export function Cloud115LoginDialog({ accountId, onSuccess, onClose }: { accountId?: string; onSuccess(accountId: string): void; onClose(): void }) {
  const [qr, setQR] = useState({ image: "", session: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const session = useRef("");
  const titleId = useId();
  const cancelSession = useCallback(() => {
    generation.current++;
    const old = session.current; session.current = "";
    if (old) void cloudCall("login.cancel", { loginSession: old }).catch(() => {});
  }, []);
  const start = useCallback(async () => {
    cancelSession();
    const current = generation.current;
    setBusy(true); setError(""); setQR({ image: "", session: "" });
    try {
      const result = await cloudCall<{ image: string; loginSession: string }>("login.start", { accountId });
      if (current !== generation.current) { void cloudCall("login.cancel", { loginSession: result.loginSession }).catch(() => {}); return; }
      session.current = result.loginSession;
      setQR({ image: result.image, session: result.loginSession });
    } catch (e) { if (current === generation.current) setError(String(e)); }
    finally { if (current === generation.current) setBusy(false); }
  }, [accountId, cancelSession]);
  useEffect(() => {
    // Start a private QR session for this dialog, and release it on close.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void start();
    return cancelSession;
  }, [start, cancelSession]);
  const succeeded = useCallback((id: string) => {
    if (!session.current) return;
    session.current = "";
    window.dispatchEvent(new CustomEvent("cloud115-account-changed", { detail: { accountId: id } }));
    window.dispatchEvent(new Event("cloud115-accounts-updated"));
    onSuccess(id);
  }, [onSuccess]);
  const message = useCloud115Login(qr.session, succeeded);
  function close() { cancelSession(); onClose(); }
  return <WindowDialogLayer labelledBy={titleId} onClose={close}><div className="grid justify-items-center gap-3">
    <h2 id={titleId}>{accountId ? "重新登录115账号" : "添加115账号"}</h2><p className="text-sm">使用115客户端扫码并确认登录</p>
    {qr.image ? <img src={qr.image} width={220} height={220} alt="115登录二维码" /> : null}
    {message ? <p role="status">{message}</p> : null}{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex gap-2"><Button variant="outline" onClick={close}>取消</Button><Button disabled={busy} onClick={() => void start()}>重新获取二维码</Button></div>
  </div></WindowDialogLayer>;
}
