import { expect, it } from "vitest";
import { resolveLanguage, strings } from "./i18n";

it("resolves Simplified Chinese from browser languages", () => {
  expect(resolveLanguage("auto", ["zh-CN", "en-US"])).toBe("zh-CN");
});

it("falls back to English for automatic non-Chinese languages", () => {
  expect(resolveLanguage("auto", ["fr-FR", "en-US"])).toBe("en");
});

it("formats hidden path segment labels in both supported languages", () => {
  expect(strings.en.hiddenPathSegments(3)).toBe("Show 3 hidden folders");
  expect(strings["zh-CN"].hiddenPathSegments(3)).toBe("显示 3 个隐藏文件夹");
});

it("localizes the drag operation selector", () => {
  expect(strings.en.operationMode).toBe("Operation");
  expect(strings["zh-CN"].operationMode).toBe("操作方式");
});

it("localizes drag summaries, destinations, and invalid targets", () => {
  expect(strings.en.dragSummary("a.txt", 2)).toBe("a.txt and 1 more");
  expect(strings["zh-CN"].dragSummary("a.txt", 2)).toBe("a.txt 等 2 项");
  expect(strings.en.dragDestination("move", "folder")).toBe("move to folder");
  expect(strings["zh-CN"].invalidDrop("inside-source")).toBe("不能将文件夹放入自身或其子文件夹");
});

it("formats PowerRename application window titles", () => {
  expect(strings.en.powerRenameWindowTitle(1)).toBe("PowerRename — 1 item");
  expect(strings.en.powerRenameWindowTitle(3)).toBe("PowerRename — 3 items");
  expect(strings["zh-CN"].powerRenameWindowTitle(3)).toBe("PowerRename — 3 项");
});
