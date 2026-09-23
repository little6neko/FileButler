import { useEffect, useRef, useState } from "react";
import { cloudCall } from "../cloud115";
import { LocationMenu } from "./LocationMenu";

export function Cloud115AccountMenu({ accountId, name, disabled, onSelect, onAdd }: { accountId: string; name: string; disabled?: boolean; onSelect(id: string): void; onAdd(): void }) {
  const [accounts, setAccounts] = useState<{ accountId: string; name: string }[]>([]);
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  async function refresh() {
    const current = ++generation.current;
    setMessage("加载账号中…");
    try {
      const next = await cloudCall<{ accountId: string; name: string }[]>("accounts");
      if (current === generation.current) { setAccounts(next); setMessage(""); }
    } catch { if (current === generation.current) setMessage("账号列表读取失败，请重新打开菜单重试"); }
  }
  return <LocationMenu label="切换115账号" name={name} value={accountId} disabled={disabled}
    items={(accounts.length ? accounts : [{ accountId, name }]).map((a) => ({ id: a.accountId, name: a.name || a.accountId }))}
    message={message} onOpen={() => void refresh()} onSelect={onSelect} add={{ label: "添加新账号", run: onAdd }} />;
}
