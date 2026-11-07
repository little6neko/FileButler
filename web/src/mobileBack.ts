import { createContext, useContext, useEffect, useLayoutEffect, useRef } from "react";
import { useWorkspaceViewport } from "./workspaceViewport";

export const MobilePageActive = createContext(true);
const key = "filebutlerMobileLayer";
type Layer = { token: string; priority: number; close(): void };
const layers = new Map<string, Layer>();
const removed = new Set<string>();
let pending: Layer[] = [];
let current: string | undefined;
let traversing = false;
let installed = false;
let sequence = 0;

function flush() {
  if (traversing) return;
  const next = pending.splice(0).sort((a, b) => a.priority - b.priority);
  for (const layer of next) {
    if (!layers.has(layer.token)) continue;
    history.pushState({ ...history.state, [key]: layer.token }, "");
    current = layer.token;
  }
}

function register(close: () => void, priority: number) {
  if (!installed) {
    installed = true;
    current = history.state?.[key];
    window.addEventListener("popstate", event => {
      const previous = current;
      current = event.state?.[key];
      const programmatic = traversing;
      traversing = false;
      if (!programmatic && previous) layers.get(previous)?.close();
      if (current && removed.has(current)) {
        traversing = true;
        history.back();
      } else queueMicrotask(flush);
    });
  }
  const token = `fb-${Date.now()}-${++sequence}`;
  const layer = { token, close, priority };
  layers.set(token, layer);
  pending.push(layer);
  queueMicrotask(flush);
  return () => {
    layers.delete(token);
    removed.add(token);
    pending = pending.filter(item => item.token !== token);
    if (current === token && !traversing) {
      traversing = true;
      history.back();
    }
  };
}

/** One temporary browser-history entry per visible layer; never replaces the app's entry. */
export function useMobileBack(enabled: boolean, close: () => void, priority = 20, identity?: string) {
  const { mobile } = useWorkspaceViewport();
  const active = useContext(MobilePageActive);
  const callback = useRef(close);
  useLayoutEffect(() => { callback.current = close; });
  useEffect(() => {
    if (!mobile || !active || !enabled) return;
    return register(() => callback.current(), priority);
  }, [mobile, active, enabled, priority, identity]);
}

export function dismissActiveDialog() {
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
}
