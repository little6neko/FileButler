import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Job, SuperRenameInventory } from "../api/types";
import { strings } from "../i18n";
import { JobEventsStore } from "../jobEvents";
import { JobEventsContext } from "../jobEventsContext";
import { SuperRenameManager, type SuperRenameClient } from "../superRenameManager";
import { SuperRenameContent } from "./SuperRenameContent";

describe("SuperRenameContent", () => {
  it("loads a preview, updates selection locally, and creates one job", async () => {
    const inventory = contentInventory();
    const createJob = vi.fn().mockResolvedValue({ id: "job_1" });
    const client: SuperRenameClient = {
      superRenamePreview: vi.fn().mockResolvedValue(inventory),
      superRenameGroupPreview: vi.fn(),
      superRenameCreateJob: createJob,
    };
    const manager = new SuperRenameManager("media", "albums", client);
    const onJobCreated = vi.fn();
    render(
      <SuperRenameContent
        manager={manager}
        labels={strings.en}
        onClose={vi.fn()}
        onJobCreated={onJobCreated}
        onGroupJobCreated={vi.fn()}
      />,
    );

    expect(screen.getByTestId("super-rename-loading")).toBeInTheDocument();
    await screen.findByText("photo-2.jpg");
    expect(screen.getByText("1 folders · 3 selected · 1 unmatched · 0 conflicts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select photo-1.jpg for SuperRename" }));
    expect(screen.getByTestId("super-rename-item-albums/A/photo-2.jpg")).toHaveTextContent("albums/A/01.jpg");

    fireEvent.click(screen.getByRole("button", { name: "Rename 2 files" }));
    await waitFor(() => expect(onJobCreated).toHaveBeenCalledWith("job_1"));
    expect(createJob).toHaveBeenCalledWith({
      rootId: "media",
      directoryPath: "albums",
      selectedPaths: ["albums/A/photo-2.jpg", "albums/A/clip.mp4"],
    });
  });

  it("disables execution when the selected projection has a conflict", async () => {
    const inventory = contentInventory();
    inventory.groups[0].directOccupiedPaths.push("albums/A/01.jpg");
    inventory.groups[0].unmatched.push({
      path: "albums/A/01.jpg",
      name: "01.jpg",
      kind: "file",
      reason: "unsupported-extension",
    });
    const manager = new SuperRenameManager("media", "albums", {
      superRenamePreview: vi.fn().mockResolvedValue(inventory),
      superRenameGroupPreview: vi.fn(),
      superRenameCreateJob: vi.fn(),
    });
    render(
      <SuperRenameContent
        manager={manager}
        labels={strings.en}
        onClose={vi.fn()}
        onJobCreated={vi.fn()}
        onGroupJobCreated={vi.fn()}
      />,
    );

    await screen.findByText("photo-2.jpg");
    expect(screen.getByRole("button", { name: "Rename 3 files" })).toBeDisabled();
    expect(screen.getByText("1 conflict must be resolved before continuing.")).toBeInTheDocument();
  });

  it("creates a job for one folder, removes that folder, and keeps the content open", async () => {
    const inventory = contentInventory();
    const createJob = vi.fn().mockResolvedValue({ id: "job-a" });
    const manager = new SuperRenameManager("media", "albums", {
      superRenamePreview: vi.fn().mockResolvedValue(inventory),
      superRenameGroupPreview: vi.fn(),
      superRenameCreateJob: createJob,
    });
    const onJobCreated = vi.fn();
    const onGroupJobCreated = vi.fn();
    render(
      <SuperRenameContent
        manager={manager}
        labels={strings.en}
        onClose={vi.fn()}
        onJobCreated={onJobCreated}
        onGroupJobCreated={onGroupJobCreated}
      />,
    );

    await screen.findByText("photo-2.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Rename A now" }));

    await waitFor(() => expect(onGroupJobCreated).toHaveBeenCalledWith("job-a"));
    expect(onJobCreated).not.toHaveBeenCalled();
    expect(createJob).toHaveBeenCalledWith({
      rootId: "media",
      directoryPath: "albums",
      selectedPaths: ["albums/A/photo-1.jpg", "albums/A/photo-2.jpg", "albums/A/clip.mp4"],
    });
    expect(screen.getByText("No matching media")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("loads and selects a nested folder from its own checkbox", async () => {
    const inventory = contentInventory();
    inventory.groups[0].childDirectories = [{ path: "albums/A/chapter", name: "chapter" }];
    inventory.groups[0].directOccupiedPaths.push("albums/A/chapter");
    const nested = {
      ...contentInventory().groups[0],
      path: "albums/A/chapter",
      name: "chapter",
      images: [{ sourcePath: "albums/A/chapter/deep.jpg", name: "deep.jpg", extension: ".jpg", mediaKind: "image" as const }],
      videos: [],
      unmatched: [],
      childDirectories: [],
      directOccupiedPaths: ["albums/A/chapter/deep.jpg"],
      videoDirectory: { status: "missing" as const, path: "albums/A/chapter/视频", occupiedPaths: [] },
      recoveryResidues: [],
    };
    const groupPreview = vi.fn().mockResolvedValue(nested);
    const manager = new SuperRenameManager("media", "albums", {
      superRenamePreview: vi.fn().mockResolvedValue(inventory),
      superRenameGroupPreview: groupPreview,
      superRenameCreateJob: vi.fn(),
    });
    render(
      <SuperRenameContent
        manager={manager}
        labels={strings.en}
        onClose={vi.fn()}
        onJobCreated={vi.fn()}
        onGroupJobCreated={vi.fn()}
      />,
    );

    const nestedCheckbox = await screen.findByRole("checkbox", { name: "Select all matched media in chapter" });
    expect(nestedCheckbox).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rename chapter now" })).toBeDisabled();
    fireEvent.click(nestedCheckbox);

    await screen.findByText("deep.jpg");
    expect(screen.getByText("albums/A/chapter/01.jpg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename chapter now" })).toBeEnabled();
    expect(groupPreview).toHaveBeenCalledTimes(1);
  });

  it("restores a folder when its failure event arrives before the create response", async () => {
    const inventory = contentInventory();
    const submission = deferred<{ id: string }>();
    const preview = vi.fn().mockResolvedValue(inventory);
    const groupPreview = vi.fn().mockResolvedValue(inventory.groups[0]);
    const manager = new SuperRenameManager("media", "albums", {
      superRenamePreview: preview,
      superRenameGroupPreview: groupPreview,
      superRenameCreateJob: vi.fn().mockReturnValue(submission.promise),
    });
    const events = new JobEventsStore();
    events.handleSnapshot({ runtimeId: "runtime", cursor: 0, reset: false, jobs: [] });
    render(
      <JobEventsContext.Provider value={events}>
        <SuperRenameContent
          manager={manager}
          labels={strings.en}
          onClose={vi.fn()}
          onJobCreated={vi.fn()}
          onGroupJobCreated={(id) => events.registerCreatedJob(id)}
        />
      </JobEventsContext.Provider>,
    );

    await screen.findByText("photo-2.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Rename A now" }));
    act(() => {
      events.handleChanged({
        runtimeId: "runtime",
        cursor: 1,
        job: failedJob("job-fast-failure"),
      });
    });
    await act(async () => submission.resolve({ id: "job-fast-failure" }));

    await waitFor(() => expect(groupPreview).toHaveBeenCalledTimes(1));
    expect(preview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Rename A now" })).toBeInTheDocument();
  });

  it("keeps the content close action available except while submitting", async () => {
    const manager = new SuperRenameManager("media", "albums", {
      superRenamePreview: vi.fn().mockResolvedValue(contentInventory()),
      superRenameGroupPreview: vi.fn(),
      superRenameCreateJob: vi.fn(),
    });
    const onClose = vi.fn();
    render(
      <SuperRenameContent
        manager={manager}
        labels={strings.en}
        onClose={onClose}
        onJobCreated={vi.fn()}
        onGroupJobCreated={vi.fn()}
      />,
    );
    await screen.findByText("photo-2.jpg");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

function contentInventory(): SuperRenameInventory {
  return {
    rootId: "media",
    directoryPath: "albums",
    generatedAtUnix: 1,
    groups: [
      {
        path: "albums/A",
        name: "A",
        images: [
          { sourcePath: "albums/A/photo-1.jpg", name: "photo-1.jpg", extension: ".jpg", mediaKind: "image" },
          { sourcePath: "albums/A/photo-2.jpg", name: "photo-2.jpg", extension: ".jpg", mediaKind: "image" },
        ],
        videos: [
          { sourcePath: "albums/A/clip.mp4", name: "clip.mp4", extension: ".mp4", mediaKind: "video" },
        ],
        unmatched: [
          { path: "albums/A/notes.txt", name: "notes.txt", kind: "file", reason: "unsupported-extension" },
        ],
        childDirectories: [],
        directOccupiedPaths: ["albums/A/photo-1.jpg", "albums/A/photo-2.jpg", "albums/A/clip.mp4", "albums/A/notes.txt"],
        videoDirectory: { status: "missing", path: "albums/A/视频", occupiedPaths: [] },
        recoveryResidues: [],
      },
    ],
  };
}

function failedJob(id: string): Job {
  return {
    id,
    type: "super_rename",
    status: "failed",
    actorId: 1,
    sourceRootId: "media",
    progressTotal: 3,
    progressDone: 0,
    failedCount: 3,
    cancelRequested: false,
    errorMessage: "failed",
    createdAtUnix: 1,
    updatedAtUnix: 2,
    finishedAtUnix: 2,
    eventVersion: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
