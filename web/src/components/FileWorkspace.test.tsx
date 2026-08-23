import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { api } from "../api/client";
import type { Entry } from "../api/types";
import { FileWorkspace } from "./FileWorkspace";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("../api/client", () => ({
  api: {
    roots: vi.fn(),
    browse: vi.fn(),
    mediaUrl: vi.fn(),
    opsDryRun: vi.fn(),
    opsCreateJob: vi.fn(),
    renamePreview: vi.fn(),
    renameCreateJob: vi.fn(),
    singleRenameCreateJob: vi.fn(),
    cancelJob: vi.fn(),
  },
}));

const sourceEntries: Entry[] = [
  { name: "folder", relativePath: "folder", type: "directory", size: 0, mode: "", modifiedUnix: 0, isSymlink: false },
  { name: "a.txt", relativePath: "a.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
];

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(api.roots).mockReset();
  vi.mocked(api.roots).mockResolvedValue([
    { id: "source", name: "Source" },
    { id: "target", name: "Target" },
  ]);
  vi.mocked(api.browse).mockReset();
  vi.mocked(api.browse).mockImplementation(async (rootId, path) => {
    if (rootId === "source" && path === ".") return sourceEntries;
    if (rootId === "target" && path === ".") return [];
    return [];
  });
  vi.mocked(api.opsDryRun).mockReset();
  vi.mocked(api.opsDryRun).mockResolvedValue({ hasConflict: false, items: [] });
  vi.mocked(api.opsCreateJob).mockReset();
  vi.mocked(api.cancelJob).mockReset();
});

it("starts with an empty desktop and creates a separate taskbar item for every window", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const icon = await screen.findByRole("button", { name: "Open File Manager" });
  expect(container.querySelectorAll(".desktop-window")).toHaveLength(0);

  await userEvent.click(icon);
  await userEvent.click(icon);

  expect(container.querySelectorAll(".desktop-window")).toHaveLength(2);
  const taskbarButtons = container.querySelectorAll<HTMLElement>(".taskbar-window-button");
  expect(taskbarButtons).toHaveLength(2);
  expect(taskbarButtons[0]).toHaveAttribute("data-variant", "ghost");
  expect(taskbarButtons[1]).toHaveAttribute("data-variant", "ghost");
  expect(taskbarButtons[0]).not.toHaveAttribute("aria-current");
  expect(taskbarButtons[1]).toHaveAttribute("aria-current", "page");
  expect(container.querySelectorAll(".virtual-root")).toHaveLength(2);
});

it.each([
  { keyName: "Enter", keys: "{Enter}" },
  { keyName: "Space", keys: " " },
])("opens exactly one desktop window with $keyName", async ({ keys }) => {
  const user = userEvent.setup();
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const icon = await screen.findByRole("button", { name: "Open File Manager" });
  icon.focus();

  await user.keyboard(keys);

  expect(container.querySelectorAll(".desktop-window")).toHaveLength(1);
  expect(container.querySelectorAll(".taskbar-window-button")).toHaveLength(1);
});

it("toggles the jobs sheet and closes it for taskbar window or mode changes", async () => {
  const user = userEvent.setup();
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const icon = await screen.findByRole("button", { name: "Open File Manager" });
  await user.click(icon);
  await user.click(icon);
  const jobsButton = screen.getByRole("button", { name: "Jobs" });
  const modeButton = screen.getByRole("button", { name: "Switch to compact mode" });

  expect(jobsButton).toHaveAttribute("aria-expanded", "false");
  await user.click(jobsButton);
  expect(await screen.findByRole("dialog", { name: "Jobs" })).toBeInTheDocument();
  expect(jobsButton).toHaveAttribute("aria-expanded", "true");

  await user.click(jobsButton);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Jobs" })).not.toBeInTheDocument());
  expect(jobsButton).toHaveAttribute("aria-expanded", "false");

  await user.click(jobsButton);
  expect(await screen.findByRole("dialog", { name: "Jobs" })).toBeInTheDocument();
  const taskbarButtons = container.querySelectorAll<HTMLElement>(".taskbar-window-button");
  await user.click(taskbarButtons[0]);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Jobs" })).not.toBeInTheDocument());
  expect(taskbarButtons[0]).toHaveAttribute("aria-current", "page");

  await user.click(jobsButton);
  expect(await screen.findByRole("dialog", { name: "Jobs" })).toBeInTheDocument();
  await user.click(modeButton);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Jobs" })).not.toBeInTheDocument());
  expect(await screen.findByTestId("workspace")).toBeVisible();
});

it("enters a mapped root and returns to the virtual root from the breadcrumb", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  await userEvent.click(await screen.findByRole("button", { name: "Open File Manager" }));
  const window = container.querySelector<HTMLElement>(".desktop-window");
  expect(window).not.toBeNull();

  await userEvent.dblClick(within(window!).getByRole("button", { name: /Source/ }));
  await waitFor(() => expect(api.browse).toHaveBeenCalledWith("source", "."));
  expect(await within(window!).findByText("a.txt")).toBeInTheDocument();
  expect(within(window!).queryByRole("combobox", { name: /root/i })).not.toBeInTheDocument();

  await userEvent.click(within(window!).getByRole("button", { name: "All locations" }));
  expect(within(window!).getByRole("region", { name: "All locations" })).toBeInTheDocument();
});

it("minimizes, restores, maximizes, and closes a window through window and taskbar controls", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  await userEvent.click(await screen.findByRole("button", { name: "Open File Manager" }));
  let window = container.querySelector<HTMLElement>(".desktop-window")!;
  expect(window.querySelectorAll(".desktop-window-resize-handle")).toHaveLength(8);

  await userEvent.click(within(window).getByRole("button", { name: "Maximize window" }));
  window = container.querySelector<HTMLElement>(".desktop-window")!;
  expect(window).toHaveAttribute("data-window-status", "maximized");
  await userEvent.click(within(window).getByRole("button", { name: "Restore window" }));
  expect(container.querySelector(".desktop-window")).toHaveAttribute("data-window-status", "normal");

  await userEvent.click(within(window).getByRole("button", { name: "Minimize window" }));
  expect(container.querySelector(".desktop-window")).toBeNull();
  const taskbarButton = container.querySelector<HTMLElement>(".taskbar-window-button")!;
  expect(taskbarButton).toHaveAttribute("data-window-status", "minimized");

  await userEvent.click(taskbarButton);
  expect(container.querySelector(".desktop-window")).not.toBeNull();
  await userEvent.click(taskbarButton);
  expect(container.querySelector(".desktop-window")).toBeNull();
  await userEvent.click(taskbarButton);
  window = container.querySelector<HTMLElement>(".desktop-window")!;
  await userEvent.click(within(window).getByRole("button", { name: "Close window" }));
  expect(container.querySelector(".desktop-window")).toBeNull();
  expect(container.querySelector(".taskbar-window-button")).toBeNull();
});

it("opens a selected directory in a new independent window from its context menu", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  await userEvent.click(await screen.findByRole("button", { name: "Open File Manager" }));
  const firstWindow = container.querySelector<HTMLElement>(".desktop-window")!;
  await userEvent.dblClick(within(firstWindow).getByRole("button", { name: /Source/ }));
  const folder = await within(firstWindow).findByText("folder");

  fireEvent.contextMenu(folder, { clientX: 100, clientY: 100 });
  const menu = await screen.findByRole("menu", { name: "File actions" });
  await userEvent.click(within(menu).getByRole("menuitem", { name: "Open in new window" }));

  await waitFor(() => expect(api.browse).toHaveBeenCalledWith("source", "folder"));
  const windows = container.querySelectorAll<HTMLElement>(".desktop-window");
  const taskbarButtons = container.querySelectorAll<HTMLElement>(".taskbar-window-button");
  const secondWindow = windows[1];
  expect(windows).toHaveLength(2);
  expect(taskbarButtons).toHaveLength(2);
  expect(firstWindow).toHaveAttribute("data-active", "false");
  expect(secondWindow).toHaveAttribute("data-active", "true");
  expect(Number(secondWindow.style.zIndex)).toBeGreaterThan(Number(firstWindow.style.zIndex));
  expect(taskbarButtons[0]).not.toHaveAttribute("aria-current");
  expect(taskbarButtons[1]).toHaveAttribute("aria-current", "page");
});

it("uses the active window for keyboard copy and paste and opens the fixed copy preview", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const icon = await screen.findByRole("button", { name: "Open File Manager" });
  await userEvent.click(icon);
  const firstWindow = container.querySelector<HTMLElement>(".desktop-window")!;
  await userEvent.dblClick(within(firstWindow).getByRole("button", { name: /Source/ }));
  await userEvent.click(await within(firstWindow).findByLabelText("Select a.txt"));
  fireEvent.keyDown(document, { key: "c", ctrlKey: true });
  expect(toast.success).toHaveBeenCalledWith("Copied 1 item");

  await userEvent.click(icon);
  const windows = container.querySelectorAll<HTMLElement>(".desktop-window");
  const secondWindow = windows[windows.length - 1];
  await userEvent.dblClick(within(secondWindow).getByRole("button", { name: /Target/ }));
  fireEvent.keyDown(document, { key: "v", ctrlKey: true });

  await waitFor(() => expect(api.opsDryRun).toHaveBeenCalledWith({
    type: "copy",
    sourceRoot: "source",
    sources: ["a.txt"],
    destRoot: "target",
    destPath: ".",
  }));
  expect(screen.getByRole("dialog", { name: "copy preview" })).toBeInTheDocument();
  expect(screen.queryByRole("radiogroup", { name: "Operation mode" })).not.toBeInTheDocument();
});

it("keeps right-click copy and cut commands and marks the current cut source", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  await userEvent.click(await screen.findByRole("button", { name: "Open File Manager" }));
  const window = container.querySelector<HTMLElement>(".desktop-window")!;
  await userEvent.dblClick(within(window).getByRole("button", { name: /Source/ }));
  const fileName = await within(window).findByText("a.txt");

  fireEvent.contextMenu(fileName, { clientX: 100, clientY: 100 });
  let menu = await screen.findByRole("menu", { name: "File actions" });
  await userEvent.click(within(menu).getByRole("menuitem", { name: "Cut" }));
  expect(fileName.closest("tr")).toHaveAttribute("data-clipboard-cut", "true");
  expect(toast.success).toHaveBeenCalledWith("Cut 1 item");

  fireEvent.contextMenu(fileName, { clientX: 100, clientY: 100 });
  menu = await screen.findByRole("menu", { name: "File actions" });
  await userEvent.click(within(menu).getByRole("menuitem", { name: "Copy" }));
  expect(fileName.closest("tr")).not.toHaveAttribute("data-clipboard-cut");
});

it("orders full-mode toolbar and context-menu actions", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  await userEvent.click(await screen.findByRole("button", { name: "Open File Manager" }));
  const window = container.querySelector<HTMLElement>(".desktop-window")!;
  await userEvent.dblClick(within(window).getByRole("button", { name: /Source/ }));

  const toolbar = within(window).getByRole("navigation", { name: "File actions" });
  expect(within(toolbar).getAllByRole("button").map((button) => button.dataset.actionId)).toEqual([
    "rename", "powerRename", "mkdir", "delete",
  ]);

  fireEvent.contextMenu(await within(window).findByText("a.txt"), { clientX: 100, clientY: 100 });
  const menu = await screen.findByRole("menu", { name: "File actions" });
  expect(within(menu).getAllByRole("menuitem").map((item) => item.dataset.actionId)).toEqual([
    "openInNewWindow", "clipboardCopy", "clipboardCut", "clipboardPaste",
    "rename", "powerRename", "mkdir", "delete",
  ]);
});

it("reports empty keyboard clipboard commands without invoking native page clipboard behavior", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  await userEvent.click(await screen.findByRole("button", { name: "Open File Manager" }));
  const window = container.querySelector<HTMLElement>(".desktop-window")!;
  await userEvent.dblClick(within(window).getByRole("button", { name: /Source/ }));

  const copyEvent = new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true });
  document.dispatchEvent(copyEvent);
  expect(copyEvent.defaultPrevented).toBe(true);
  expect(toast.error).toHaveBeenCalledWith("Select one or more items first");

  const pasteEvent = new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true, cancelable: true });
  document.dispatchEvent(pasteEvent);
  expect(pasteEvent.defaultPrevented).toBe(true);
  expect(toast.error).toHaveBeenCalledWith("The app clipboard is empty");
});

it("preserves extra desktop windows across compact mode round trips", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const icon = await screen.findByRole("button", { name: "Open File Manager" });
  await userEvent.click(icon);
  await userEvent.click(icon);
  await userEvent.click(icon);
  expect(container.querySelectorAll(".desktop-window")).toHaveLength(3);

  await userEvent.click(screen.getByRole("button", { name: "Switch to compact mode" }));
  expect(await screen.findByTestId("workspace")).toHaveAttribute("data-active-pane", "left");
  expect(container.querySelectorAll(".desktop-window")).toHaveLength(0);
  const compactTaskbarButton = container.querySelector<HTMLElement>(".taskbar-window-button");
  expect(compactTaskbarButton).toHaveAttribute("data-variant", "ghost");
  expect(compactTaskbarButton).toHaveAttribute("aria-current", "page");

  await userEvent.click(screen.getByRole("button", { name: "Switch to full mode" }));
  expect(container.querySelectorAll(".desktop-window")).toHaveLength(3);
  expect(container.querySelectorAll(".taskbar-window-button")).toHaveLength(3);
});
