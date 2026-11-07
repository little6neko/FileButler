import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PowerRenameContent } from "./RenameDialog";
import { defaultRenameOptions } from "./powerRenameOptions";
import { strings } from "../i18n";
import { JobEventsStore } from "../jobEvents";
import { TransferProgressWindows } from "./TransferProgress";
import { JobsSheet } from "./JobsSheet";
import { api } from "../api/client";
import type { Job, RenameOptions } from "../api/types";

vi.mock("../api/client", () => ({ api: { cancelJob: vi.fn().mockResolvedValue({}) } }));
beforeEach(() => vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 767px)", addEventListener() {}, removeEventListener() {} })));
afterEach(() => vi.unstubAllGlobals());

it("keeps rules across mobile tabs and disables submission while the new preview is pending", async () => {
  const preview = vi.fn().mockResolvedValue({ items: [], hasConflict: false });
  const paths = ["a.jpg"];
  function Harness() {
    const [options, setOptions] = useState<RenameOptions>({ ...defaultRenameOptions });
    return <PowerRenameContent preview={preview} rootId="local" paths={paths} options={options} submitting={false} submitError={null} onOptionsChange={setOptions} onSubmit={vi.fn()} onClose={vi.fn()} labels={strings.en} />;
  }
  render(<Harness />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Rename 1 item" })).toBeEnabled());
  preview.mockImplementation(() => new Promise(() => {}));
  fireEvent.change(screen.getByLabelText("Search"), { target: { value: "draft" } });
  expect(screen.getByRole("button", { name: "Rename 1 item" })).toBeDisabled();
  fireEvent.click(screen.getByRole("tab", { name: "Live preview" }));
  expect(screen.getByTestId("rename-options-column")).toHaveAttribute("hidden");
  fireEvent.click(screen.getByRole("tab", { name: "Rules" }));
  expect(screen.getByLabelText("Search")).toHaveValue("draft");
  expect(screen.getByRole("button", { name: "Rename 1 item" })).toBeDisabled();
});

it("centralizes mobile progress without canceling when hiding details or completing", async () => {
  const job: Job = { id: "mobile", type: "copy", status: "running", actorId: 1, sourceRootId: "local", progressDone: 0, progressTotal: 1, failedCount: 0, cancelRequested: false, errorMessage: "", createdAtUnix: 1, updatedAtUnix: 1, eventVersion: 1, transfer: { phase: "copy", file: "a.txt", bytesDone: 100, bytesTotal: 1000, bytesPerSecond: 100, cancelable: true } };
  const store = new JobEventsStore();
  store.handleSnapshot({ runtimeId: "mobile", cursor: 1, reset: false, jobs: [job] });
  store.openProgress(job.id);
  const onOpenChange = vi.fn();
  const view = render(<><TransferProgressWindows store={store} labels={strings.en} /><JobsSheet open onOpenChange={onOpenChange} eventsStore={store} labels={strings.en} /></>);
  expect(view.container.querySelector("[data-progress-job]")).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "View progress" }));
  fireEvent.click(screen.getByRole("button", { name: "Run in background" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(api.cancelJob).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "View progress" }));
  act(() => store.handleChanged({ runtimeId: "mobile", cursor: 2, job: { ...job, status: "completed", eventVersion: 2 } }));
  expect(screen.queryByRole("button", { name: "Run in background" })).not.toBeInTheDocument();
  expect(api.cancelJob).not.toHaveBeenCalled();
});
