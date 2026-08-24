import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    textRead: vi.fn(),
    textSave: vi.fn(),
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

function mediaEntry(name: string, size = 1): Entry {
  return { name, relativePath: name, type: "file", size, mode: "", modifiedUnix: 0, isSymlink: false };
}

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
  vi.mocked(api.mediaUrl).mockReset();
  vi.mocked(api.textRead).mockReset();
  vi.mocked(api.textSave).mockReset();
  vi.mocked(api.opsDryRun).mockReset();
  vi.mocked(api.opsDryRun).mockResolvedValue({ hasConflict: false, items: [] });
  vi.mocked(api.opsCreateJob).mockReset();
  vi.mocked(api.renamePreview).mockReset();
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  vi.mocked(api.renameCreateJob).mockReset();
  vi.mocked(api.singleRenameCreateJob).mockReset();
  vi.mocked(api.cancelJob).mockReset();
});

async function launchPowerRename(container: HTMLElement) {
  await userEvent.click(await screen.findByRole("button", { name: "Open File Manager" }));
  const fileWindow = container.querySelector<HTMLElement>(".desktop-window")!;
  await userEvent.dblClick(within(fileWindow).getByRole("button", { name: /Source/ }));
  await userEvent.click(await within(fileWindow).findByLabelText("Select a.txt"));
  const toolbar = within(fileWindow).getByRole("navigation", { name: "File actions" });
  await userEvent.click(within(toolbar).getByRole("button", { name: "PowerRename" }));
  await screen.findByTestId("power-rename-content");
  const windows = container.querySelectorAll<HTMLElement>(".desktop-window");
  return { fileWindow: windows[0], powerRenameWindow: windows[1] };
}

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

it.each([
  "Rename",
  "Copy to right pane",
  "Move to right pane",
  "delete",
  "mkdir",
  "PowerRename",
])("closes the compact %s dialog for a mode switch without restoring it later", async (actionLabel) => {
  render(<FileWorkspace initialMode="compact" persistMode={false} />);
  const leftPane = await screen.findByRole("region", { name: "Left pane" });
  await userEvent.click(await within(leftPane).findByLabelText("Select a.txt"));
  const toolbar = screen.getByRole("navigation", { name: "File actions" });
  const modeButton = screen.getByRole("button", { name: "Switch to full mode" });

  await userEvent.click(within(toolbar).getByRole("button", { name: actionLabel }));
  await waitFor(() => expect(document.querySelector("[data-slot='dialog-content']")).not.toBeNull());

  fireEvent.click(modeButton);
  expect(await screen.findByTestId("desktop-workspace")).toBeVisible();
  await waitFor(() => expect(document.querySelector("[data-slot='dialog-content']")).toBeNull());

  await userEvent.click(screen.getByRole("button", { name: "Switch to compact mode" }));
  expect(await screen.findByTestId("workspace")).toBeVisible();
  expect(document.querySelector("[data-slot='dialog-content']")).toBeNull();
});

it("keeps an already submitted compact operation alive after its dialog closes for a mode switch", async () => {
  let resolveJob!: (job: { id: string }) => void;
  vi.mocked(api.opsCreateJob).mockReturnValue(new Promise((resolve) => {
    resolveJob = resolve;
  }));
  render(<FileWorkspace initialMode="compact" persistMode={false} />);
  const leftPane = await screen.findByRole("region", { name: "Left pane" });
  await userEvent.click(await within(leftPane).findByLabelText("Select a.txt"));
  const modeButton = screen.getByRole("button", { name: "Switch to full mode" });
  await userEvent.click(screen.getByRole("button", { name: "delete" }));
  const dialog = await screen.findByRole("dialog", { name: "delete preview" });
  const startButton = within(dialog).getByRole("button", { name: "Delete 1 item" });
  await waitFor(() => expect(startButton).toBeEnabled());

  await userEvent.click(startButton);
  expect(api.opsCreateJob).toHaveBeenCalledTimes(1);
  fireEvent.click(modeButton);
  expect(await screen.findByTestId("desktop-workspace")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "delete preview" })).not.toBeInTheDocument());

  await act(async () => resolveJob({ id: "compact-delete-job" }));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Background job created"));
  expect(screen.queryByRole("dialog", { name: "delete preview" })).not.toBeInTheDocument();
});

it("closes a compact media preview for a mode switch", async () => {
  vi.mocked(api.browse).mockImplementation(async (rootId, path) => {
    if (rootId === "source" && path === ".") {
      return [...sourceEntries, {
        name: "photo.png",
        relativePath: "photo.png",
        type: "file",
        size: 1,
        mode: "",
        modifiedUnix: 0,
        isSymlink: false,
      }];
    }
    return [];
  });
  vi.mocked(api.mediaUrl).mockReturnValue("/media/photo.png");
  render(<FileWorkspace initialMode="compact" persistMode={false} />);
  const leftPane = await screen.findByRole("region", { name: "Left pane" });
  const modeButton = screen.getByRole("button", { name: "Switch to full mode" });

  await userEvent.dblClick(await within(leftPane).findByText("photo.png"));
  expect(await screen.findByRole("dialog", { name: "Media preview" })).toBeInTheDocument();

  fireEvent.click(modeButton);
  expect(await screen.findByTestId("desktop-workspace")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Media preview" })).not.toBeInTheDocument());
});

it("navigates a compact media snapshot and disables the first and last directions", async () => {
  vi.mocked(api.browse).mockImplementation(async (rootId, path) => {
    if (rootId === "source" && path === ".") {
      return [...sourceEntries, mediaEntry("alpha.png"), mediaEntry("beta.mp4"), mediaEntry("gamma.jpg")];
    }
    return [];
  });
  vi.mocked(api.mediaUrl).mockImplementation((_rootId, path) => `/media/${path}`);
  render(<FileWorkspace initialMode="compact" persistMode={false} />);
  const leftPane = await screen.findByRole("region", { name: "Left pane" });

  await userEvent.dblClick(await within(leftPane).findByText("beta.mp4"));
  const dialog = await screen.findByRole("dialog", { name: "Media preview" });
  expect(within(dialog).getByLabelText("beta.mp4")).toHaveAttribute("src", "/media/beta.mp4");
  expect(within(dialog).getByRole("button", { name: "Previous media" })).toBeEnabled();
  expect(within(dialog).getByRole("button", { name: "Next media" })).toBeEnabled();

  await userEvent.click(within(dialog).getByRole("button", { name: "Next media" }));
  expect(within(dialog).getByRole("img", { name: "gamma.jpg" })).toHaveAttribute("src", "/media/gamma.jpg");
  expect(within(dialog).getByRole("button", { name: "Previous media" })).toBeEnabled();
  expect(within(dialog).getByRole("button", { name: "Next media" })).toBeDisabled();

  await userEvent.click(within(dialog).getByRole("button", { name: "Previous media" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Previous media" }));
  expect(within(dialog).getByRole("img", { name: "alpha.png" })).toHaveAttribute("src", "/media/alpha.png");
  expect(within(dialog).getByRole("button", { name: "Previous media" })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "Next media" })).toBeEnabled();
});

it("opens reusable independent media windows for different files in full mode", async () => {
  vi.mocked(api.browse).mockImplementation(async (rootId, path) => {
    if (rootId === "source" && path === ".") {
      return [...sourceEntries,
        {
          name: "photo.png",
          relativePath: "photo.png",
          type: "file",
          size: 1,
          mode: "",
          modifiedUnix: 0,
          isSymlink: false,
        },
        {
          name: "clip.mp4",
          relativePath: "clip.mp4",
          type: "file",
          size: 1,
          mode: "",
          modifiedUnix: 0,
          isSymlink: false,
        },
      ];
    }
    return [];
  });
  vi.mocked(api.mediaUrl).mockImplementation((_rootId, path) => `/media/${path}`);
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const taskbar = screen.getByRole("navigation", { name: "System taskbar" });
  await userEvent.click(await screen.findByRole("button", { name: "Open File Manager" }));
  const fileWindow = container.querySelector<HTMLElement>(".desktop-window[data-window-kind='file']")!;
  await userEvent.dblClick(within(fileWindow).getByRole("button", { name: /Source/ }));

  await userEvent.dblClick(await within(fileWindow).findByText("photo.png"));
  let mediaWindows = container.querySelectorAll<HTMLElement>(".desktop-window[data-window-kind='mediaPreview']");
  expect(mediaWindows).toHaveLength(1);
  expect(within(mediaWindows[0]).getByRole("img", { name: "photo.png" })).toHaveAttribute("src", "/media/photo.png");
  expect(within(mediaWindows[0]).getByRole("button", { name: "Minimize window" })).toBeInTheDocument();
  expect(mediaWindows[0].querySelector(".lucide-file-image")).not.toBeNull();
  expect(screen.queryByRole("dialog", { name: "Media preview" })).not.toBeInTheDocument();
  expect(within(taskbar).getByRole("button", { name: "photo.png" }).querySelector(".lucide-file-image")).not.toBeNull();

  await userEvent.click(within(mediaWindows[0]).getByRole("button", { name: "Minimize window" }));
  expect(container.querySelectorAll(".desktop-window[data-window-kind='mediaPreview']")).toHaveLength(0);
  expect(within(taskbar).getByRole("button", { name: "photo.png" })).toHaveAttribute("data-window-status", "minimized");

  await userEvent.dblClick(within(fileWindow).getByText("photo.png"));
  mediaWindows = container.querySelectorAll<HTMLElement>(".desktop-window[data-window-kind='mediaPreview']");
  expect(mediaWindows).toHaveLength(1);
  expect(within(taskbar).getAllByRole("button", { name: "photo.png" })).toHaveLength(1);
  expect(mediaWindows[0]).toHaveAttribute("data-active", "true");

  await userEvent.dblClick(within(fileWindow).getByText("clip.mp4"));
  mediaWindows = container.querySelectorAll<HTMLElement>(".desktop-window[data-window-kind='mediaPreview']");
  expect(mediaWindows).toHaveLength(2);
  expect(within(mediaWindows[1]).getByLabelText("clip.mp4")).toHaveAttribute("controls");
  expect(mediaWindows[1].querySelector(".lucide-file-play")).not.toBeNull();
  expect(within(taskbar).getByRole("button", { name: "clip.mp4" }).querySelector(".lucide-file-play")).not.toBeNull();
  expect(api.mediaUrl).toHaveBeenCalledWith("source", "photo.png");
  expect(api.mediaUrl).toHaveBeenCalledWith("source", "clip.mp4");
});

it("updates a full media window and taskbar while keeping its snapshot after the source closes", async () => {
  vi.mocked(api.browse).mockImplementation(async (rootId, path) => {
    if (rootId === "source" && path === ".") {
      return [...sourceEntries, mediaEntry("alpha.png"), mediaEntry("beta.mp4"), mediaEntry("gamma.jpg")];
    }
    return [];
  });
  vi.mocked(api.mediaUrl).mockImplementation((_rootId, path) => `/media/${path}`);
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const taskbar = screen.getByRole("navigation", { name: "System taskbar" });
  await userEvent.click(await screen.findByRole("button", { name: "Open File Manager" }));
  const fileWindow = container.querySelector<HTMLElement>(".desktop-window[data-window-kind='file']")!;
  await userEvent.dblClick(within(fileWindow).getByRole("button", { name: /Source/ }));

  await userEvent.dblClick(await within(fileWindow).findByText("beta.mp4"));
  const mediaWindow = container.querySelector<HTMLElement>(".desktop-window[data-window-kind='mediaPreview']")!;
  expect(within(mediaWindow).getByLabelText("beta.mp4")).toBeInTheDocument();
  expect(within(taskbar).getByRole("button", { name: "beta.mp4" }).querySelector(".lucide-file-play")).not.toBeNull();

  await userEvent.click(within(mediaWindow).getByRole("button", { name: "Next media" }));
  expect(mediaWindow).toHaveAttribute("aria-label", "gamma.jpg");
  expect(within(mediaWindow).getByRole("img", { name: "gamma.jpg" })).toHaveAttribute("src", "/media/gamma.jpg");
  expect(within(taskbar).getByRole("button", { name: "gamma.jpg" }).querySelector(".lucide-file-image")).not.toBeNull();
  expect(within(mediaWindow).getByRole("button", { name: "Next media" })).toBeDisabled();

  await userEvent.click(within(fileWindow).getByRole("button", { name: "Close window" }));
  expect(container.querySelector(".desktop-window[data-window-kind='file']")).toBeNull();
  await userEvent.click(within(mediaWindow).getByRole("button", { name: "Previous media" }));
  expect(mediaWindow).toHaveAttribute("aria-label", "beta.mp4");
  expect(within(mediaWindow).getByLabelText("beta.mp4")).toHaveAttribute("src", "/media/beta.mp4");
  expect(within(taskbar).getByRole("button", { name: "beta.mp4" }).querySelector(".lucide-file-play")).not.toBeNull();
});

it("keeps full-mode media windows independent from their source window and across mode switches", async () => {
  vi.mocked(api.browse).mockImplementation(async (rootId, path) => {
    if (rootId === "source" && path === ".") {
      return [...sourceEntries, {
        name: "photo.png",
        relativePath: "photo.png",
        type: "file",
        size: 1,
        mode: "",
        modifiedUnix: 0,
        isSymlink: false,
      }];
    }
    return [];
  });
  vi.mocked(api.mediaUrl).mockReturnValue("/media/photo.png");
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const taskbar = screen.getByRole("navigation", { name: "System taskbar" });
  await userEvent.click(await screen.findByRole("button", { name: "Open File Manager" }));
  const fileWindow = container.querySelector<HTMLElement>(".desktop-window[data-window-kind='file']")!;
  await userEvent.dblClick(within(fileWindow).getByRole("button", { name: /Source/ }));
  await userEvent.dblClick(await within(fileWindow).findByText("photo.png"));
  expect(container.querySelectorAll(".desktop-window[data-window-kind='mediaPreview']")).toHaveLength(1);

  await userEvent.click(within(fileWindow).getByRole("button", { name: "Close window" }));
  expect(container.querySelector(".desktop-window[data-window-kind='file']")).toBeNull();
  expect(container.querySelectorAll(".desktop-window[data-window-kind='mediaPreview']")).toHaveLength(1);
  expect(within(taskbar).getByRole("button", { name: "photo.png" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Switch to compact mode" }));
  expect(container.querySelector(".desktop-window[data-window-kind='mediaPreview']")).toBeNull();
  expect(within(taskbar).queryByRole("button", { name: "photo.png" })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Switch to full mode" }));
  expect(container.querySelectorAll(".desktop-window[data-window-kind='mediaPreview']")).toHaveLength(1);
  expect(within(taskbar).getByRole("button", { name: "photo.png" })).toBeInTheDocument();

  const mediaWindow = container.querySelector<HTMLElement>(".desktop-window[data-window-kind='mediaPreview']")!;
  await userEvent.click(within(mediaWindow).getByRole("button", { name: "Close window" }));
  expect(container.querySelector(".desktop-window[data-window-kind='mediaPreview']")).toBeNull();
  expect(within(taskbar).queryByRole("button", { name: "photo.png" })).not.toBeInTheDocument();
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

it("opens independent local rename dialogs without adding taskbar windows", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const icon = await screen.findByRole("button", { name: "Open File Manager" });
  await userEvent.click(icon);
  await userEvent.click(icon);
  const windows = container.querySelectorAll<HTMLElement>(".desktop-window[data-window-kind='file']");
  const firstWindow = windows[0];
  const secondWindow = windows[1];
  await userEvent.dblClick(within(firstWindow).getByRole("button", { name: /Source/ }));
  await userEvent.dblClick(within(secondWindow).getByRole("button", { name: /Source/ }));
  await userEvent.click(await within(firstWindow).findByLabelText("Select a.txt"));
  await userEvent.click(await within(secondWindow).findByLabelText("Select a.txt"));

  const firstRename = within(firstWindow).getByRole("button", { name: "Rename" });
  const secondRename = within(secondWindow).getByRole("button", { name: "Rename" });
  await userEvent.click(firstRename);
  await userEvent.type(within(firstWindow).getByLabelText("New name"), "-draft");
  fireEvent.click(firstRename);
  await userEvent.click(secondRename);

  expect(within(firstWindow).getAllByRole("dialog", { name: "Rename" })).toHaveLength(1);
  expect(within(secondWindow).getAllByRole("dialog", { name: "Rename" })).toHaveLength(1);
  expect(within(firstWindow).getByLabelText("New name")).toHaveValue("a.txt-draft");
  expect(within(firstWindow).getByLabelText("New name")).not.toHaveAttribute("id", within(secondWindow).getByLabelText("New name").id);
  expect(container.querySelectorAll(".window-dialog-layer")).toHaveLength(2);
  expect(container.querySelectorAll(".taskbar-window-button")).toHaveLength(2);
  expect(container.querySelector("[data-slot='dialog-content']")).toBeNull();
});

it("renders mkdir and delete inside the command's file window", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const icon = await screen.findByRole("button", { name: "Open File Manager" });
  await userEvent.click(icon);
  await userEvent.click(icon);
  const windows = container.querySelectorAll<HTMLElement>(".desktop-window[data-window-kind='file']");
  const sourceWindow = windows[0];
  const otherWindow = windows[1];
  await userEvent.dblClick(within(sourceWindow).getByRole("button", { name: /Source/ }));
  await userEvent.dblClick(within(otherWindow).getByRole("button", { name: /Target/ }));

  const toolbar = within(sourceWindow).getByRole("navigation", { name: "File actions" });
  await userEvent.click(within(toolbar).getByRole("button", { name: "mkdir" }));
  expect(within(sourceWindow).getByRole("dialog", { name: "Directory name" })).toBeInTheDocument();
  expect(within(otherWindow).queryByRole("dialog")).not.toBeInTheDocument();
  await userEvent.click(within(sourceWindow).getByRole("button", { name: "Cancel" }));

  await userEvent.click(await within(sourceWindow).findByLabelText("Select a.txt"));
  await userEvent.click(within(toolbar).getByRole("button", { name: "delete" }));
  expect(await within(sourceWindow).findByRole("dialog", { name: "delete preview" })).toBeInTheDocument();
  expect(within(otherWindow).queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.opsDryRun).toHaveBeenCalledWith({ type: "delete", sourceRoot: "source", sources: ["a.txt"] });
  expect(container.querySelectorAll(".taskbar-window-button")).toHaveLength(2);
});

it("submits a local rename snapshot and closes only its child dialog", async () => {
  vi.mocked(api.singleRenameCreateJob).mockResolvedValue({ id: "rename-job" });
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  await userEvent.click(await screen.findByRole("button", { name: "Open File Manager" }));
  const fileWindow = container.querySelector<HTMLElement>(".desktop-window[data-window-kind='file']")!;
  await userEvent.dblClick(within(fileWindow).getByRole("button", { name: /Source/ }));
  await userEvent.click(await within(fileWindow).findByLabelText("Select a.txt"));
  await userEvent.click(within(fileWindow).getByRole("button", { name: "Rename" }));
  const dialog = within(fileWindow).getByRole("dialog", { name: "Rename" });
  await userEvent.clear(within(dialog).getByLabelText("New name"));
  await userEvent.type(within(dialog).getByLabelText("New name"), "renamed.txt");
  await userEvent.click(within(dialog).getByRole("button", { name: "Rename" }));

  expect(api.singleRenameCreateJob).toHaveBeenCalledWith({
    rootId: "source",
    paths: ["a.txt"],
    newName: "renamed.txt",
  });
  await waitFor(() => expect(within(fileWindow).queryByRole("dialog")).not.toBeInTheDocument());
  expect(container.querySelectorAll(".desktop-window[data-window-kind='file']")).toHaveLength(1);
  expect(container.querySelectorAll(".taskbar-window-button")).toHaveLength(1);
  expect(toast.success).toHaveBeenCalledWith("Background job created");
});

it("keeps local dialogs for focus and maximize but discards them for minimize and mode changes", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const icon = await screen.findByRole("button", { name: "Open File Manager" });
  await userEvent.click(icon);
  await userEvent.click(icon);
  let windows = container.querySelectorAll<HTMLElement>(".desktop-window[data-window-kind='file']");
  const firstWindow = windows[0];
  const secondWindow = windows[1];
  await userEvent.dblClick(within(firstWindow).getByRole("button", { name: /Source/ }));
  await userEvent.dblClick(within(secondWindow).getByRole("button", { name: /Target/ }));
  await userEvent.click(await within(firstWindow).findByLabelText("Select a.txt"));
  await userEvent.click(within(firstWindow).getByRole("button", { name: "Rename" }));
  await userEvent.click(within(secondWindow).getByRole("button", { name: "mkdir" }));

  expect(within(firstWindow).getByRole("dialog", { name: "Rename" })).toBeInTheDocument();
  expect(within(secondWindow).getByRole("dialog", { name: "Directory name" })).toBeInTheDocument();
  await userEvent.click(within(firstWindow).getByRole("button", { name: "Maximize window" }));
  expect(within(firstWindow).getByRole("dialog", { name: "Rename" })).toBeInTheDocument();

  await userEvent.click(within(firstWindow).getByRole("button", { name: "Minimize window" }));
  const firstTaskbarButton = container.querySelectorAll<HTMLElement>(".taskbar-window-button")[0];
  await userEvent.click(firstTaskbarButton);
  windows = container.querySelectorAll<HTMLElement>(".desktop-window[data-window-kind='file']");
  const restoredFirst = Array.from(windows).find((window) => window.dataset.windowId === firstWindow.dataset.windowId)!;
  expect(within(restoredFirst).queryByRole("dialog")).not.toBeInTheDocument();
  expect(within(secondWindow).getByRole("dialog", { name: "Directory name" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Switch to compact mode" }));
  await userEvent.click(screen.getByRole("button", { name: "Switch to full mode" }));
  expect(container.querySelector(".window-dialog-layer")).toBeNull();
});

it("scopes file shortcuts to the active window's local dialog", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const icon = await screen.findByRole("button", { name: "Open File Manager" });
  await userEvent.click(icon);
  await userEvent.click(icon);
  const windows = container.querySelectorAll<HTMLElement>(".desktop-window[data-window-kind='file']");
  const firstWindow = windows[0];
  const secondWindow = windows[1];
  await userEvent.dblClick(within(firstWindow).getByRole("button", { name: /Source/ }));
  await userEvent.dblClick(within(secondWindow).getByRole("button", { name: /Source/ }));
  await userEvent.click(await within(firstWindow).findByLabelText("Select a.txt"));
  await userEvent.click(await within(secondWindow).findByLabelText("Select a.txt"));
  await userEvent.click(within(firstWindow).getByRole("button", { name: "Rename" }));

  vi.mocked(toast.success).mockClear();
  const secondTaskbarButton = container.querySelectorAll<HTMLElement>(".taskbar-window-button")[1];
  await userEvent.click(secondTaskbarButton);
  fireEvent.keyDown(document, { key: "c", ctrlKey: true });
  expect(toast.success).toHaveBeenCalledWith("Copied 1 item");

  vi.mocked(toast.success).mockClear();
  const firstTaskbarButton = container.querySelectorAll<HTMLElement>(".taskbar-window-button")[0];
  await userEvent.click(firstTaskbarButton);
  fireEvent.keyDown(document, { key: "c", ctrlKey: true });
  expect(toast.success).not.toHaveBeenCalled();
});

it("does not let an old local submission close a newer dialog", async () => {
  let resolveRename!: (job: { id: string }) => void;
  vi.mocked(api.singleRenameCreateJob).mockReturnValue(new Promise((resolve) => { resolveRename = resolve; }));
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  await userEvent.click(await screen.findByRole("button", { name: "Open File Manager" }));
  const fileWindow = container.querySelector<HTMLElement>(".desktop-window[data-window-kind='file']")!;
  await userEvent.dblClick(within(fileWindow).getByRole("button", { name: /Source/ }));
  await userEvent.click(await within(fileWindow).findByLabelText("Select a.txt"));
  const toolbarRename = within(fileWindow).getByRole("button", { name: "Rename" });
  await userEvent.click(toolbarRename);
  let dialog = within(fileWindow).getByRole("dialog", { name: "Rename" });
  await userEvent.clear(within(dialog).getByLabelText("New name"));
  await userEvent.type(within(dialog).getByLabelText("New name"), "first.txt");
  await userEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(within(fileWindow).queryByRole("dialog")).not.toBeInTheDocument();

  await userEvent.click(toolbarRename);
  dialog = within(fileWindow).getByRole("dialog", { name: "Rename" });
  await userEvent.clear(within(dialog).getByLabelText("New name"));
  await userEvent.type(within(dialog).getByLabelText("New name"), "second.txt");
  await act(async () => resolveRename({ id: "old-job" }));

  expect(within(fileWindow).getByRole("dialog", { name: "Rename" })).toBeInTheDocument();
  expect(within(fileWindow).getByLabelText("New name")).toHaveValue("second.txt");
  expect(api.singleRenameCreateJob).toHaveBeenCalledTimes(1);
  expect(toast.success).toHaveBeenCalledWith("Background job created");
});

it("reports a detached local submission failure globally", async () => {
  let rejectRename!: (error: Error) => void;
  vi.mocked(api.singleRenameCreateJob).mockReturnValue(new Promise((_, reject) => { rejectRename = reject; }));
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  await userEvent.click(await screen.findByRole("button", { name: "Open File Manager" }));
  const fileWindow = container.querySelector<HTMLElement>(".desktop-window[data-window-kind='file']")!;
  await userEvent.dblClick(within(fileWindow).getByRole("button", { name: /Source/ }));
  await userEvent.click(await within(fileWindow).findByLabelText("Select a.txt"));
  await userEvent.click(within(fileWindow).getByRole("button", { name: "Rename" }));
  const dialog = within(fileWindow).getByRole("dialog", { name: "Rename" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
  fireEvent.keyDown(dialog, { key: "Escape" });
  await act(async () => rejectRename(new Error("rename detached")));

  expect(within(fileWindow).queryByRole("dialog")).not.toBeInTheDocument();
  expect(toast.error).toHaveBeenCalledWith("rename detached");
});

it("keeps a submitted local request alive after its parent window closes", async () => {
  let resolveMkdir!: (job: { id: string }) => void;
  vi.mocked(api.opsCreateJob).mockReturnValue(new Promise((resolve) => { resolveMkdir = resolve; }));
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  await userEvent.click(await screen.findByRole("button", { name: "Open File Manager" }));
  const fileWindow = container.querySelector<HTMLElement>(".desktop-window[data-window-kind='file']")!;
  await userEvent.dblClick(within(fileWindow).getByRole("button", { name: /Source/ }));
  await userEvent.click(within(fileWindow).getByRole("button", { name: "mkdir" }));
  const dialog = within(fileWindow).getByRole("dialog", { name: "Directory name" });
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Directory name" }), "pending-folder");
  await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
  await userEvent.click(within(fileWindow).getByRole("button", { name: "Close window" }));
  expect(container.querySelector(".desktop-window[data-window-kind='file']")).toBeNull();

  await act(async () => resolveMkdir({ id: "mkdir-job" }));
  expect(toast.success).toHaveBeenCalledWith("Background job created");
  expect(container.querySelector(".taskbar-window-button")).toBeNull();
});

it("opens a new focused PowerRename application window from each full-mode command", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  await userEvent.click(await screen.findByRole("button", { name: "Open File Manager" }));
  const fileWindow = container.querySelector<HTMLElement>(".desktop-window")!;
  await userEvent.dblClick(within(fileWindow).getByRole("button", { name: /Source/ }));
  await userEvent.click(await within(fileWindow).findByLabelText("Select a.txt"));

  const toolbar = within(fileWindow).getByRole("navigation", { name: "File actions" });
  await userEvent.click(within(toolbar).getByRole("button", { name: "PowerRename" }));

  await waitFor(() => expect(screen.getAllByTestId("power-rename-content")).toHaveLength(1));
  const firstWindows = container.querySelectorAll<HTMLElement>(".desktop-window");
  const firstTaskbarButtons = container.querySelectorAll<HTMLElement>(".taskbar-window-button");
  expect(firstWindows).toHaveLength(2);
  expect(firstTaskbarButtons).toHaveLength(2);
  expect(firstWindows[1].querySelector(".lucide-scan-text")).not.toBeNull();
  expect(firstTaskbarButtons[1].querySelector(".lucide-scan-text")).not.toBeNull();
  expect(container.querySelector<HTMLElement>(".desktop-window:last-of-type")).toHaveAttribute("data-active", "true");
  expect(api.renamePreview).toHaveBeenCalledWith(expect.objectContaining({ rootId: "source", paths: ["a.txt"] }));

  fireEvent.contextMenu(within(fileWindow).getByText("folder"), { clientX: 100, clientY: 100 });
  const menu = await screen.findByRole("menu", { name: "File actions" });
  await userEvent.click(within(menu).getByRole("menuitem", { name: "PowerRename" }));

  await waitFor(() => expect(screen.getAllByTestId("power-rename-content")).toHaveLength(2));
  expect(container.querySelectorAll(".desktop-window")).toHaveLength(3);
  expect(container.querySelectorAll(".taskbar-window-button")).toHaveLength(3);
  expect(container.querySelectorAll<HTMLElement>(".desktop-window")[2]).toHaveAttribute("data-active", "true");
  expect(api.renamePreview).toHaveBeenCalledWith(expect.objectContaining({ rootId: "source", paths: ["folder"] }));
});

it("keeps a PowerRename snapshot usable after its source file window closes", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const { fileWindow, powerRenameWindow } = await launchPowerRename(container);

  await userEvent.click(within(fileWindow).getByRole("button", { name: "Close window" }));
  expect(container.querySelectorAll(".desktop-window")).toHaveLength(1);
  expect(container.querySelector(".desktop-window")).toBe(powerRenameWindow);
  expect(container.querySelectorAll(".taskbar-window-button")).toHaveLength(1);

  vi.mocked(api.renamePreview).mockClear();
  await userEvent.type(within(powerRenameWindow).getByLabelText("Search"), "still-independent");
  await waitFor(() => expect(api.renamePreview).toHaveBeenLastCalledWith(expect.objectContaining({
    rootId: "source",
    paths: ["a.txt"],
    options: expect.objectContaining({ search: "still-independent" }),
  })));
});

it("does not paste into the previously active file window while PowerRename is focused", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const { powerRenameWindow } = await launchPowerRename(container);

  const fileTaskbarButton = container.querySelectorAll<HTMLElement>(".taskbar-window-button")[0];
  await userEvent.click(fileTaskbarButton);
  fireEvent.keyDown(document, { key: "c", ctrlKey: true });
  expect(toast.success).toHaveBeenCalledWith("Copied 1 item");
  fireEvent.pointerDown(powerRenameWindow);
  vi.mocked(api.opsDryRun).mockClear();

  const pasteEvent = new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true, cancelable: true });
  document.dispatchEvent(pasteEvent);

  expect(pasteEvent.defaultPrevented).toBe(true);
  expect(api.opsDryRun).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith("Choose a mapped location before pasting");
});

it("preserves a minimized PowerRename draft across compact mode round trips", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const { powerRenameWindow } = await launchPowerRename(container);
  await userEvent.type(within(powerRenameWindow).getByLabelText("Search"), "draft");
  await waitFor(() => expect(api.renamePreview).toHaveBeenLastCalledWith(expect.objectContaining({
    options: expect.objectContaining({ search: "draft" }),
  })));
  await userEvent.click(within(powerRenameWindow).getByRole("button", { name: "Minimize window" }));

  await userEvent.click(screen.getByRole("button", { name: "Switch to compact mode" }));
  expect(await screen.findByTestId("workspace")).toBeVisible();
  expect(container.querySelectorAll(".taskbar-window-button")).toHaveLength(1);
  expect(screen.queryByTestId("power-rename-content")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Switch to full mode" }));
  const powerRenameTaskbarButton = screen.getByRole("button", { name: "PowerRename — 1 item" });
  expect(powerRenameTaskbarButton).toHaveAttribute("data-window-status", "minimized");
  await userEvent.click(powerRenameTaskbarButton);

  const restored = await screen.findByTestId("power-rename-content");
  expect(within(restored).getByLabelText("Search")).toHaveValue("draft");
});

it("keeps one submission lock while a PowerRename window unmounts for a mode switch", async () => {
  let resolveJob!: (job: { id: string }) => void;
  vi.mocked(api.renameCreateJob).mockReturnValue(new Promise((resolve) => { resolveJob = resolve; }));
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  await launchPowerRename(container);
  const renameButton = await screen.findByRole("button", { name: "Rename 1 item" });
  await waitFor(() => expect(renameButton).toBeEnabled());

  await userEvent.click(renameButton);
  expect(api.renameCreateJob).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getAllByRole("button", { name: "Close window" }).at(-1)).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: "Switch to compact mode" }));
  await userEvent.click(screen.getByRole("button", { name: "Switch to full mode" }));
  const restoredRenameButton = await screen.findByRole("button", { name: "Rename 1 item" });
  expect(restoredRenameButton).toBeDisabled();
  await userEvent.click(restoredRenameButton);
  expect(api.renameCreateJob).toHaveBeenCalledTimes(1);

  await act(async () => resolveJob({ id: "rename-job" }));
  await waitFor(() => expect(screen.queryByTestId("power-rename-content")).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "PowerRename — 1 item" })).not.toBeInTheDocument();
  expect(toast.success).toHaveBeenCalledWith("Background job created");
});

it("keeps a PowerRename window open and retryable after task creation fails", async () => {
  vi.mocked(api.renameCreateJob).mockRejectedValueOnce(new Error("rename unavailable"));
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const { powerRenameWindow } = await launchPowerRename(container);
  const renameButton = within(powerRenameWindow).getByRole("button", { name: "Rename 1 item" });
  await waitFor(() => expect(renameButton).toBeEnabled());

  await userEvent.click(renameButton);

  expect(await within(powerRenameWindow).findByText("rename unavailable")).toBeInTheDocument();
  expect(container.querySelectorAll(".desktop-window[data-window-kind='powerRename']")).toHaveLength(1);
  await waitFor(() => expect(renameButton).toBeEnabled());
  expect(within(powerRenameWindow).getByRole("button", { name: "Close window" })).toBeEnabled();
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
  expect(within(secondWindow).getByRole("dialog", { name: "copy preview" })).toBeInTheDocument();
  expect(within(firstWindow).queryByRole("dialog")).not.toBeInTheDocument();
  expect(container.querySelector("[data-slot='dialog-content']")).toBeNull();
  expect(screen.queryByRole("radiogroup", { name: "Operation mode" })).not.toBeInTheDocument();
});

it("opens right-click paste inside the receiving file window", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const icon = await screen.findByRole("button", { name: "Open File Manager" });
  await userEvent.click(icon);
  const sourceWindow = container.querySelector<HTMLElement>(".desktop-window[data-window-kind='file']")!;
  await userEvent.dblClick(within(sourceWindow).getByRole("button", { name: /Source/ }));
  await userEvent.click(await within(sourceWindow).findByLabelText("Select a.txt"));
  fireEvent.keyDown(document, { key: "c", ctrlKey: true });

  await userEvent.click(icon);
  const windows = container.querySelectorAll<HTMLElement>(".desktop-window[data-window-kind='file']");
  const targetWindow = windows[windows.length - 1];
  await userEvent.dblClick(within(targetWindow).getByRole("button", { name: /Target/ }));
  fireEvent.contextMenu(targetWindow.querySelector(".file-list")!, { clientX: 200, clientY: 180 });
  const menu = await screen.findByRole("menu", { name: "File actions" });
  await userEvent.click(within(menu).getByRole("menuitem", { name: "Paste" }));

  expect(await within(targetWindow).findByRole("dialog", { name: "copy preview" })).toBeInTheDocument();
  expect(within(sourceWindow).queryByRole("dialog")).not.toBeInTheDocument();
});

it("opens root-card paste inside its virtual-root file window", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const icon = await screen.findByRole("button", { name: "Open File Manager" });
  await userEvent.click(icon);
  const sourceWindow = container.querySelector<HTMLElement>(".desktop-window[data-window-kind='file']")!;
  await userEvent.dblClick(within(sourceWindow).getByRole("button", { name: /Source/ }));
  await userEvent.click(await within(sourceWindow).findByLabelText("Select a.txt"));
  fireEvent.keyDown(document, { key: "c", ctrlKey: true });

  await userEvent.click(icon);
  const windows = container.querySelectorAll<HTMLElement>(".desktop-window[data-window-kind='file']");
  const targetWindow = windows[windows.length - 1];
  fireEvent.contextMenu(within(targetWindow).getByRole("button", { name: /Target/ }), { clientX: 200, clientY: 180 });
  const menu = await screen.findByRole("menu", { name: "File actions" });
  await userEvent.click(within(menu).getByRole("menuitem", { name: "Paste" }));

  expect(await within(targetWindow).findByRole("dialog", { name: "copy preview" })).toBeInTheDocument();
  expect(api.opsDryRun).toHaveBeenCalledWith({
    type: "copy",
    sourceRoot: "source",
    sources: ["a.txt"],
    destRoot: "target",
    destPath: ".",
  });
});

it("clears a cut clipboard only after the local move job is created", async () => {
  vi.mocked(api.opsCreateJob).mockResolvedValue({ id: "move-job" });
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const icon = await screen.findByRole("button", { name: "Open File Manager" });
  await userEvent.click(icon);
  const sourceWindow = container.querySelector<HTMLElement>(".desktop-window[data-window-kind='file']")!;
  await userEvent.dblClick(within(sourceWindow).getByRole("button", { name: /Source/ }));
  const fileName = await within(sourceWindow).findByText("a.txt");
  fireEvent.contextMenu(fileName, { clientX: 100, clientY: 100 });
  const menu = await screen.findByRole("menu", { name: "File actions" });
  await userEvent.click(within(menu).getByRole("menuitem", { name: "Cut" }));
  expect(fileName.closest("tr")).toHaveAttribute("data-clipboard-cut", "true");

  await userEvent.click(icon);
  const windows = container.querySelectorAll<HTMLElement>(".desktop-window[data-window-kind='file']");
  const targetWindow = windows[windows.length - 1];
  await userEvent.dblClick(within(targetWindow).getByRole("button", { name: /Target/ }));
  fireEvent.keyDown(document, { key: "v", ctrlKey: true });
  const dialog = await within(targetWindow).findByRole("dialog", { name: "move preview" });
  expect(fileName.closest("tr")).toHaveAttribute("data-clipboard-cut", "true");
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Start move" })).toBeEnabled());
  await userEvent.click(within(dialog).getByRole("button", { name: "Start move" }));

  expect(api.opsCreateJob).toHaveBeenCalledWith({
    type: "move",
    sourceRoot: "source",
    sources: ["a.txt"],
    destRoot: "target",
    destPath: ".",
  });
  await waitFor(() => expect(fileName.closest("tr")).not.toHaveAttribute("data-clipboard-cut"));
  expect(within(targetWindow).queryByRole("dialog")).not.toBeInTheDocument();
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
