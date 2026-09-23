import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DndContext } from "@dnd-kit/core";
import userEvent from "@testing-library/user-event";
import { cloudCall } from "../cloud115";
import { Cloud115Accounts } from "./Cloud115Accounts";
import { Cloud115Window } from "./Cloud115Window";

vi.mock("../cloud115", async (original) => ({ ...await original<typeof import("../cloud115")>(), cloudCall: vi.fn(), cloudDirectory: async (_id: string, accountId: string) => [{ id: "1", parentId: "0", name: `file-${accountId}.txt`, isDirectory: false, size: 1 }] }));
const accounts = ["1", "2"].map((id) => ({ accountId: id, name: `账号${id}`, avatar: "", usedBytes: 1024, totalBytes: 2048 }));
beforeEach(() => {
  vi.mocked(cloudCall).mockReset().mockImplementation(async (method, params) => {
    if (method === "accounts") return accounts;
    if (method === "status") return { loggedIn: true };
    if (method === "profile") return accounts.find((a) => a.accountId === params?.accountId);
    return {};
  });
});

it("shows capacity cards, places add last and opens only the selected account", async () => {
  const open = vi.fn(); render(<Cloud115Accounts onOpen={open} />);
  const first = await screen.findByRole("button", { name: /账号1/ });
  expect(within(first).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  expect(within(first).getByText("1 KB / 2 KB")).toBeVisible();
  const add = screen.getByRole("button", { name: "添加新账号" });
  expect(add.parentElement?.lastElementChild).toBe(add);
  expect(within(add).queryByRole("progressbar")).toBeNull();
  await userEvent.click(first); expect(open).not.toHaveBeenCalled();
  await userEvent.dblClick(first); expect(open).toHaveBeenCalledExactlyOnceWith("1");
  for (const button of within(screen.getByRole("navigation")).getAllByRole("button")) expect(button).toBeDisabled();
});

it("shows disabled offline download and extraction between mkdir and more on the account home", async () => {
  render(<Cloud115Accounts onOpen={vi.fn()} />);
  await screen.findByRole("button", { name: /账号1/ });
  const toolbar = screen.getByRole("navigation");
  expect(within(toolbar).getAllByRole("button").map((button) => button.getAttribute("data-action-id"))).toEqual([
    "rename", "powerRename", "superRename", "mkdir", "offline", "extract", "more", "delete",
  ]);
  for (const name of ["离线下载", "在线解压"]) {
    const button = within(toolbar).getByRole("button", { name });
    expect(button).toBeDisabled();
    fireEvent.click(button);
  }
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(vi.mocked(cloudCall).mock.calls.some(([method]) => method === "offline.add" || method === "extract")).toBe(false);
});

it("does not block the account list on a slow account profile", async () => {
  vi.mocked(cloudCall).mockImplementation(async (method, params) => {
    if (method === "accounts") return accounts;
    if (params?.accountId === "1") return new Promise(() => {});
    if (method === "status") return { loggedIn: true };
    return { ...accounts[1], name: "已刷新账号2" };
  });
  render(<Cloud115Accounts onOpen={vi.fn()} />);
  await screen.findByText("已刷新账号2");
  expect(screen.getByRole("button", { name: /账号1/ })).toBeEnabled();
});

it("new windows start on the account list and another account's event leaves the current files alone", async () => {
  const props = { windowId: "cloud", layer: 1, onJobCreated: vi.fn() };
  const view = render(<DndContext><Cloud115Window {...props} /></DndContext>);
  expect(screen.queryByText("file-1.txt")).toBeNull();
  fireEvent.doubleClick(await screen.findByRole("button", { name: /账号1/ }));
  await screen.findByText("file-1.txt");
  act(() => window.dispatchEvent(new CustomEvent("cloud115-account-changed", { detail: { accountId: "2" } })));
  expect(screen.getByText("file-1.txt")).toBeVisible();
  act(() => window.dispatchEvent(new CustomEvent("cloud115-account-changed", { detail: { accountId: "1" } })));
  await screen.findByTestId("cloud-accounts");
  expect(screen.queryByText("file-1.txt")).toBeNull();
  view.unmount();
  render(<DndContext><Cloud115Window {...props} /></DndContext>);
  await screen.findByRole("button", { name: /账号1/ });
  expect(screen.queryByText("file-1.txt")).toBeNull();
});

it("the path account menu switches to another account's root without an account-list toolbar button", async () => {
  render(<DndContext><Cloud115Window windowId="cloud" layer={1} onJobCreated={vi.fn()} initialAccountId="1" initialTrail={[{ id: "0", name: "root" }, { id: "9", name: "private-folder" }]} /></DndContext>);
  await screen.findByText("file-1.txt");
  expect(screen.queryByRole("button", { name: "账号列表" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "切换115账号" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "账号2" }));
  await screen.findByText("file-2.txt");
  await waitFor(() => expect(screen.queryByText("private-folder")).toBeNull());
});

it.each(["success", "cancel", "failure"])("adding from the account menu: %s keeps the current directory until confirmed", async (outcome) => {
  const original = vi.mocked(cloudCall).getMockImplementation()!;
  let finish!: (value: unknown) => void;
  vi.mocked(cloudCall).mockImplementation(async (method, ...args) => {
    if (method === "login.start") return { image: "data:image/svg+xml;base64,PHN2Zy8+", loginSession: "new-account-session" };
    if (method === "login.check") return new Promise((resolve) => { finish = resolve; });
    return original(method, ...args);
  });
  render(<DndContext><Cloud115Window windowId="cloud" layer={1} onJobCreated={vi.fn()} initialAccountId="1" initialTrail={[{ id: "0", name: "root" }, { id: "9", name: "private-folder" }]} /></DndContext>);
  await screen.findByText("file-1.txt");
  await userEvent.click(screen.getByRole("button", { name: "切换115账号" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "添加新账号" }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(screen.getByText("file-1.txt")).toBeVisible();
  expect(screen.getByRole("button", { name: "private-folder" })).toBeVisible();
  if (outcome === "cancel") await userEvent.click(screen.getByRole("button", { name: "取消" }));
  await act(async () => finish(outcome === "failure" ? { loggedIn: false, status: -1 } : { loggedIn: true, status: 2, accountId: "2" }));
  if (outcome === "success") {
    await screen.findByText("file-2.txt");
    expect(screen.queryByText("private-folder")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  } else {
    expect(screen.getByText("file-1.txt")).toBeVisible();
    expect(screen.getByRole("button", { name: "private-folder" })).toBeVisible();
    expect(screen.queryByText("file-2.txt")).toBeNull();
    if (outcome === "failure") expect(await screen.findByText("二维码已过期，请重新获取")).toBeVisible();
  }
});
