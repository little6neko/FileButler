import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JobEventsStore } from "../jobEvents";
import type { Job } from "../api/types";
import { strings } from "../i18n";
import { TransferProgressWindows } from "./TransferProgress";
import { api } from "../api/client";

vi.mock("../api/client", () => ({ api: { cancelJob: vi.fn().mockResolvedValue({}) } }));
const job: Job = { id: "a", type: "copy", status: "running", actorId: 1, sourceRootId: "local", progressDone: 0, progressTotal: 1, failedCount: 0, cancelRequested: false, errorMessage: "", createdAtUnix: 1, updatedAtUnix: 1, eventVersion: 1, transfer: { phase: "copy", file: "a.txt", bytesDone: 100, bytesTotal: 1000, bytesPerSecond: 100, remainingSeconds: 9, cancelable: true } };

function setup() {
  const store = new JobEventsStore();
  store.handleSnapshot({ runtimeId: "r", cursor: 1, reset: false, jobs: [job] });
  store.registerCreatedJob("a");
  render(<TransferProgressWindows store={store} labels={strings["zh-CN"]} />);
  return store;
}

describe("transfer windows", () => {
  it("shows independent windows, raises the focused one and closes only that window", () => {
    const store = setup();
    act(() => {
      store.handleChanged({ runtimeId: "r", cursor: 2, job: { ...job, id: "b", eventVersion: 2 } });
      store.registerCreatedJob("b");
    });
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(2);
    const remainingId = dialogs[1].getAttribute("data-progress-job");
    expect(dialogs[0].style.left).not.toBe(dialogs[1].style.left);
    fireEvent.pointerDown(dialogs[0]);
    expect(Number(dialogs[0].style.zIndex)).toBeGreaterThan(Number(dialogs[1].style.zIndex));
    fireEvent.click(within(dialogs[0]).getByRole("button", { name: "后台运行" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog")).toHaveAttribute("data-progress-job", remainingId);
  });
  it("hides without canceling, can reopen, then auto closes on success", () => {
    const store = setup();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "false");
    fireEvent.click(screen.getByRole("button", { name: "后台运行" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.cancelJob).not.toHaveBeenCalled();
    act(() => store.openProgress("a"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => store.handleChanged({ runtimeId: "r", cursor: 2, job: { ...job, eventVersion: 2, status: "completed" } }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("retains failure details", () => {
    const store = setup();
    act(() => store.handleChanged({ runtimeId: "r", cursor: 2, job: { ...job, eventVersion: 2, status: "failed", errorMessage: "disk full" } }));
    expect(screen.getByRole("alert")).toHaveTextContent("disk full");
  });
});
