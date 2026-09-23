import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Entry } from "../api/types";
import { createFileSelectionStore } from "../fileSelectionStore";
import { strings } from "../i18n";
import { FileRow } from "./FileRow";

const warning = '文件名包含违规字符：“\\ / : * ? " < > |”';

function renderRow(name: string, type: Entry["type"] = "file", cloud = true) {
  const entry: Entry = { name, relativePath: "123", type, size: 42, mode: "0644", modifiedUnix: 1, isSymlink: false };
  const onOpen = vi.fn();
  render(<table className="file-table"><tbody><FileRow
    entry={entry} provider={cloud ? "cloud115" : undefined} paneKey="left"
    rootId={cloud ? "@115" : "local"} parentPath="parent/with/slashes"
    selectionStore={createFileSelectionStore([entry])} dropFeedback={null}
    labels={strings["zh-CN"]} onOpen={onOpen} onSelect={vi.fn()} onToggleSelection={vi.fn()}
  /></tbody></table>);
  return { row: screen.getByRole("row"), onOpen, entry };
}

it.each([... '\\/:*?"<>|'].flatMap(character => [
  [character, "file"], [character, "directory"],
] as const))("warns for %s in a cloud %s name, without disabling opening", (character, type) => {
  const { row, onOpen, entry } = renderRow(`a${character}b`, type);
  expect(row).toHaveAttribute("data-name-warning", "true");
  expect(row).toHaveAttribute("title", warning);
  expect(screen.getByText(entry.name)).toHaveClass("file-entry-name");
  fireEvent.doubleClick(row);
  expect(onOpen).toHaveBeenCalledWith(entry);
});

it.each(["normal.txt", "中文（目录）", "a'b", "全角／名称"])("does not warn for %s or slashes in parent paths", name => {
  const { row } = renderRow(name);
  expect(row).not.toHaveAttribute("data-name-warning");
  expect(row).not.toHaveAttribute("title");
});

it("does not warn for local entries", () => {
  const { row } = renderRow('a\\:*?"<>|b', "file", false);
  expect(row).not.toHaveAttribute("data-name-warning");
  expect(row).not.toHaveAttribute("title");
});
