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

it("formats directory navigation destinations without keyboard shortcuts", () => {
  expect(strings.en.backToFolder("Pictures")).toBe('Back to "Pictures"');
  expect(strings.en.forwardToFolder("Pictures")).toBe('Forward to "Pictures"');
  expect(strings["zh-CN"].upToFolder("图片")).toBe("上移到“图片”");
  expect(strings["zh-CN"].backToFolder("图片")).not.toContain("Alt");
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

it("localizes SuperRename summaries, windows, and conflicts", () => {
  expect(strings.en.superRenameWindowTitle("Albums")).toBe("SuperRename — Albums");
  expect(strings["zh-CN"].superRenameWindowTitle("相册")).toBe("SuperRename — 相册");
  expect(strings.en.superRenameSummary(3, 12, 2, 1)).toContain("12 selected");
  expect(strings["zh-CN"].superRenameSummary(3, 12, 2, 1)).toContain("已选 12 项");
  expect(strings.en.superRenameConflict("target_occupied")).toBe("Target is occupied");
  expect(strings.en.superRenameGroupSubmit("Albums")).toBe("Rename Albums now");
  expect(strings["zh-CN"].superRenameGroupSubmit("相册")).toBe("立即重命名 相册");
  expect(strings["zh-CN"].operationType("super_rename")).toBe("SuperRename");
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
  expect(strings.en.editorSyntaxHighlight).toBe("Syntax highlighting");
  expect(strings["zh-CN"].editorSyntaxHighlight).toBe("语法高亮");
  expect(strings.en.editorSyntaxAuto("Go")).toBe("Auto (Go)");
  expect(strings["zh-CN"].editorSyntaxAuto("Go")).toBe("自动（Go）");
  expect(strings.en.editorSyntaxLoading("Python")).toBe("Loading Python…");
  expect(strings["zh-CN"].editorSyntaxLargeFile).toBe("纯文本（大文件）");
});

it("localizes link source actions, preview counts, and conflicts", () => {
  expect(strings.en.selectLinkSource).toBe("Select link source");
  expect(strings["zh-CN"].cancelLinkSource(3)).toBe("取消选定的连接（3 项）");
  expect(strings.en.linkCounts(2, 3, 1)).toBe("2 folders · 3 hard-linked files · 1 symbolic link");
  expect(strings["zh-CN"].linkCounts(2, 3, 1)).toBe("2 个文件夹 · 3 个硬链接文件 · 1 个符号链接");
  expect(strings.en.linkError("target_exists")).toBe("The destination already exists");
  expect(strings["zh-CN"].linkError("cross_filesystem")).toBe("硬链接必须位于同一文件系统");
  expect(strings.en.linkError("unknown")).toBe("");
});
