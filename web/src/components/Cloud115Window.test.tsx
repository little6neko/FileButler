import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DndContext } from "@dnd-kit/core";
import { Cloud115Window } from "./Cloud115Window";
import { cloudCall } from "../cloud115";
import { JobEventsContext } from "../jobEventsContext";
import { JobEventsStore } from "../jobEvents";
import type { Job } from "../api/types";

vi.mock("../cloud115", async (original) => ({ ...await original<typeof import("../cloud115")>(), cloudCall: vi.fn(), cloudDirectory: async (id: string) => (await cloudCall<{ entries: typeof entry[] }>("browse", { parentId: id, offset: 0 })).entries }));
const entry = { id: "1", parentId: "0", name: "sample.txt", isDirectory: false, size: 10 };
beforeEach(() => {
  vi.mocked(cloudCall).mockReset();
  vi.mocked(cloudCall).mockImplementation(async (method) => {
    if (method === "status") return { loggedIn: true };
    if (method === "profile") return { accountId: "1", name: "测试115账号" };
    if (method === "browse") return { entries: [entry], offset: 0, total: 1 };
    return { id: "job" };
  });
});

function setup(onPreview = vi.fn(), initialAccountId: string | undefined = "1") {
  const store = new JobEventsStore();
  store.handleSnapshot({ runtimeId: "r", cursor: 0, reset: false, jobs: [] });
  const created = vi.fn();
  render(<JobEventsContext.Provider value={store}><DndContext><Cloud115Window windowId="cloud" initialAccountId={initialAccountId} layer={1} onJobCreated={created} onPreview={onPreview} /></DndContext></JobEventsContext.Provider>);
  return { store, created };
}

it("loads directory and creates a rename task without refreshing early", async () => {
  const { store, created } = setup();
  await screen.findByText("sample.txt");
  fireEvent.click(screen.getByRole("checkbox", { name: "选择 sample.txt" }));
  fireEvent.click(screen.getByRole("button", { name: "重命名" }));
  const dialog = screen.getByRole("dialog", { name: "重命名" });
  const input = within(dialog).getByRole("textbox", { name: "新名称" }) as HTMLInputElement;
  expect(input).toHaveFocus();
  expect(input.selectionEnd).toBe(6);
  fireEvent.change(input, { target: { value: "renamed.txt" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "重命名" }));
  await waitFor(() => expect(created).toHaveBeenCalledWith("job"));
  expect(cloudCall).toHaveBeenCalledWith("rename", expect.objectContaining({ ids: ["1"], name: "renamed.txt", accountId: "1" }));
  expect(vi.mocked(cloudCall).mock.calls.filter(([method]) => method === "browse")).toHaveLength(1);
  const job: Job = { accountId: "1", id: "job", type: "rename", sourceRootId: "@115", destRootId: "@115", status: "completed", actorId: 1, progressTotal: 1, progressDone: 1, failedCount: 0, cancelRequested: false, errorMessage: "", createdAtUnix: 1, updatedAtUnix: 2, eventVersion: 1 };
  act(() => store.handleChanged({ runtimeId: "r", cursor: 1, job }));
  await waitFor(() => expect(vi.mocked(cloudCall).mock.calls.filter(([method]) => method === "browse")).toHaveLength(2));
});

it("uses the shared mkdir form with empty validation, trimmed input and Enter submission", async () => {
  const { created } = setup();
  await screen.findByText("sample.txt");
  fireEvent.click(screen.getByRole("button", { name: "新建文件夹" }));
  const dialog = screen.getByRole("dialog", { name: "新建文件夹" });
  expect(dialog.closest("[data-window-local-dialog]")).not.toBeNull();
  const input = within(dialog).getByRole("textbox", { name: "文件夹名称" });
  expect(input).toHaveFocus();
  expect(within(dialog).getByRole("button", { name: "确认" })).toBeDisabled();
  fireEvent.change(input, { target: { value: "  albums  " } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(created).toHaveBeenCalledWith("job"));
  expect(cloudCall).toHaveBeenCalledWith("mkdir", expect.objectContaining({ parentId: "0", name: "albums", accountId: "1" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it.each(["新建文件夹", "重命名"])("keeps the shared %s form open on failure and allows retry", async (action) => {
  const original = vi.mocked(cloudCall).getMockImplementation()!;
  let failed = true;
  vi.mocked(cloudCall).mockImplementation(async (method, ...args) => {
    if ((method === "mkdir" || method === "rename") && failed) throw new Error("名称冲突");
    return original(method, ...args);
  });
  setup();
  await screen.findByText("sample.txt");
  fireEvent.click(screen.getByRole("checkbox", { name: "选择 sample.txt" }));
  fireEvent.click(screen.getByRole("button", { name: action }));
  const dialog = screen.getByRole("dialog", { name: action });
  const input = within(dialog).getByRole("textbox");
  fireEvent.change(input, { target: { value: "new-name" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("名称冲突");
  expect(input).toHaveValue("new-name");
  expect(input).not.toBeDisabled();
  failed = false;
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it.each(["新建文件夹", "重命名"])("blocks duplicate submissions and dismissal while %s is pending", async (action) => {
  const original = vi.mocked(cloudCall).getMockImplementation()!;
  let finish!: (value: { id: string }) => void;
  vi.mocked(cloudCall).mockImplementation((method, ...args) => {
    if (method === "mkdir" || method === "rename") return new Promise((resolve) => { finish = resolve; });
    return original(method, ...args);
  });
  setup();
  await screen.findByText("sample.txt");
  fireEvent.click(screen.getByRole("checkbox", { name: "选择 sample.txt" }));
  fireEvent.click(screen.getByRole("button", { name: action }));
  const dialog = screen.getByRole("dialog", { name: action });
  const input = within(dialog).getByRole("textbox");
  fireEvent.change(input, { target: { value: "new-name" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(dialog, { key: "Escape" });
  fireEvent.pointerDown(dialog.closest("[data-window-local-dialog]")!);
  expect(dialog).toBeInTheDocument();
  expect(vi.mocked(cloudCall).mock.calls.filter(([method]) => method === "mkdir" || method === "rename")).toHaveLength(1);
  await act(async () => finish({ id: "job" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it.each(["movie.avi", "MOVIE.AVI", "program.exe"])("does not open or request a preview for unsupported %s", async (name) => {
  vi.mocked(cloudCall).mockImplementation(async (method) => {
    if (method === "status") return { loggedIn: true };
    if (method === "profile") return { accountId: "1", name: "测试115账号" };
    return { entries: [{ ...entry, name, size: 20 * 1024 * 1024 }], offset: 0, total: 1 };
  });
  const preview = vi.fn();
  setup(preview);
  fireEvent.doubleClick(await screen.findByRole("button", { name }));
  expect(preview).not.toHaveBeenCalled();
  expect(vi.mocked(cloudCall).mock.calls.some(([method]) => method === "preview.url")).toBe(false);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("automatically adds an account after scan confirmation and stays on the account page", async () => {
  let loggedIn = false;
  vi.mocked(cloudCall).mockImplementation(async (method) => {
    if (method === "accounts") return loggedIn ? [{ accountId: "1", name: "测试115账号", avatar: "", usedBytes: null, totalBytes: null }] : [];
    if (method === "status") return { loggedIn };
    if (method === "login.start") return { image: "data:image/svg+xml;base64,PHN2Zy8+", loginSession: "login-session-test-1" };
    if (method === "login.check") { loggedIn = true; return { loggedIn: true, status: 2, accountId: "1" }; }
    if (method === "profile") return { accountId: "1", name: "测试115账号" };
    return { entries: [entry], offset: 0, total: 1 };
  });
  setup(vi.fn(), "");
  fireEvent.click(await screen.findByRole("button", { name: "添加新账号" }));
  await screen.findByText("测试115账号");
  expect(screen.queryByText("sample.txt")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "我已扫码，检查登录" })).not.toBeInTheDocument();
  expect(cloudCall).toHaveBeenCalledWith("login.check", { loginSession: "login-session-test-1" }, expect.any(AbortSignal));
});

it("submits unique links to the current directory without creating a completed download task", async () => {
  const { created } = setup();
  await screen.findByText("sample.txt");
  fireEvent.click(screen.getByRole("button", { name: "离线下载" }));
  fireEvent.change(screen.getByRole("textbox", { name: "下载链接" }), { target: { value: " magnet:?xt=test\nhttps://example.com/file\nmagnet:?xt=test " } });
  fireEvent.click(screen.getByRole("button", { name: /^提交$/ }));
  await waitFor(() => expect(screen.getAllByText("已提交到115")).toHaveLength(2));
  expect(cloudCall).toHaveBeenCalledWith("offline.add", { url: "magnet:?xt=test", destId: "0", accountId: "1" });
  expect(cloudCall).toHaveBeenCalledWith("offline.add", { url: "https://example.com/file", destId: "0", accountId: "1" });
  expect(created).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "下载链接" })).toHaveValue("");
});

it.each(["folder", "file", "blank"])("targets the correct directory from the %s context menu", async (kind) => {
  vi.mocked(cloudCall).mockImplementation(async (method) => {
    if (method === "status") return { loggedIn: true };
    if (method === "profile") return { accountId: "1", name: "测试115账号" };
    if (method === "browse") return { entries: [entry, { ...entry, id: "123", name: "子文件夹", isDirectory: true }], offset: 0, total: 2 };
    return { submitted: true };
  });
  setup();
  await screen.findByText("子文件夹");
  fireEvent.contextMenu(kind === "blank" ? screen.getByTestId("file-list-cloud") : screen.getByText(kind === "folder" ? "子文件夹" : "sample.txt"));
  fireEvent.click(await screen.findByRole("menuitem", { name: "离线下载" }));
  fireEvent.change(screen.getByRole("textbox", { name: "下载链接" }), { target: { value: "ed2k://|file|test|1|hash|/" } });
  fireEvent.click(screen.getByRole("button", { name: /^提交$/ }));
  await screen.findByText("已提交到115");
  expect(cloudCall).toHaveBeenCalledWith("offline.add", { url: "ed2k://|file|test|1|hash|/", destId: kind === "folder" ? "123" : "0", accountId: "1" });
});

it("keeps only failed links for explicit retry", async () => {
  vi.mocked(cloudCall).mockImplementation(async (method, params) => {
    if (method === "status") return { loggedIn: true };
    if (method === "profile") return { accountId: "1", name: "测试115账号" };
    if (method === "browse") return { entries: [entry], offset: 0, total: 1 };
    if (params?.url === "bad-link") throw new Error("链接无效");
    return { submitted: true };
  });
  setup();
  await screen.findByText("sample.txt");
  fireEvent.click(screen.getByRole("button", { name: "离线下载" }));
  fireEvent.change(screen.getByRole("textbox", { name: "下载链接" }), { target: { value: "https://example.com/file\nbad-link" } });
  fireEvent.click(screen.getByRole("button", { name: /^提交$/ }));
  await screen.findByText(/提交失败：.*链接无效/);
  expect(screen.getByRole("textbox", { name: "下载链接" })).toHaveValue("bad-link");
  expect(screen.getByText("已提交到115")).toBeInTheDocument();
});

it("reuses the file table and local dialogs, hides links and disables extraction for non-archives", async () => {
  setup();
  await screen.findByText("sample.txt");
  expect(screen.getAllByText("测试115账号").length).toBeGreaterThan(0);
  expect(screen.getByRole("columnheader", { name: /名称/ })).toBeInTheDocument();
  expect(screen.queryByText("选择已加载项")).not.toBeInTheDocument();
  expect(screen.queryByText(/与本地文件窗口拖放/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "选择 sample.txt" }));
  expect(screen.getByRole("button", { name: "在线解压" })).toBeDisabled();
  fireEvent.contextMenu(screen.getByText("sample.txt"));
  await screen.findByRole("menuitem", { name: "在线解压" });
  expect(screen.queryByRole("menuitem", { name: /连接/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("menuitem", { name: "离线下载" }));
  expect(screen.getByRole("dialog", { name: "离线下载" }).closest("[data-window-local-dialog]")).not.toBeNull();
  expect(screen.getByRole("textbox", { name: "下载链接" })).toHaveAttribute("placeholder", "支持磁力、ed2k、HTTP/HTTPS、FTP，每行一条");
  expect(screen.queryByText(/不代表下载完成/)).not.toBeInTheDocument();
});
