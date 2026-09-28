import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { cloudCall } from "../cloud115";
import { Cloud115OfflineDialog } from "./Cloud115OfflineDialog";

vi.mock("../cloud115", () => ({ cloudCall: vi.fn() }));
const target = { id: "7", name: "账号 / 文件夹", accountId: "1" };
const quota = { used: 128, total: 2000, remaining: 1872 };
const quotaCalls = () => vi.mocked(cloudCall).mock.calls.filter(([method]) => method === "offline.quota");
beforeEach(() => {
  vi.mocked(cloudCall).mockReset();
  vi.mocked(cloudCall).mockImplementation(async (method) => method === "offline.quota" ? quota : { submitted: true });
});

it("shows current quota below links with the same text size and color as destination", async () => {
  render(<Cloud115OfflineDialog target={target} onClose={vi.fn()} />);
  const line = await screen.findByText("离线配额：剩余 1,872 / 2,000");
  const destination = screen.getByText(`保存到：${target.name}`);
  const status = screen.getByRole("status");
  expect(status).toContainElement(line);
  expect(status).toHaveClass("text-sm");
  expect(destination).toHaveClass("text-sm");
  expect(status.className).not.toMatch(/text-muted|text-gray|text-xs/);
  expect(screen.getByRole("textbox", { name: "下载链接" }).compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(cloudCall).toHaveBeenCalledWith("offline.quota", { accountId: "1" }, expect.any(AbortSignal));
  expect(quotaCalls()).toHaveLength(1);
  expect(line).not.toHaveTextContent("本月");
  expect(line).not.toHaveTextContent("已用");
});

it("refreshes once after a batch, including partial failures, and retains failed links", async () => {
  const onClose = vi.fn();
  const onSubmitted = vi.fn();
  vi.mocked(cloudCall).mockImplementation(async (method, params) => {
    if (method === "offline.quota") return quotaCalls().length === 1 ? quota : { ...quota, used: 129, remaining: 1871 };
    if (params?.url === "https://example.com/b") throw new Error("提交失败");
    return { submitted: true };
  });
  render(<Cloud115OfflineDialog target={target} onClose={onClose} onSubmitted={onSubmitted} />);
  await screen.findByText("离线配额：剩余 1,872 / 2,000");
  fireEvent.change(screen.getByRole("textbox", { name: "下载链接" }), { target: { value: "https://example.com/a\nhttps://example.com/b" } });
  fireEvent.click(screen.getByRole("button", { name: "提交" }));
  await screen.findByText("离线配额：剩余 1,871 / 2,000");
  expect(quotaCalls()).toHaveLength(2);
  expect(screen.getByRole("textbox", { name: "下载链接" })).toHaveValue("https://example.com/b");
  expect(vi.mocked(cloudCall).mock.calls.filter(([method]) => method === "offline.add")).toHaveLength(2);
  expect(onClose).not.toHaveBeenCalled();
  expect(onSubmitted).not.toHaveBeenCalled();
});

it.each(["pending", "failed"])("closes only after the whole batch is accepted even when quota is %s", async (state) => {
  let finishLast!: (value: unknown) => void;
  const onClose = vi.fn();
  const onSubmitted = vi.fn();
  vi.mocked(cloudCall).mockImplementation(async (method, params) => {
    if (method === "offline.quota") {
      if (state === "failed") throw new Error("quota unavailable");
      return new Promise(() => {});
    }
    if (params?.url === "https://example.com/b") return new Promise((resolve) => { finishLast = resolve; });
    return { submitted: true };
  });
  render(<Cloud115OfflineDialog target={target} onClose={onClose} onSubmitted={onSubmitted} />);
  if (state === "failed") await screen.findByText("配额获取失败");
  fireEvent.change(screen.getByRole("textbox", { name: "下载链接" }), { target: { value: "https://example.com/a\nhttps://example.com/b" } });
  fireEvent.click(screen.getByRole("button", { name: "提交" }));
  await waitFor(() => expect(finishLast).toBeTypeOf("function"));
  expect(onClose).not.toHaveBeenCalled();
  expect(onSubmitted).not.toHaveBeenCalled();
  await act(async () => finishLast({ submitted: true }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onSubmitted).toHaveBeenCalledTimes(1);
  expect(quotaCalls()).toHaveLength(1);
});

it("quota failure permits submission and has an independent retry button", async () => {
  vi.mocked(cloudCall).mockRejectedValueOnce(new Error("HTTP 405"));
  render(<Cloud115OfflineDialog target={target} onClose={vi.fn()} />);
  await screen.findByText("配额获取失败");
  expect(screen.getByRole("status")).toHaveAttribute("title", "Error: HTTP 405");
  fireEvent.change(screen.getByRole("textbox", { name: "下载链接" }), { target: { value: "magnet:?xt=test" } });
  expect(screen.getByRole("button", { name: "提交" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByText("离线配额：剩余 1,872 / 2,000");
  expect(quotaCalls()).toHaveLength(2);
  expect(vi.mocked(cloudCall).mock.calls.some(([method]) => method === "offline.add")).toBe(false);
});

it("does not wait for quota before submitting and ignores an obsolete response", async () => {
  let resolveOld!: (value: unknown) => void;
  vi.mocked(cloudCall).mockImplementation(async (method) => {
    if (method === "offline.quota") return quotaCalls().length === 1 ? new Promise((resolve) => { resolveOld = resolve; }) : quota;
    throw new Error("submission failed");
  });
  render(<Cloud115OfflineDialog target={target} onClose={vi.fn()} />);
  expect(screen.getByText("离线配额：加载中…")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "下载链接" }), { target: { value: "magnet:?xt=test" } });
  fireEvent.click(screen.getByRole("button", { name: "提交" }));
  await screen.findByText("离线配额：剩余 1,872 / 2,000");
  expect(quotaCalls()[0][2]?.aborted).toBe(true);
  await act(async () => resolveOld({ used: 0, total: 0, remaining: 0 }));
  expect(screen.getByText("离线配额：剩余 1,872 / 2,000")).toBeInTheDocument();
});

it("clears old account quota and aborts outstanding requests on close", async () => {
  let resolveOld!: (value: unknown) => void;
  vi.mocked(cloudCall).mockImplementation(async (_, params) => params?.accountId === "1"
    ? new Promise((resolve) => { resolveOld = resolve; })
    : quota);
  const view = render(<Cloud115OfflineDialog target={target} onClose={vi.fn()} />);
  view.rerender(<Cloud115OfflineDialog target={{ ...target, accountId: "2" }} onClose={vi.fn()} />);
  await screen.findByText("离线配额：剩余 1,872 / 2,000");
  expect(quotaCalls().map(([, params]) => params?.accountId)).toEqual(["1", "2"]);
  expect(quotaCalls()[0][2]?.aborted).toBe(true);
  await act(async () => resolveOld({ used: 0, total: 0, remaining: 0 }));
  expect(screen.getByText("离线配额：剩余 1,872 / 2,000")).toBeInTheDocument();
  view.unmount();
  expect(quotaCalls()[1][2]?.aborted).toBe(true);
});

it("does not poll quota or refetch when editing links", async () => {
  vi.useFakeTimers();
  try {
    render(<Cloud115OfflineDialog target={target} onClose={vi.fn()} />);
    await act(async () => {});
    fireEvent.change(screen.getByRole("textbox", { name: "下载链接" }), { target: { value: "magnet:?xt=test" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(quotaCalls()).toHaveLength(1);
  } finally { vi.useRealTimers(); }
});
