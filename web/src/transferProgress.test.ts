import { describe, expect, it } from "vitest";
import type { Job } from "./api/types";
import { jobFileProgress } from "./transferProgress";

const job: Job = { id: "a", type: "copy", status: "running", actorId: 1, sourceRootId: "local", progressDone: 0, progressTotal: 1, failedCount: 0, cancelRequested: false, errorMessage: "", createdAtUnix: 1, updatedAtUnix: 1, eventVersion: 1, transfer: { phase: "copy", file: "a.txt", bytesDone: 0, bytesTotal: 80, bytesPerSecond: 0, cancelable: true, filesDone: 0, filesTotal: 8 } };

describe("current file count", () => {
  it.each(["copy", "move", "upload", "download"])("shows a one-based ordinal only when requested for %s", (type) => {
    const current = { ...job, type };
    expect(jobFileProgress(current, "current")).toEqual({ count: "1/8", percent: 0 });
    expect(jobFileProgress(current)).toEqual({ count: "0/8", percent: 0 });
    expect(jobFileProgress({ ...current, transfer: { ...job.transfer!, filesDone: 1 } }, "current")).toEqual({ count: "2/8", percent: 12.5 });
  });
  it("caps the ordinal at the total without advancing percentage", () => {
    expect(jobFileProgress({ ...job, transfer: { ...job.transfer!, filesDone: 7 } }, "current")).toEqual({ count: "8/8", percent: 87.5 });
    expect(jobFileProgress({ ...job, transfer: { ...job.transfer!, filesDone: 8 } }, "current")).toEqual({ count: "8/8", percent: 99.9 });
  });
  it.each(["queued", "failed", "canceled", "completed"])("does not add a current file for %s jobs", (status) => {
    const current = { ...job, status, transfer: { ...job.transfer!, filesDone: 1 } };
    expect(jobFileProgress(current, "current")).toEqual(jobFileProgress(current));
  });
  it("keeps the active ordinal while cancellation is requested", () => {
    expect(jobFileProgress({ ...job, status: "cancel_requested" }, "current").count).toBe("1/8");
  });
  it("preserves unknown totals and empty batches", () => {
    expect(jobFileProgress({ ...job, transfer: undefined }, "current")).toEqual({ count: "-/-", percent: null });
    expect(jobFileProgress({ ...job, transfer: { ...job.transfer!, filesTotal: 0 } }, "current")).toEqual({ count: "0/0", percent: 0 });
  });
  it.each([
    { type: "move", sourceRootId: "@115", destRootId: "@115" },
    { type: "extract", sourceRootId: "local" },
  ])("uses top-level counts for $type in $sourceRootId", (overrides) => {
    expect(jobFileProgress({ ...job, ...overrides, progressDone: 1, progressTotal: 8 }, "current")).toEqual({ count: "2/8", percent: 12.5 });
  });
});
