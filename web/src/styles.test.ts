import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync("src/styles.css", "utf8");

it("loads Tailwind and shadcn theme variables", () => {
  expect(css).toContain('@import "tailwindcss";');
  expect(css).toContain("--radius: 0.5rem;");
  expect(css).toContain("--background:");
  expect(css).toContain("--primary:");
});

it("keeps the application desktop-only and pane scrolling internal", () => {
  expect(css).toContain("min-width: 1024px;");
  expect(rule(".workspace")).toContain("overflow: hidden;");
  expect(rule(".file-pane")).toContain("overflow: hidden;");
  expect(rule(".file-list")).toContain("overflow: auto;");
});

it("keeps the jobs sheet below the shared system taskbar height", () => {
  expect(rule(":root")).toContain("--system-taskbar-height: 44px;");
  expect(rule(".workspace-shell")).toContain("grid-template-rows: var(--system-taskbar-height) minmax(0, 1fr);");
  expect(rule('.jobs-sheet-content[data-side="right"]')).toContain("top: var(--system-taskbar-height);");
  expect(rule('.jobs-sheet-content[data-side="right"]')).toContain("height: calc(100dvh - var(--system-taskbar-height));");
});

it("uses one soft-blue capsule for the current taskbar window", () => {
  const current = rule('.taskbar-window-button[aria-current="page"]');
  expect(current).toContain("border-color: #bfd8f5;");
  expect(current).toContain("background: #eaf3ff;");
  expect(current).toContain("color: #183b66;");
  expect(current).toContain("box-shadow: 0 1px 3px");
  expect(current).not.toContain("inset 0 -2px");
  expect(rule('.taskbar-window-button[aria-current="page"]:hover')).toContain("background: #e1efff;");
});

it("overlays the job cancel button with file-row-like interaction feedback", () => {
  expect(rule(".job-row-shell")).toContain("position: relative;");
  expect(rule(".job-row-main")).toContain("padding: 0.75rem;");
  expect(rule(".job-row-main")).not.toContain("3.25rem");
  expect(rule(".job-row-main--cancelable")).toContain("padding-right: 3.25rem;");
  expect(rule(".job-row-cancel")).toContain("position: absolute;");
  expect(rule(".job-row-cancel")).toContain("right: 0.625rem;");
  expect(rule(".job-row-cancel:hover:not(:disabled)")).toContain("background: var(--muted);");
  expect(rule(".job-row-cancel:active:not(:disabled)")).toContain("background:");
  expect(rule(".job-row-cancel:focus-visible")).toContain("outline: 2px solid var(--ring);");
});

it("keeps compact sticky file headers and an active-pane ring", () => {
  expect(rule(".file-table thead th")).toContain("position: sticky;");
  expect(rule(".file-table thead th")).toContain("height: 29px;");
  expect(rule('.file-pane[data-active="true"]')).toContain("box-shadow:");
});

it("keeps the breadcrumb row compact with matching pane dividers", () => {
  expect(rule(".file-pane")).toContain("grid-template-rows: 39px 29px minmax(0, 1fr) 28px;");
  expect(rule(".pane-header")).toContain("border-bottom: 1px solid var(--border);");
  expect(rule(".path-segments")).toContain("height: 29px;");
  expect(rule(".path-segments")).toContain("border-bottom: 1px solid var(--border);");
  expect(rule(".path-segments")).not.toContain("min-height: 32px;");
});

it("keeps breadcrumb separators passive and folder controls clickable", () => {
  expect(rule(".path-separator")).toContain("pointer-events: none;");
  expect(rule(".path-separator")).toContain("cursor: default;");
  expect(rule(".path-segment-button")).toContain("cursor: pointer;");
  expect(rule('.path-segments [data-slot="menu-trigger"]')).toContain("cursor: pointer;");
});

it("takes measurement labels out of layout and pointer interaction", () => {
  expect(rule(".path-segments-measure")).toContain("position: absolute;");
  expect(rule(".path-segments-measure")).toContain("visibility: hidden;");
  expect(rule(".path-segments-measure")).toContain("pointer-events: none;");
  expect(rule(".path-segments-measure")).toContain("white-space: nowrap;");
});

it("keeps deep hidden-folder menus within the available viewport", () => {
  expect(rule('[data-slot="menu-popup"]')).toContain("max-height: min(320px, var(--available-height));");
  expect(rule('[data-slot="menu-popup"]')).toContain("overflow-y: auto;");
});

it("centers selection checkboxes in file rows", () => {
  expect(rule('.file-table td.select-cell [data-slot="checkbox"]')).toContain("margin: 0 auto;");
  expect(rule('.file-table td.select-cell > input[aria-hidden="true"]')).toContain("display: none;");
});

it("keeps file drag cursors idle until dnd-kit activates a drag", () => {
  expect(rule(".file-drag-handle")).toContain("cursor: default;");
  expect(rule(".file-drag-handle")).toContain("outline: none;");
  expect(css).not.toContain("cursor: grab;");
  expect(css).not.toContain(".file-table tbody tr.directory-row,\n.file-table tbody tr.directory-row *");
  expect(rule('.workspace[data-file-drag-active="true"]')).toContain("cursor: grabbing;");
  expect(css).toContain('[data-drop-state="invalid"]');
  expect(css).toContain("cursor: not-allowed;");
});

it("draws pane and row drop feedback above sticky headers without intercepting input", () => {
  expect(rule(".file-list-frame")).toContain("position: relative;");
  expect(rule(".file-list-drop-feedback")).toContain("position: absolute;");
  expect(rule(".file-list-drop-feedback")).toContain("z-index: 6;");
  expect(rule(".file-list-drop-feedback")).toContain("pointer-events: none;");
  expect(rule('.file-table tbody tr[data-drop-state] > td::after')).toContain("z-index: 5;");
  expect(rule('.file-table tbody tr[data-drop-state] > td::after')).toContain("pointer-events: none;");
  expect(rule(".file-table thead th")).toContain("z-index: 3;");
});

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}
