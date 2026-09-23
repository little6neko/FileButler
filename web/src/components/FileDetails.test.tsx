import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { FileDetails } from "./FileDetails";
import { detailChinese, detailSize, detailDuration, readDetails, type DetailItem, type DetailsTarget } from "../fileDetails";
import { strings } from "../i18n";
import { toast } from "sonner";

vi.mock("../fileDetails", async (original) => ({ ...await original<typeof import("../fileDetails")>(), readDetails: vi.fn() }));
const target: DetailsTarget = { rootId: "a", paths: ["a.txt"], names: ["a.txt"] };
const item: DetailItem = { name: "a.txt", path: "a.txt", type: "file", location: "/data", size: 65982, allocated: 69632, modifiedUnix: 1, createdUnix: null, sha1: "" };
beforeEach(() => { vi.mocked(readDetails).mockReset(); vi.mocked(readDetails).mockImplementation(async (_target, section) => section === "basic" ? [item] : section === "hash" ? { sha1: "A".repeat(40) } : { size: 1, allocated: 4096, files: 1, folders: 0 }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("formats precise grouped bytes and long durations", () => {
  expect(detailSize(65982, detailChinese.bytes)).toBe("64.44 KB（65,982 字节）");
  expect(detailSize(0, "字节")).toBe("0 B（0 字节）");
  expect(detailSize(null, "字节")).toBe("--");
  expect(detailDuration(1022)).toBe("00:17:02");
  expect(detailDuration(360000)).toBe("100:00:00");
});
it("does not calculate SHA1 on open, hides contains for a file, supports explicit refresh", async () => {
  render(<FileDetails target={target} labels={strings["zh-CN"]} />);
  await screen.findByText("64.44 KB（65,982 字节）");
  expect(readDetails).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("共包含")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新获取" }));
  await screen.findByText("A".repeat(40));
  expect(vi.mocked(readDetails).mock.calls[1][1]).toBe("hash");
});
it("hides individual metadata for mixed multi-selection and shows totals", async () => {
  vi.mocked(readDetails).mockImplementation(async (_target, section) => section === "basic" ? [item, { ...item, name: "folder", type: "directory" }] : { size: 3, allocated: 4096, files: 2, folders: 1 });
  render(<FileDetails target={{ ...target, paths: ["a.txt", "folder"], names: ["a.txt", "folder"] }} labels={strings["zh-CN"]} />);
  await screen.findByText("多种类型"); await screen.findByText("2个文件，1个文件夹");
  expect(screen.getByText("a.txt 等 2 项")).toBeInTheDocument();
  for (const text of ["分辨率", "时长", "修改时间", "创建时间", "SHA1"]) expect(screen.queryByText(text)).not.toBeInTheDocument();
});
it("shows media fields only for supported preview types", async () => {
  vi.mocked(readDetails).mockImplementation(async (_target, section) => section === "basic" ? [{ ...item, name: "video.mp4" }] : { width: 3840, height: 2160, duration: 1022 });
  const view = render(<FileDetails target={{ ...target, names: ["video.mp4"] }} labels={strings["zh-CN"]} />);
  await screen.findByText("3840 * 2160"); expect(screen.getByText("00:17:02")).toBeInTheDocument(); view.unmount();
  vi.mocked(readDetails).mockClear(); vi.mocked(readDetails).mockResolvedValue([{ ...item, name: "video.avi" }]);
  render(<FileDetails target={{ ...target, names: ["video.avi"] }} labels={strings["zh-CN"]} />);
  await screen.findByText("avi"); expect(screen.queryByText("分辨率")).not.toBeInTheDocument(); expect(readDetails).toHaveBeenCalledTimes(1);
});
it("cancels requests on close and account changes", async () => {
  const view = render(<FileDetails target={target} labels={strings["zh-CN"]} />);
  await screen.findByText("txt"); const signal = vi.mocked(readDetails).mock.calls[0][2]; view.unmount(); expect(signal.aborted).toBe(true);
  render(<FileDetails target={{ ...target, rootId: "@115", accountId: "1" }} labels={strings["zh-CN"]} />);
  await screen.findByText("txt"); act(() => window.dispatchEvent(new Event("cloud115-account-changed")));
  expect(screen.getByRole("alert")).toHaveTextContent("115账号已变化"); expect(screen.getByRole("button", { name: "重新获取" })).toBeDisabled();
});
it.each([
  { rootId: "a", path: "a.txt", name: "a.txt", type: "file" as const, location: "/data", expected: "/data/a.txt" },
  { rootId: "a", path: "folder", name: "folder", type: "directory" as const, location: "/data", expected: "/data/folder" },
  { rootId: "a", path: ".", name: "data", type: "directory" as const, location: "/data", expected: "/data" },
  { rootId: "a", path: "0", name: "0", type: "directory" as const, location: "/data", expected: "/data/0" },
  { rootId: "@115", path: "123", name: "文件.txt", type: "file" as const, location: "/资料", expected: "/资料/文件.txt" },
  { rootId: "@115", path: "456", name: "folder", type: "directory" as const, location: "/", expected: "/folder" },
  { rootId: "@115", path: "0", name: "根目录", type: "directory" as const, location: "/", expected: "/" },
])("copies a single item's full path: $rootId $path", async ({ rootId, path, name, type, location, expected }) => {
  const writeText = vi.fn().mockResolvedValue(undefined); vi.stubGlobal("navigator", { clipboard: { writeText } });
  vi.mocked(readDetails).mockImplementation(async (_target, section) => section === "basic" ? [{ ...item, path, name, type, location }] : { size: 0, allocated: 0, files: 0, folders: 0 });
  render(<FileDetails target={{ rootId, paths: [path], names: [name] }} labels={strings["zh-CN"]} />);
  await screen.findByText(location);
  fireEvent.click(screen.getByRole("button", { name: "复制原始路径" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
});
it.each(["a", "@115"])("copies only the shared directory for multiple items in %s", async (rootId) => {
  const writeText = vi.fn().mockResolvedValue(undefined); vi.stubGlobal("navigator", { clipboard: { writeText } });
  vi.mocked(readDetails).mockImplementation(async (_target, section) => section === "basic" ? [item, { ...item, name: "folder", path: "folder", type: "directory" }] : { size: 0, allocated: 0, files: 0, folders: 0 });
  render(<FileDetails target={{ rootId, paths: ["1", "2"], names: ["a.txt", "folder"] }} labels={strings["zh-CN"]} />);
  await screen.findByText("/data");
  fireEvent.click(screen.getByRole("button", { name: "复制原始路径" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("/data"));
});
it.each([true, false])("copies without the Clipboard API and reports the result (success=%s)", async (success) => {
  vi.stubGlobal("navigator", {});
  const copied = vi.spyOn(toast, "success").mockImplementation(() => "success");
  const failed = vi.spyOn(toast, "error").mockImplementation(() => "error");
  const original = Object.getOwnPropertyDescriptor(document, "execCommand");
  const execute = vi.fn(() => {
    expect(document.querySelector("textarea")?.value).toBe("/data/a.txt");
    return success;
  });
  Object.defineProperty(document, "execCommand", { configurable: true, value: execute });
  try {
    render(<FileDetails target={target} labels={strings["zh-CN"]} />);
    await screen.findByText("/data");
    const button = screen.getByRole("button", { name: "复制原始路径" });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(success ? copied : failed).toHaveBeenCalledTimes(1));
    expect(success ? failed : copied).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(button);
  } finally {
    if (original) Object.defineProperty(document, "execCommand", original);
    else Reflect.deleteProperty(document, "execCommand");
  }
});
