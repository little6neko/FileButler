import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DndContext } from "@dnd-kit/core";
import { Cloud115Window } from "./Cloud115Window";
import { cloudCall } from "../cloud115";
import { JobEventsContext } from "../jobEventsContext";
import { JobEventsStore } from "../jobEvents";
import type { Job } from "../api/types";

vi.mock("../cloud115", () => ({ cloudCall: vi.fn() }));
const entry = { id: "1", parentId: "0", name: "sample.txt", isDirectory: false, size: 10 };
beforeEach(() => {
  vi.mocked(cloudCall).mockReset();
  vi.mocked(cloudCall).mockImplementation(async (method) => {
    if (method === "status") return { loggedIn: true };
    if (method === "browse") return { entries: [entry], offset: 0, total: 1 };
    return { id: "job" };
  });
});

function setup() {
  const store = new JobEventsStore();
  store.handleSnapshot({ runtimeId: "r", cursor: 0, reset: false, jobs: [] });
  const created = vi.fn();
  render(<JobEventsContext.Provider value={store}><DndContext><Cloud115Window windowId="cloud" layer={1} onJobCreated={created} /></DndContext></JobEventsContext.Provider>);
  return { store, created };
}

it("loads directory and creates a rename task without refreshing early", async () => {
  const { store, created } = setup();
  await screen.findByText("sample.txt");
  fireEvent.click(screen.getByRole("checkbox", { name: "选择 sample.txt" }));
  fireEvent.click(screen.getByRole("button", { name: "重命名" }));
  fireEvent.change(screen.getByRole("textbox", { name: "名称" }), { target: { value: "renamed.txt" } });
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  await waitFor(() => expect(created).toHaveBeenCalledWith("job"));
  expect(vi.mocked(cloudCall).mock.calls.filter(([method]) => method === "browse")).toHaveLength(1);
  const job: Job = { id: "job", type: "rename", sourceRootId: "@115", destRootId: "@115", status: "completed", actorId: 1, progressTotal: 1, progressDone: 1, failedCount: 0, cancelRequested: false, errorMessage: "", createdAtUnix: 1, updatedAtUnix: 2, eventVersion: 1 };
  act(() => store.handleChanged({ runtimeId: "r", cursor: 1, job }));
  await waitFor(() => expect(vi.mocked(cloudCall).mock.calls.filter(([method]) => method === "browse")).toHaveLength(2));
});

it("shows a login QR and checks login explicitly", async () => {
  vi.mocked(cloudCall).mockImplementation(async (method) => {
    if (method === "status") return { loggedIn: false };
    if (method === "login.start") return { image: "data:image/svg+xml;base64,PHN2Zy8+" };
    if (method === "login.check") return { loggedIn: true, status: 2 };
    return { entries: [entry], offset: 0, total: 1 };
  });
  setup();
  fireEvent.click(screen.getByRole("button", { name: "获取二维码" }));
  await screen.findByAltText("115登录二维码");
  fireEvent.click(screen.getByRole("button", { name: "我已扫码，检查登录" }));
  await screen.findByText("sample.txt");
});

it("submits unique links to the current directory without creating a completed download task", async () => {
  const { created } = setup();
  await screen.findByText("sample.txt");
  fireEvent.click(screen.getByRole("button", { name: "离线下载" }));
  fireEvent.change(screen.getByRole("textbox", { name: "下载链接" }), { target: { value: " magnet:?xt=test\nhttps://example.com/file\nmagnet:?xt=test " } });
  fireEvent.click(screen.getByRole("button", { name: /^提交$/ }));
  await waitFor(() => expect(screen.getAllByText("已提交到115")).toHaveLength(2));
  expect(cloudCall).toHaveBeenCalledWith("offline.add", { url: "magnet:?xt=test", destId: "0" });
  expect(cloudCall).toHaveBeenCalledWith("offline.add", { url: "https://example.com/file", destId: "0" });
  expect(created).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "下载链接" })).toHaveValue("");
});

it.each(["folder", "file", "blank"])("targets the correct directory from the %s context menu", async (kind) => {
  vi.mocked(cloudCall).mockImplementation(async (method) => {
    if (method === "status") return { loggedIn: true };
    if (method === "browse") return { entries: [entry, { ...entry, id: "123", name: "子文件夹", isDirectory: true }], offset: 0, total: 2 };
    return { submitted: true };
  });
  setup();
  await screen.findByText("子文件夹");
  fireEvent.contextMenu(kind === "blank" ? screen.getByLabelText("115文件列表") : screen.getByText(kind === "folder" ? "子文件夹" : "sample.txt"));
  fireEvent.click(await screen.findByRole("menuitem", { name: "离线下载" }));
  fireEvent.change(screen.getByRole("textbox", { name: "下载链接" }), { target: { value: "ed2k://|file|test|1|hash|/" } });
  fireEvent.click(screen.getByRole("button", { name: /^提交$/ }));
  await screen.findByText("已提交到115");
  expect(cloudCall).toHaveBeenCalledWith("offline.add", { url: "ed2k://|file|test|1|hash|/", destId: kind === "folder" ? "123" : "0" });
});

it("keeps only failed links for explicit retry", async () => {
  vi.mocked(cloudCall).mockImplementation(async (method, params) => {
    if (method === "status") return { loggedIn: true };
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
