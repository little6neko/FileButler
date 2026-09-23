import { useEffect, useState } from "react";
import { cloudCall } from "./cloud115";

export function useCloud115Login(session: string, onSuccess: () => void) {
  const [state, setState] = useState({ session: "", message: "" });
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const deadline = Date.now() + 5 * 60_000;
    async function check() {
      if (controller.signal.aborted) return;
      if (Date.now() > deadline) { setState({ session, message: "登录等待已结束，请重新获取二维码" }); return; }
      try {
        const result = await cloudCall<{ status: number; loggedIn: boolean }>("login.check", { loginSession: session }, controller.signal);
        if (controller.signal.aborted) return;
        if (result.loggedIn) { onSuccess(); return; }
        if (result.status < 0) {
          setState({ session, message: result.status === -2 ? "登录已取消，请重新获取二维码" : result.status === -3 ? "二维码已被替换或失效，请重新获取" : "二维码已过期，请重新获取" });
          return;
        }
        failures = 0;
        setState({ session, message: result.status === 1 ? "已扫码，等待在115客户端确认" : "等待扫码" });
      } catch {
        if (controller.signal.aborted) return;
        failures++;
        setState({ session, message: failures >= 5 ? "登录状态暂时无法确认，请重新获取二维码" : "网络暂时不可用，正在重试登录状态…" });
        if (failures >= 5) return;
      }
      timer = setTimeout(() => void check(), Math.min(10_000, 2_000 * 2 ** failures));
    }
    void check();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [session, onSuccess]);
  return state.session === session ? state.message : session ? "等待扫码" : "";
}
