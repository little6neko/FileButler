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

it("centers selection checkboxes in file rows", () => {
  expect(rule('.file-table td.select-cell [data-slot="checkbox"]')).toContain("margin: 0 auto;");
});

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}
