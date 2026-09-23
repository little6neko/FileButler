import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DndContext } from "@dnd-kit/core";
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
  fireEvent.click(first); expect(open).toHaveBeenCalledWith("1");
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
  fireEvent.click(await screen.findByRole("button", { name: /账号1/ }));
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

it("returning from a directory window and selecting another account starts at that account's root", async () => {
  render(<DndContext><Cloud115Window windowId="cloud" layer={1} onJobCreated={vi.fn()} initialAccountId="1" initialTrail={[{ id: "0", name: "root" }, { id: "9", name: "private-folder" }]} /></DndContext>);
  await screen.findByText("file-1.txt");
  fireEvent.click(screen.getByRole("button", { name: "账号列表" }));
  fireEvent.click(await screen.findByRole("button", { name: /账号2/ }));
  await screen.findByText("file-2.txt");
  await waitFor(() => expect(screen.queryByText("private-folder")).toBeNull());
});
