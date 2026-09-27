import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ExtractDialog } from "./ExtractDialog";
import { strings } from "../i18n";
import { api } from "../api/client";
import { archiveDirectoryName, isLocalArchive } from "../localExtract";
import type { Entry } from "../api/types";

vi.mock("../api/client", () => ({ api: { browse: vi.fn() } }));
const target = { sourceRoot: "a", sourcePath: "photos.zip", destRoot: "a", destPath: ".", name: "photos" };
const roots = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
beforeEach(() => { vi.mocked(api.browse).mockReset().mockResolvedValue([]); });

it("uses shared footer and inputs, and submits a password and destination without a second confirmation", async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  render(<ExtractDialog target={target} roots={roots} labels={strings["zh-CN"]} onClose={() => {}} onSubmit={submit} />);
  expect(screen.getByRole("button", { name: "确认" }).closest('[data-slot="dialog-footer"]')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("目标根目录"), { target: { value: "b" } });
  fireEvent.change(screen.getByLabelText("目标路径"), { target: { value: "/downloads" } });
  fireEvent.change(screen.getByLabelText("解压密码"), { target: { value: "test-password" } });
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  await waitFor(() => expect(submit).toHaveBeenCalledWith({ ...target, destRoot: "b", destPath: "downloads", password: "test-password" }));
});

it("retains input and displays request failures", async () => {
  render(<ExtractDialog target={target} roots={roots} labels={strings["zh-CN"]} onClose={() => {}} onSubmit={async () => { throw new Error("目标已存在"); }} />);
  fireEvent.change(screen.getByLabelText("解压密码"), { target: { value: "keep" } });
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("目标已存在");
  expect(screen.getByLabelText("解压密码")).toHaveValue("keep");
});

it("browses only directories within the chosen root", async () => {
  vi.mocked(api.browse).mockResolvedValue([
    { name: "folder", relativePath: "folder", type: "directory", size: 0, mode: "", modifiedUnix: 0, isSymlink: false },
    { name: "a.txt", relativePath: "a.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
  ]);
  render(<ExtractDialog target={target} roots={roots} labels={strings["zh-CN"]} onClose={() => {}} onSubmit={async () => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "浏览" }));
  const folder = await screen.findByRole("button", { name: "folder" });
  fireEvent.click(folder);
  expect(folder).toHaveAttribute("aria-pressed", "true");
  expect(folder).toHaveAttribute("data-selected", "true");
  expect(folder.className).not.toContain("translate-y");
  expect(screen.getByLabelText("目标路径")).toHaveValue("/");
  fireEvent.doubleClick(folder);
  await waitFor(() => expect(api.browse).toHaveBeenCalledWith("a", "folder"));
  await waitFor(() => expect(screen.getByLabelText("目标路径")).toHaveValue("/folder"));
  expect(screen.queryByText("a.txt")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "上移" }));
  await waitFor(() => expect(screen.getByLabelText("目标路径")).toHaveValue("/"));
});

it("shows the entire root-relative path and navigates on Enter without submitting extraction", async () => {
  const submit = vi.fn();
  render(<ExtractDialog target={{ ...target, destPath: "一级/二级" }} roots={roots} labels={strings["zh-CN"]} onClose={() => {}} onSubmit={submit} />);
  const input = screen.getByLabelText("目标路径");
  expect(input).toHaveValue("/一级/二级");
  fireEvent.change(input, { target: { value: " /相册/2026/ " } });
  expect(api.browse).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(input).toHaveValue("/相册/2026"));
  expect(api.browse).toHaveBeenCalledWith("a", "相册/2026");
  expect(screen.getByLabelText("选择目标文件夹")).toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
});

it("keeps the current directory and folder listing when a typed path is invalid", async () => {
  vi.mocked(api.browse).mockResolvedValueOnce([
    { name: "old-child", relativePath: "old/old-child", type: "directory", size: 0, mode: "", modifiedUnix: 0, isSymlink: false },
  ]).mockRejectedValueOnce(new Error("目录不存在"));
  render(<ExtractDialog target={{ ...target, destPath: "old" }} roots={roots} labels={strings["zh-CN"]} onClose={() => {}} onSubmit={async () => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "浏览" }));
  await screen.findByRole("button", { name: "old-child" });
  const input = screen.getByLabelText("目标路径");
  fireEvent.change(input, { target: { value: "/missing" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(await screen.findByRole("alert")).toHaveTextContent("目录不存在");
  expect(input).toHaveValue("/old");
  expect(screen.getByRole("button", { name: "old-child" })).toBeInTheDocument();
});

it("ignores an outdated navigation response", async () => {
  let resolveOld!: (entries: Entry[]) => void;
  vi.mocked(api.browse).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValueOnce([]);
  render(<ExtractDialog target={target} roots={roots} labels={strings["zh-CN"]} onClose={() => {}} onSubmit={async () => {}} />);
  const input = screen.getByLabelText("目标路径");
  fireEvent.change(input, { target: { value: "/old" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.change(input, { target: { value: "/new" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(input).toHaveValue("/new"));
  await act(async () => { resolveOld([]); });
  expect(input).toHaveValue("/new");
});

it("defaults to the archive name but permits an empty output folder for direct extraction", async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  render(<ExtractDialog target={target} roots={roots} labels={strings["zh-CN"]} onClose={() => {}} onSubmit={submit} />);
  const name = screen.getByLabelText("输出文件夹名称");
  expect(name).toHaveValue("photos");
  fireEvent.change(name, { target: { value: "" } });
  expect(name).toHaveAttribute("placeholder", "留空则直接解压到目标位置");
  expect(screen.getByRole("button", { name: "确认" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  await waitFor(() => expect(submit).toHaveBeenCalledWith({ ...target, name: "", password: "" }));
});

it("recognizes archives but not directory names or symbolic links", () => {
  const entry = { name: "photos.TAR.GZ", type: "file" } as Entry;
  expect(isLocalArchive(entry)).toBe(true);
  expect(archiveDirectoryName(entry.name)).toBe("photos");
  expect(isLocalArchive({ ...entry, type: "directory" })).toBe(false);
  expect(isLocalArchive({ ...entry, type: "symlink" })).toBe(false);
  expect(isLocalArchive({ ...entry, name: "movie.avi" })).toBe(false);
});
