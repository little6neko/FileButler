import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Copy } from "lucide-react";
import { FilePane } from "./FilePane";
import { createFileSelectionStore } from "../fileSelectionStore";
import type { Entry } from "../api/types";
import { strings } from "../i18n";

beforeEach(() => vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 767px)", addEventListener() {}, removeEventListener() {} })));
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const entries: Entry[] = ["a.txt", "b.txt"].map(name => ({ name, relativePath: name, type: "file", size: 10, modifiedUnix: 0, mode: "", isSymlink: false }));
  const selection = createFileSelectionStore(entries);
  const open = vi.fn(), run = vi.fn();
  render(<FilePane title="Files" roots={[]} selectedRootId="test" currentPath="." entries={entries} selectionStore={selection}
    onRootChange={vi.fn()} onPathChange={vi.fn()} onToggleSelection={selection.toggle} onSelectAll={selection.selectAll} onOpenFile={open}
    onRefresh={vi.fn()} onActivate={vi.fn()} onContextTarget={selection.selectContextTarget}
    actionsForSelection={() => [{ kind: "command", id: "clipboardCopy", icon: Copy, label: "Copy", disabled: selection.getSummary().selectedCount === 0, run: () => run([...selection.getSelected()]) }]} />);
  return { selection, open, run };
}
it("opens on a single tap, then toggles selection without opening in select mode", () => {
  const { open, selection } = setup();
  fireEvent.click(screen.getByText("a.txt"));
  expect(open).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: strings.en.mobileSelect }));
  fireEvent.click(screen.getByText("b.txt"));
  expect(open).toHaveBeenCalledTimes(1);
  expect([...selection.getSelected()]).toEqual(["b.txt"]);
});
it("runs row actions only on that item and restores the previous selection", async () => {
  const { selection, run } = setup();
  selection.replace(["b.txt"]);
  fireEvent.click(screen.getByRole("button", { name: "More: a.txt" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(run).toHaveBeenCalledWith(["a.txt"]);
  expect([...selection.getSelected()]).toEqual(["b.txt"]);
});
