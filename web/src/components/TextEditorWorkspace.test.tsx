import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api, APIError } from "../api/client";
import type { Entry, TextDocument } from "../api/types";
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
  APIError: class APIError extends Error {
    code: string;
    status: number;

    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));

const entries: Entry[] = [
  entry("main.go"),
  entry("notes.txt"),
  entry("diagram.svg"),
  entry("archive.bin"),
];

beforeEach(() => {
  vi.mocked(api.roots).mockReset();
  vi.mocked(api.roots).mockResolvedValue([{ id: "source", name: "Source" }]);
  vi.mocked(api.browse).mockReset();
  vi.mocked(api.browse).mockResolvedValue(entries);
  vi.mocked(api.mediaUrl).mockReset();
  vi.mocked(api.mediaUrl).mockImplementation((_rootId, path) => `/media/${path}`);
  vi.mocked(api.textRead).mockReset();
  vi.mocked(api.textRead).mockImplementation(async (_rootId, path) => textDocument(`contents of ${path}\n`));
  vi.mocked(api.textSave).mockReset();
  vi.mocked(api.textSave).mockResolvedValue({ byteSize: 20, revision: `sha256:${"b".repeat(64)}` });
});

it("opens a loading text window immediately and fills it from one read request", async () => {
  let resolveRead!: (document: TextDocument) => void;
  vi.mocked(api.textRead).mockReturnValue(new Promise((resolve) => {
    resolveRead = resolve;
  }));
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const fileWindow = await openSourceWindow(container);

  await userEvent.dblClick(await within(fileWindow).findByText("main.go"));

  const editorWindow = container.querySelector<HTMLElement>('.desktop-window[data-window-kind="textEditor"]');
  expect(editorWindow).not.toBeNull();
  expect(within(editorWindow!).getByText("Loading editor…")).toBeInTheDocument();
  expect(api.textRead).toHaveBeenCalledWith("source", "main.go");
  expect(container.querySelector('.taskbar-window-button[data-window-kind="textEditor"]')).toHaveTextContent("main.go");

  await act(async () => resolveRead(textDocument("package main\n")));
  await waitFor(() => expect(editorWindow!.querySelector(".cm-editor")).toBeInTheDocument());
  expect(editorWindow).toHaveTextContent("Go");
});

it("restores and focuses the existing window when the same path is opened again", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const fileWindow = await openSourceWindow(container);
  const fileName = await within(fileWindow).findByText("main.go");
  await userEvent.dblClick(fileName);
  const editorWindow = container.querySelector<HTMLElement>('.desktop-window[data-window-kind="textEditor"]')!;
  await waitFor(() => expect(editorWindow.querySelector(".cm-editor")).toBeInTheDocument());

  await userEvent.click(within(editorWindow).getByRole("button", { name: "Minimize window" }));
  expect(container.querySelector('.desktop-window[data-window-kind="textEditor"]')).not.toBeInTheDocument();
  await userEvent.dblClick(fileName);

  expect(container.querySelectorAll('.desktop-window[data-window-kind="textEditor"]')).toHaveLength(1);
  expect(container.querySelector('.desktop-window[data-window-kind="textEditor"]')).toHaveAttribute("data-active", "true");
  expect(api.textRead).toHaveBeenCalledTimes(1);
});

it("opens independent text windows while keeping SVG media and unknown files out of the editor", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const fileWindow = await openSourceWindow(container);

  await userEvent.dblClick(await within(fileWindow).findByText("main.go"));
  await userEvent.dblClick(within(fileWindow).getByText("notes.txt"));
  expect(container.querySelectorAll('.desktop-window[data-window-kind="textEditor"]')).toHaveLength(2);
  expect(api.textRead).toHaveBeenCalledTimes(2);

  await userEvent.dblClick(within(fileWindow).getByText("diagram.svg"));
  expect(container.querySelectorAll('.desktop-window[data-window-kind="mediaPreview"]')).toHaveLength(1);
  expect(api.textRead).toHaveBeenCalledTimes(2);

  await userEvent.dblClick(within(fileWindow).getByText("archive.bin"));
  expect(container.querySelectorAll('.desktop-window[data-window-kind="textEditor"]')).toHaveLength(2);
  expect(api.textRead).toHaveBeenCalledTimes(2);
});

it("keeps a text editor alive when its source window closes or the mode changes", async () => {
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const fileWindow = await openSourceWindow(container);
  await userEvent.dblClick(await within(fileWindow).findByText("notes.txt"));
  await waitFor(() => expect(container.querySelector('.desktop-window[data-window-kind="textEditor"] .cm-editor')).toBeInTheDocument());

  await userEvent.click(within(fileWindow).getByRole("button", { name: "Close window" }));
  expect(container.querySelector('.desktop-window[data-window-kind="textEditor"]')).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Switch to compact mode" }));
  expect(container.querySelector('.desktop-window[data-window-kind="textEditor"]')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Switch to full mode" }));

  expect(container.querySelector('.desktop-window[data-window-kind="textEditor"]')).toBeInTheDocument();
  expect(api.textRead).toHaveBeenCalledTimes(1);
});

it("shows a read failure inside the editor window", async () => {
  vi.mocked(api.textRead).mockRejectedValue(new Error("Unable to read notes.txt"));
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const fileWindow = await openSourceWindow(container);
  await userEvent.dblClick(await within(fileWindow).findByText("notes.txt"));

  const editorWindow = container.querySelector<HTMLElement>('.desktop-window[data-window-kind="textEditor"]')!;
  expect(await within(editorWindow).findByRole("alert")).toHaveTextContent("Unable to read notes.txt");
  await userEvent.click(within(editorWindow).getByRole("button", { name: "Close window" }));
  expect(container.querySelector('.desktop-window[data-window-kind="textEditor"]')).not.toBeInTheDocument();
});

it("deduplicates keyboard saves, clears the dirty title, and refreshes visible file panes", async () => {
  let resolveSave!: (result: { byteSize: number; revision: string }) => void;
  vi.mocked(api.textSave).mockReturnValue(new Promise((resolve) => {
    resolveSave = resolve;
  }));
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const fileWindow = await openSourceWindow(container);
  await userEvent.dblClick(await within(fileWindow).findByText("notes.txt"));
  const editorWindow = container.querySelector<HTMLElement>('.desktop-window[data-window-kind="textEditor"]')!;
  const editor = await waitForEditor(editorWindow);

  await userEvent.click(editor);
  await userEvent.keyboard(" edited");
  await waitFor(() => expect(editorWindow).toHaveAttribute("aria-label", "notes.txt *"));
  const browseCallsBeforeSave = vi.mocked(api.browse).mock.calls.length;
  editor.focus();
  fireSaveShortcut(editor);
  fireSaveShortcut(editor);

  expect(api.textSave).toHaveBeenCalledOnce();
  expect(api.textSave).toHaveBeenCalledWith(expect.objectContaining({
    rootId: "source",
    path: "notes.txt",
    content: expect.stringContaining("edited"),
    force: false,
  }));
  resolveSave({ byteSize: 27, revision: `sha256:${"c".repeat(64)}` });

  await waitFor(() => expect(editorWindow).toHaveAttribute("aria-label", "notes.txt"));
  await waitFor(() => expect(vi.mocked(api.browse).mock.calls.length).toBeGreaterThan(browseCallsBeforeSave));
  expect(screen.getByRole("button", { name: "Jobs" })).toHaveAttribute("aria-expanded", "false");
});

it("reloads the disk version from the window-local conflict confirmation", async () => {
  vi.mocked(api.textRead)
    .mockResolvedValueOnce(textDocument("initial\n"))
    .mockResolvedValueOnce({
      ...textDocument("disk version\n"),
      revision: `sha256:${"d".repeat(64)}`,
    });
  vi.mocked(api.textSave).mockRejectedValueOnce(new APIError("revision_conflict", "changed elsewhere", 409));
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const fileWindow = await openSourceWindow(container);
  await userEvent.dblClick(await within(fileWindow).findByText("notes.txt"));
  const editorWindow = container.querySelector<HTMLElement>('.desktop-window[data-window-kind="textEditor"]')!;
  const editor = await waitForEditor(editorWindow);
  await userEvent.click(editor);
  await userEvent.keyboard(" local");

  await userEvent.click(within(editorWindow).getByRole("button", { name: "Save" }));
  const conflict = await within(editorWindow).findByRole("dialog", { name: "File changed on disk" });
  expect(conflict).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Jobs" })).not.toBeInTheDocument();
  await userEvent.click(within(conflict).getByRole("button", { name: "Reload" }));

  await waitFor(() => expect(within(editorWindow).queryByRole("dialog", { name: "File changed on disk" })).not.toBeInTheDocument());
  const reloadedEditor = await waitForEditor(editorWindow);
  await waitFor(() => expect(reloadedEditor).toHaveTextContent("disk version"));
  expect(editorWindow).toHaveAttribute("aria-label", "notes.txt");
  expect(api.textRead).toHaveBeenCalledTimes(2);
});

it("cancels a conflict without losing edits and can force the captured content", async () => {
  vi.mocked(api.textSave)
    .mockRejectedValueOnce(new APIError("revision_conflict", "changed elsewhere", 409))
    .mockRejectedValueOnce(new APIError("revision_conflict", "changed elsewhere", 409))
    .mockResolvedValueOnce({ byteSize: 15, revision: `sha256:${"e".repeat(64)}` });
  const { container } = render(<FileWorkspace initialMode="desktop" persistMode={false} />);
  const fileWindow = await openSourceWindow(container);
  await userEvent.dblClick(await within(fileWindow).findByText("notes.txt"));
  const editorWindow = container.querySelector<HTMLElement>('.desktop-window[data-window-kind="textEditor"]')!;
  const editor = await waitForEditor(editorWindow);
  await userEvent.click(editor);
  await userEvent.keyboard(" local");

  await userEvent.click(within(editorWindow).getByRole("button", { name: "Save" }));
  let conflict = await within(editorWindow).findByRole("dialog", { name: "File changed on disk" });
  await userEvent.click(within(conflict).getByRole("button", { name: "Cancel" }));
  expect(within(editorWindow).queryByRole("dialog", { name: "File changed on disk" })).not.toBeInTheDocument();
  expect(editorWindow).toHaveAttribute("aria-label", "notes.txt *");

  await userEvent.click(within(editorWindow).getByRole("button", { name: "Save" }));
  conflict = await within(editorWindow).findByRole("dialog", { name: "File changed on disk" });
  await userEvent.click(within(conflict).getByRole("button", { name: "Overwrite anyway" }));

  await waitFor(() => expect(within(editorWindow).queryByRole("dialog", { name: "File changed on disk" })).not.toBeInTheDocument());
  expect(api.textSave).toHaveBeenLastCalledWith(expect.objectContaining({
    content: expect.stringContaining("local"),
    force: true,
  }));
  expect(editorWindow).toHaveAttribute("aria-label", "notes.txt");
});

async function openSourceWindow(container: HTMLElement) {
  await userEvent.click(await screen.findByRole("button", { name: "Open File Manager" }));
  const fileWindow = container.querySelector<HTMLElement>('.desktop-window[data-window-kind="file"]')!;
  await userEvent.dblClick(within(fileWindow).getByRole("button", { name: /Source/ }));
  await within(fileWindow).findByText("main.go");
  return fileWindow;
}

function entry(name: string): Entry {
  return { name, relativePath: name, type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false };
}

function textDocument(content: string): TextDocument {
  return {
    content,
    encoding: "utf-8",
    lineEnding: content.includes("\n") ? "lf" : "none",
    preferredLineEnding: "lf",
    byteSize: new TextEncoder().encode(content).length,
    revision: `sha256:${"a".repeat(64)}`,
  };
}

async function waitForEditor(editorWindow: HTMLElement) {
  await waitFor(() => expect(editorWindow.querySelector(".cm-content")).toBeInTheDocument());
  return editorWindow.querySelector<HTMLElement>(".cm-content")!;
}

function fireSaveShortcut(editor: HTMLElement) {
  editor.dispatchEvent(new KeyboardEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true, bubbles: true }));
}
