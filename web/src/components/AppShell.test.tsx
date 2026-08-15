import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { strings } from "../i18n";
import { AppShell } from "./AppShell";

it("renders a desktop rail and opens jobs from either entry", async () => {
  const onJobsOpen = vi.fn();
  render(
    <AppShell
      labels={strings.en}
      activeJobCount={2}
      onJobsOpen={onJobsOpen}
      languageControl={<span>language</span>}
      version="v1.2.3-beta.1"
    >
      <p>workspace</p>
    </AppShell>,
  );

  expect(screen.getByRole("navigation", { name: "Workspace navigation" })).toBeInTheDocument();
  expect(screen.getByText("workspace")).toBeInTheDocument();
  expect(screen.getByText("2 active jobs")).toBeInTheDocument();
  const version = screen.getByText("v1.2.3-beta.1");
  expect(version).toHaveAttribute("title", "FileButler v1.2.3-beta.1");
  expect(version).toHaveClass("truncate");
  await userEvent.click(screen.getByRole("button", { name: "Jobs" }));
  expect(onJobsOpen).toHaveBeenCalled();
});
