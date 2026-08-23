import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { strings } from "../i18n";
import { WorkspaceShell } from "./WorkspaceShell";

it("renders running jobs before the mode switch with matching outlined styles", () => {
  render(
    <WorkspaceShell
      labels={strings.en}
      mode="desktop"
      windows={[]}
      activeWindowId={null}
      activeJobCount={0}
      jobsOpen={false}
      onModeChange={vi.fn()}
      onWindowActivate={vi.fn()}
      onJobsToggle={vi.fn()}
      languageControl={<span>Language selector</span>}
      version="dev"
    >
      <p>Workspace</p>
    </WorkspaceShell>,
  );

  const jobsButton = screen.getByRole("button", { name: "Jobs" });
  const modeButton = screen.getByRole("button", { name: "Switch to compact mode" });

  expect(jobsButton).toHaveAttribute("data-variant", "outline");
  expect(modeButton).toHaveAttribute("data-variant", "outline");
  expect(jobsButton.compareDocumentPosition(modeButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
