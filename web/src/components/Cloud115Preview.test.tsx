import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cloudCall } from "../cloud115";
import { strings } from "../i18n";
import { Cloud115Preview } from "./Cloud115Preview";

vi.mock("../cloud115", () => ({ cloudCall: vi.fn() }));
const url = "https://cdn.example/file";
beforeEach(() => {
  vi.mocked(cloudCall).mockReset().mockResolvedValue({ url, size: 20 * 1024 * 1024, accountId: "1" });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function preview(name = "movie.mp4") {
  return render(<Cloud115Preview instance={{ entries: [{ id: "1", parentId: "0", name, isDirectory: false, size: 20 * 1024 * 1024 }], entryId: "1", accountId: "1" }} labels={strings["zh-CN"]} onNavigate={vi.fn()} />);
}

it("shows only matching refresh and copy buttons, disables copy until a link exists", async () => {
  vi.mocked(cloudCall).mockReturnValue(new Promise(() => {}));
  preview();
  expect(screen.getByRole("button", { name: "复制直链" })).toBeDisabled();
  expect(screen.queryByText("movie.mp4")).not.toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  const buttons = screen.getAllByRole("button").filter((button) => ["重新获取直链", "复制直链"].includes(button.textContent ?? ""));
  expect(buttons).toHaveLength(2);
  expect(buttons[0].className).toBe(buttons[1].className);
  expect(screen.getByRole("toolbar")).toContainElement(screen.getByText("正在直接从115加载…"));
  expect(screen.getByRole("toolbar").firstElementChild).toBe(screen.getByText("正在直接从115加载…"));
  expect(buttons[0].parentElement).toHaveClass("ml-auto");
});

it("removes the left-hand loading message when media loads without moving the button group", async () => {
  const { container } = preview();
  await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
  const toolbar = screen.getByRole("toolbar");
  const buttons = screen.getByRole("button", { name: "复制直链" }).parentElement;
  expect(toolbar.firstElementChild).toHaveTextContent("正在直接从115加载…");
  fireEvent.loadedData(container.querySelector("video")!);
  expect(screen.queryByText("正在直接从115加载…")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "复制直链" }).parentElement).toBe(buttons);
  expect(buttons).toHaveClass("ml-auto");
});

it("shows server text errors without a direct-link toolbar", async () => {
  vi.mocked(cloudCall).mockRejectedValue(new Error("文本超过10 MiB预览上限，请直接下载。"));
  preview("large.txt");
  expect((await screen.findByRole("alert")).textContent).toBe("文本超过10 MiB预览上限，请直接下载。");
  expect(screen.queryByRole("button", { name: "复制直链" })).not.toBeInTheDocument();
  expect(screen.queryByRole("toolbar", { name: "直链操作" })).not.toBeInTheDocument();
  expect(screen.queryByText("正在直接从115加载…")).not.toBeInTheDocument();
});

it("loads read-only text through FB and cancels pending reads on close", async () => {
  vi.mocked(cloudCall).mockReturnValue(new Promise(() => {}));
  const view = preview("notes.txt");
  expect(cloudCall).toHaveBeenCalledWith("preview.text", { id: "1", accountId: "1" }, expect.any(AbortSignal));
  expect(screen.queryByRole("toolbar", { name: "直链操作" })).not.toBeInTheDocument();
  const signal = vi.mocked(cloudCall).mock.calls[0][2]!;
  view.unmount();
  expect(signal.aborted).toBe(true);
});

it("does not fetch a link or report a text size error for unsupported files", () => {
  preview("movie.avi");
  expect(cloudCall).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("copies the current link, refreshes it, and disables copying on account changes", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  preview();
  const copy = screen.getByRole("button", { name: "复制直链" });
  await waitFor(() => expect(copy).toBeEnabled());
  fireEvent.click(copy);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(url));
  vi.mocked(cloudCall).mockResolvedValue({ url: `${url}?renewed`, size: 1, accountId: "1" });
  fireEvent.click(screen.getByRole("button", { name: "重新获取直链" }));
  await waitFor(() => expect(copy).toBeEnabled());
  fireEvent.click(copy);
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(`${url}?renewed`));
  act(() => window.dispatchEvent(new CustomEvent("cloud115-account-changed", { detail: { accountId: "1" } })));
  expect(copy).toBeDisabled();
});

it("reports clipboard permission failures without claiming success", async () => {
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) } });
  preview();
  const copy = screen.getByRole("button", { name: "复制直链" });
  await waitFor(() => expect(copy).toBeEnabled());
  fireEvent.click(copy);
  await screen.findByText("复制失败，请检查浏览器剪贴板权限");
  expect(screen.queryByText("直链已复制")).not.toBeInTheDocument();
});
