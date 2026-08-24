import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

it("renders and activates a text editor taskbar window with its unsaved title", async () => {
  const onWindowActivate = vi.fn();
  render(
    <WorkspaceShell
      labels={strings.en}
      mode="desktop"
      windows={[
        { id: "window-file", kind: "file", title: "Files", status: "normal" },
        { id: "window-text", kind: "textEditor", title: "main.go *", status: "normal" },
        { id: "window-minimized", kind: "textEditor", title: "notes.txt", status: "minimized" },
      ]}
      activeWindowId="window-text"
      activeJobCount={0}
      jobsOpen={false}
      onModeChange={vi.fn()}
      onWindowActivate={onWindowActivate}
      onJobsToggle={vi.fn()}
      languageControl={<span>Language selector</span>}
      version="dev"
    >
      <p>Workspace</p>
    </WorkspaceShell>,
  );

  const active = screen.getByRole("button", { name: "main.go *" });
  expect(active).toHaveAttribute("aria-current", "page");
  expect(active).toHaveAttribute("data-window-kind", "textEditor");
  expect(active.querySelector("svg")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "notes.txt" })).toHaveAttribute("aria-expanded", "false");

  await userEvent.click(screen.getByRole("button", { name: "notes.txt" }));
  expect(onWindowActivate).toHaveBeenCalledWith("window-minimized");
});
