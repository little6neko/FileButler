import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { strings } from "../i18n";
import { PaneStatusBar } from "./PaneStatusBar";

it("shows selected count, selected bytes, and visible count", () => {
  render(<PaneStatusBar selectedCount={2} selectedBytes={1536} visibleCount={18} labels={strings.en} />);

  expect(screen.getByText("2 selected")).toBeInTheDocument();
  expect(screen.getByText("1.5 KB")).toBeInTheDocument();
  expect(screen.getByText("18 items")).toBeInTheDocument();
});
