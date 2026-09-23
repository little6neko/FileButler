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
  it("uses shared window controls and the X only hides progress", () => {
    const store = setup();
    const close = screen.getByRole("button", { name: strings["zh-CN"].closeWindow });
    expect(close.parentElement).toHaveClass("desktop-window-controls");
    expect(close).toHaveAttribute("title", strings["zh-CN"].closeWindow);
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.cancelJob).not.toHaveBeenCalled();
    expect(store.getSnapshot().jobs[0].status).toBe("running");
    act(() => store.openProgress("a"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("shows independent windows, raises the focused one and closes only that window", () => {
    const store = setup();
    act(() => {
      store.handleChanged({ runtimeId: "r", cursor: 2, job: { ...job, id: "b", eventVersion: 2 } });
      store.registerCreatedJob("b", { x: 250, y: 250 });
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

  it("centers on the recorded destination once, without moving on progress updates", () => {
    const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, width: 400, height: 260, top: 0, left: 0, right: 400, bottom: 260, toJSON() {} });
    try {
      const store = new JobEventsStore();
      store.handleSnapshot({ runtimeId: "r", cursor: 1, reset: false, jobs: [job] });
      store.registerCreatedJob("a", { x: 600, y: 400 });
      render(<TransferProgressWindows store={store} labels={strings["zh-CN"]} />);
      expect(screen.getByRole("dialog")).toHaveStyle({ left: "400px", top: "270px" });
      act(() => store.handleChanged({ runtimeId: "r", cursor: 2, job: { ...job, eventVersion: 2, progressDone: 1 } }));
      expect(screen.getByRole("dialog")).toHaveStyle({ left: "400px", top: "270px" });
    } finally { bounds.mockRestore(); }
  });

  it("centers every later task at the same destination and raises the newest window", () => {
    const store = setup();
    fireEvent.pointerDown(screen.getByRole("dialog"));
    for (const [index, id] of ["b", "c", "d"].entries()) {
      act(() => {
        store.handleChanged({ runtimeId: "r", cursor: index + 2, job: { ...job, id, eventVersion: index + 2 } });
        store.registerCreatedJob(id, { x: 500, y: 350 });
      });
      const newest = document.querySelector<HTMLElement>(`[data-progress-job="${id}"]`)!;
      expect(newest.style.left).toBe("500px"); // jsdom has zero measured dimensions.
      expect(newest.style.top).toBe("350px");
      for (const other of screen.getAllByRole("dialog")) {
        if (other !== newest) expect(Number(newest.style.zIndex)).toBeGreaterThan(Number(other.style.zIndex));
      }
    }
  });
});
