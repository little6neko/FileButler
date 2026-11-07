import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceShell } from "./WorkspaceShell";
import { WindowFrame } from "./WindowFrame";
import { strings } from "../i18n";
import type { DesktopWindowRecord } from "../windowManager";

afterEach(() => vi.unstubAllGlobals());

function viewport() {
  let narrow = false;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() { return query === "(max-width: 767px)" && narrow; },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
  return (value: boolean) => act(() => { narrow = value; [...listeners].forEach(listener => listener()); });
}

it("preserves a window's content and desktop geometry across viewport and focus changes", () => {
  const resize = viewport();
  const rect = { x: 100, y: 60, width: 800, height: 500 };
  const window: DesktopWindowRecord = { id: "editor", kind: "textEditor", instanceId: "text", status: "normal", statusBeforeMinimize: null, rect, restoreRect: rect, zOrder: 1, focusOrder: 1 };
  const onRectChange = vi.fn();
  const props = { window, bounds: { width: 1200, height: 800 }, title: "draft.txt", labels: strings.en, onRectChange, onFocus: vi.fn(), onMinimize: vi.fn(), onToggleMaximize: vi.fn(), onClose: vi.fn() };
  const view = render(<WindowFrame {...props} active><textarea aria-label="Draft" defaultValue="original" /></WindowFrame>);
  const editor = screen.getByRole("textbox", { name: "Draft" });
  fireEvent.change(editor, { target: { value: "unsaved draft" } });
  resize(true);
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(editor);
  expect(editor).toHaveValue("unsaved draft");
  expect(screen.queryByRole("button", { name: strings.en.maximizeWindow })).not.toBeInTheDocument();
  view.rerender(<WindowFrame {...props} active={false}><textarea aria-label="Draft" defaultValue="original" /></WindowFrame>);
  expect(screen.queryByRole("textbox", { name: "Draft" })).not.toBeInTheDocument();
  resize(false);
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(editor);
  expect(editor).toHaveValue("unsaved draft");
  expect(onRectChange).not.toHaveBeenCalled();
});

it("switches mobile windows without changing saved desktop mode or remounting workspace content", () => {
  const resize = viewport();
  const activate = vi.fn(), changeMode = vi.fn();
  render(<WorkspaceShell labels={strings.en} mode="desktop" windows={[{ id: "cloud", kind: "cloud115", title: "115", status: "normal" }]} activeWindowId={null} activeJobCount={2} jobsOpen={false} onModeChange={changeMode} onWindowActivate={activate} onJobsToggle={vi.fn()} languageControl={<span>Language</span>}><input aria-label="Retained" defaultValue="draft" /></WorkspaceShell>);
  const input = screen.getByRole("textbox");
  resize(true);
  const nav = screen.getByRole("navigation", { name: strings.en.workspaceNavigation });
  fireEvent.click(within(nav).getByRole("button", { name: strings.en.mobileWindows }));
  fireEvent.click(screen.getByRole("button", { name: "115" }));
  expect(activate).toHaveBeenCalledWith("cloud");
  expect(changeMode).not.toHaveBeenCalled();
  resize(false);
  expect(screen.getByRole("textbox")).toBe(input);
});
