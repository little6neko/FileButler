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
});

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}
