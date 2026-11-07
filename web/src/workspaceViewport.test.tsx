import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useWorkspaceViewport } from "./workspaceViewport";

afterEach(() => vi.unstubAllGlobals());

it("tracks width independently from touch input and leaves desktop preferences untouched", () => {
  const queries = new Map<string, { matches: boolean; listeners: Set<() => void> }>();
  vi.stubGlobal("matchMedia", (query: string) => {
    if (!queries.has(query)) queries.set(query, { matches: false, listeners: new Set() });
    const entry = queries.get(query)!;
    return {
      get matches() { return entry.matches; },
      addEventListener: (_: string, listener: () => void) => entry.listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => entry.listeners.delete(listener),
    };
  });
  const write = vi.spyOn(Storage.prototype, "setItem");
  const hook = renderHook(() => useWorkspaceViewport());
  const change = (query: string, value: boolean) => act(() => {
    const entry = queries.get(query)!;
    entry.matches = value;
    entry.listeners.forEach(listener => listener());
  });
  expect(hook.result.current).toEqual({ mobile: false, coarsePointer: false });
  change("(pointer: coarse)", true);
  expect(hook.result.current).toEqual({ mobile: false, coarsePointer: true });
  change("(max-width: 767px)", true);
  expect(hook.result.current).toEqual({ mobile: true, coarsePointer: true });
  change("(max-width: 767px)", false);
  expect(hook.result.current.mobile).toBe(false);
  expect(write).not.toHaveBeenCalled();
  hook.unmount();
  expect([...queries.values()].every(entry => entry.listeners.size === 0)).toBe(true);
  write.mockRestore();
});

it("can render before a browser media-query API is available", () => {
  vi.stubGlobal("matchMedia", undefined);
  const hook = renderHook(() => useWorkspaceViewport());
  expect(hook.result.current).toEqual({ mobile: false, coarsePointer: false });
});
