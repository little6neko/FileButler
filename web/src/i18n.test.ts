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

it("localizes text editor actions, states, and cursor position", () => {
  expect(strings.en.textEditorLabel("main.go")).toBe("Edit main.go");
  expect(strings["zh-CN"].textEditorLabel("main.go")).toBe("编辑 main.go");
  expect(strings.en.editorLineColumn(2, 7)).toBe("Line 2, column 7");
  expect(strings["zh-CN"].editorLineColumn(2, 7)).toBe("第 2 行，第 7 列");
  expect(strings.en.editorHighlightUnavailable).toContain("plain text");
  expect(strings["zh-CN"].editorHighlightUnavailable).toContain("纯文本");
  expect(strings.en.editorUnsavedDescription("main.go")).toContain("main.go");
  expect(strings["zh-CN"].editorUnsavedTitle).toBe("有未保存的更改");
  expect(strings.en.discardChanges).toBe("Don't save");
  expect(strings["zh-CN"].discardChanges).toBe("不保存");
});
