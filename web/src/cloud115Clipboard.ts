import { useSyncExternalStore } from "react";

type Clipboard = { accountId: string; method: "copy" | "move"; ids: string[] } | null;
let value: Clipboard = null;
const listeners = new Set<() => void>();
export function setCloudClipboard(next: Clipboard) {
  value = next;
  for (const listener of listeners) listener();
}
export function useCloudClipboard() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => value, () => value);
}

export function clearCloudClipboardIfUnchanged(expected: Clipboard) {
  if (value === expected) setCloudClipboard(null);
}
