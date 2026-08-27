import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SuperRenameInventory } from "../api/types";
import { strings } from "../i18n";
import { SuperRenameManager, type SuperRenameClient } from "../superRenameManager";
import { SuperRenameContent } from "./SuperRenameContent";

describe("SuperRenameContent", () => {
  it("loads a preview, updates selection locally, and creates one job", async () => {
    const inventory = contentInventory();
    const createJob = vi.fn().mockResolvedValue({ id: "job_1" });
    const client: SuperRenameClient = {
      superRenamePreview: vi.fn().mockResolvedValue(inventory),
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
      superRenameCreateJob: vi.fn(),
    });
    render(
      <SuperRenameContent manager={manager} labels={strings.en} onClose={vi.fn()} onJobCreated={vi.fn()} />,
    );

    await screen.findByText("photo-2.jpg");
    expect(screen.getByRole("button", { name: "Rename 3 files" })).toBeDisabled();
    expect(screen.getByText("1 conflict must be resolved before continuing.")).toBeInTheDocument();
  });

  it("keeps the content close action available except while submitting", async () => {
    const manager = new SuperRenameManager("media", "albums", {
      superRenamePreview: vi.fn().mockResolvedValue(contentInventory()),
      superRenameCreateJob: vi.fn(),
    });
    const onClose = vi.fn();
    render(
      <SuperRenameContent manager={manager} labels={strings.en} onClose={onClose} onJobCreated={vi.fn()} />,
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
        directOccupiedPaths: ["albums/A/photo-1.jpg", "albums/A/photo-2.jpg", "albums/A/clip.mp4", "albums/A/notes.txt"],
        videoDirectory: { status: "missing", path: "albums/A/视频", occupiedPaths: [] },
        recoveryResidues: [],
      },
    ],
  };
}
