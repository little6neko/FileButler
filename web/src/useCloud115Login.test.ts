import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCloud115Login } from "./useCloud115Login";
import { cloudCall } from "./cloud115";

vi.mock("./cloud115", () => ({ cloudCall: vi.fn() }));
beforeEach(() => { vi.useFakeTimers(); vi.mocked(cloudCall).mockReset(); });
afterEach(() => vi.useRealTimers());

it("checks serially and completes only after phone confirmation", async () => {
  const success = vi.fn();
  let finish!: (value: unknown) => void;
  vi.mocked(cloudCall).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce({ status: 1, loggedIn: false }).mockResolvedValueOnce({ status: 2, loggedIn: true });
  const hook = renderHook(() => useCloud115Login("session", success));
  await act(() => vi.advanceTimersByTimeAsync(20_000));
  expect(cloudCall).toHaveBeenCalledTimes(1);
  await act(async () => finish({ status: 0, loggedIn: false }));
  await act(() => vi.advanceTimersByTimeAsync(2_000));
  expect(hook.result.current).toContain("已扫码");
  expect(success).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(2_000));
  expect(success).toHaveBeenCalledOnce();
  await act(() => vi.advanceTimersByTimeAsync(20_000));
  expect(cloudCall).toHaveBeenCalledTimes(3);
});

it("ignores old sessions and stops after unmount or expiry", async () => {
  const success = vi.fn();
  let finish!: (value: unknown) => void;
  vi.mocked(cloudCall).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce({ status: -1, loggedIn: false });
  const hook = renderHook(({ session }) => useCloud115Login(session, success), { initialProps: { session: "old" } });
  const signal = vi.mocked(cloudCall).mock.calls[0][2]!;
  hook.rerender({ session: "new" });
  await act(async () => finish({ status: 2, loggedIn: true }));
  expect(signal.aborted).toBe(true);
  expect(success).not.toHaveBeenCalled();
  expect(hook.result.current).toContain("过期");
  await act(() => vi.advanceTimersByTimeAsync(20_000));
  expect(cloudCall).toHaveBeenCalledTimes(2);
  hook.unmount();
  expect(vi.mocked(cloudCall).mock.calls[1][2]!.aborted).toBe(true);
});
