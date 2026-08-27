import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SuperRenameInventory } from "../api/types";
import { strings } from "../i18n";
import { defaultSuperRenameSelection, projectSuperRenameInventory } from "../superRename";
import { SuperRenameTree } from "./SuperRenameTree";

describe("SuperRenameTree", () => {
  it("renders the approved unified tree table with synthetic and unmatched rows", () => {
    const inventory = treeInventory();
    const projection = projectSuperRenameInventory(inventory, defaultSuperRenameSelection(inventory));
    render(
      <SuperRenameTree
        projection={projection}
        expandedGroups={new Set(["albums/A"])}
        labels={strings.en}
        onItemSelected={vi.fn()}
        onGroupSelected={vi.fn()}
        onGroupExpanded={vi.fn()}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Current item" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Planned result" })).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("photo.jpg")).toBeInTheDocument();
    expect(screen.getByText("Video folder will be created")).toBeInTheDocument();
    expect(screen.getByText("Not scanned recursively")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select nested for SuperRename" })).toBeDisabled();
    expect(screen.getByText("albums/A/视频/V01.mp4")).toBeInTheDocument();
  });

  it("reports item, group, and expansion changes without changing data itself", () => {
    const inventory = treeInventory();
    const selected = defaultSuperRenameSelection(inventory);
    selected.delete("albums/A/clip.mp4");
    const projection = projectSuperRenameInventory(inventory, selected);
    const onItemSelected = vi.fn();
    const onGroupSelected = vi.fn();
    const onGroupExpanded = vi.fn();
    render(
      <SuperRenameTree
        projection={projection}
        expandedGroups={new Set(["albums/A"])}
        labels={strings.en}
        onItemSelected={onItemSelected}
        onGroupSelected={onGroupSelected}
        onGroupExpanded={onGroupExpanded}
      />,
    );

    const groupRow = screen.getByTestId("super-rename-group-albums/A");
    expect(within(groupRow).getByRole("checkbox", { name: "Select all matched media in A" })).toHaveAttribute("aria-checked", "mixed");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select photo.jpg for SuperRename" }));
    expect(onItemSelected).toHaveBeenCalledWith("albums/A/photo.jpg", false);
    fireEvent.click(within(groupRow).getByRole("checkbox", { name: "Select all matched media in A" }));
    expect(onGroupSelected).toHaveBeenCalledWith("albums/A", true);
    fireEvent.click(screen.getByRole("button", { name: "Collapse A" }));
    expect(onGroupExpanded).toHaveBeenCalledWith("albums/A", false);
  });

  it("marks a recovery residue in red with an explicit recovery status", () => {
    const inventory = treeInventory();
    inventory.groups[0].unmatched.push({
      path: "albums/A/.filebutler-superrename-job-old",
      name: ".filebutler-superrename-job-old",
      kind: "directory",
      reason: "nested-directory",
    });
    inventory.groups[0].recoveryResidues.push("albums/A/.filebutler-superrename-job-old");
    const projection = projectSuperRenameInventory(inventory, defaultSuperRenameSelection(inventory));
    render(
      <SuperRenameTree
        projection={projection}
        expandedGroups={new Set(["albums/A"])}
        labels={strings.en}
        onItemSelected={vi.fn()}
        onGroupSelected={vi.fn()}
        onGroupExpanded={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Manual recovery required").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("super-rename-item-albums/A/photo.jpg")).toHaveTextContent("Manual recovery required");
  });
});

function treeInventory(): SuperRenameInventory {
  return {
    rootId: "media",
    directoryPath: "albums",
    generatedAtUnix: 1,
    groups: [
      {
        path: "albums/A",
        name: "A",
        images: [{ sourcePath: "albums/A/photo.jpg", name: "photo.jpg", extension: ".jpg", mediaKind: "image" }],
        videos: [{ sourcePath: "albums/A/clip.mp4", name: "clip.mp4", extension: ".mp4", mediaKind: "video" }],
        unmatched: [
          { path: "albums/A/nested", name: "nested", kind: "directory", reason: "nested-directory" },
          { path: "albums/A/notes.txt", name: "notes.txt", kind: "file", reason: "unsupported-extension" },
        ],
        directOccupiedPaths: ["albums/A/photo.jpg", "albums/A/clip.mp4", "albums/A/nested", "albums/A/notes.txt"],
        videoDirectory: { status: "missing", path: "albums/A/视频", occupiedPaths: [] },
        recoveryResidues: [],
      },
    ],
  };
}
