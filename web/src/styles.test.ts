// @ts-nocheck
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync("src/styles.css", "utf8");

it("keeps workspace scrolling inside each file pane", () => {
  expect(rule(".app-shell")).toContain("height: 100vh;");
  expect(rule(".app-shell")).toContain("overflow: hidden;");
  expect(rule(".workspace")).toContain("overflow: hidden;");
  expect(rule(".file-pane")).toContain("overflow: hidden;");
  expect(rule(".file-list")).toContain("overflow: auto;");
});

it("keeps file table headers fixed while pane contents scroll", () => {
  expect(rule(".file-table thead th")).toContain("position: sticky;");
  expect(rule(".file-table thead th")).toContain("top: 0;");
  expect(rule(".file-table thead th")).toContain("z-index: 3;");
  expect(rule(".file-table thead th")).toContain("background: #ffffff;");
});

it("draws the active pane border above sticky file headers", () => {
  expect(rule(".file-pane")).toContain("position: relative;");
  expect(rule(".file-pane.is-active::after")).toContain('content: "";');
  expect(rule(".file-pane.is-active::after")).toContain("position: absolute;");
  expect(rule(".file-pane.is-active::after")).toContain("inset: 0;");
  expect(rule(".file-pane.is-active::after")).toContain("z-index: 4;");
  expect(rule(".file-pane.is-active::after")).toContain("pointer-events: none;");
  expect(rule(".file-pane.is-active::after")).toContain("border: 2px solid #2b72c4;");
});

it("keeps overlays above the active pane border", () => {
  expect(rule(".jobs-panel")).toContain("z-index: 6;");
  expect(rule(".modal-backdrop")).toContain("z-index: 10;");
});

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}
