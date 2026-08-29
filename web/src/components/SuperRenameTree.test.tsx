import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SuperRenameInventory } from "../api/types";
import { strings } from "../i18n";
import { defaultSuperRenameSelection, projectSuperRenameInventory } from "../superRename";
import type { SuperRenameDirectoryNode } from "../superRenameManager";
import { SuperRenameTree } from "./SuperRenameTree";

describe("SuperRenameTree", () => {
  it("renders the approved unified tree table with synthetic and unmatched rows", () => {
    const inventory = treeInventory();
    const projection = projectSuperRenameInventory(inventory, defaultSuperRenameSelection(inventory));
    render(
      <SuperRenameTree
        projection={projection}
        directoryNodes={treeDirectoryNodes()}
        rootGroupPaths={["albums/A"]}
        expandedGroups={new Set(["albums/A"])}
        labels={strings.en}
        onItemSelected={vi.fn()}
        onGroupSelected={vi.fn()}
        onGroupExpanded={vi.fn()}
        onGroupSubmit={vi.fn()}
      />,
    );

    const currentItemHeader = screen.getByRole("columnheader", { name: "Current item" });
    expect(currentItemHeader).toBeInTheDocument();
    expect(currentItemHeader.closest("thead")).toHaveClass("[&_th]:sticky", "[&_th]:top-0");
    expect(screen.getByRole("columnheader", { name: "Planned result" })).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("photo.jpg")).toBeInTheDocument();
    expect(screen.getByText("Video folder will be created")).toBeInTheDocument();
    expect(screen.getByText("Not loaded · not selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select all matched media in nested" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rename nested now" })).toBeDisabled();
    expect(screen.getByText("albums/A/视频/V01.mp4")).toBeInTheDocument();
    const action = screen.getByRole("button", { name: "Rename A now" });
    expect(action).toBeEnabled();
    expect(action.closest("td")).toHaveClass("sticky", "right-0");
  });

  it("reports item, group, and expansion changes without changing data itself", () => {
    const inventory = treeInventory();
    const selected = defaultSuperRenameSelection(inventory);
    selected.delete("albums/A/clip.mp4");
    const projection = projectSuperRenameInventory(inventory, selected);
    const onItemSelected = vi.fn();
    const onGroupSelected = vi.fn();
    const onGroupExpanded = vi.fn();
    const onGroupSubmit = vi.fn();
    render(
      <SuperRenameTree
        projection={projection}
        directoryNodes={treeDirectoryNodes()}
        rootGroupPaths={["albums/A"]}
        expandedGroups={new Set(["albums/A"])}
        labels={strings.en}
        onItemSelected={onItemSelected}
        onGroupSelected={onGroupSelected}
        onGroupExpanded={onGroupExpanded}
        onGroupSubmit={onGroupSubmit}
      />,
    );

    const groupRow = screen.getByTestId("super-rename-group-albums/A");
    expect(within(groupRow).getByRole("checkbox", { name: "Select all matched media in A" })).toHaveAttribute("aria-checked", "mixed");
    const canceledRow = screen.getByTestId("super-rename-item-albums/A/clip.mp4");
    expect(canceledRow).not.toHaveClass("opacity-70");
    expect(within(canceledRow).getByRole("checkbox", { name: "Select clip.mp4 for SuperRename" })).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select photo.jpg for SuperRename" }));
    expect(onItemSelected).toHaveBeenCalledWith("albums/A/photo.jpg", false);
    fireEvent.click(within(groupRow).getByRole("checkbox", { name: "Select all matched media in A" }));
    expect(onGroupSelected).toHaveBeenCalledWith("albums/A", true);
    fireEvent.click(screen.getByRole("button", { name: "Collapse A" }));
    expect(onGroupExpanded).toHaveBeenCalledWith("albums/A", false);
    fireEvent.click(screen.getByRole("button", { name: "Rename A now" }));
    expect(onGroupSubmit).toHaveBeenCalledWith("albums/A");
  });

  it("always renders the sticky group action even when nothing is selected", () => {
    const inventory = treeInventory();
    const projection = projectSuperRenameInventory(inventory, new Set());
    render(
      <SuperRenameTree
        projection={projection}
        directoryNodes={treeDirectoryNodes()}
        rootGroupPaths={["albums/A"]}
        expandedGroups={new Set()}
        labels={strings.en}
        onItemSelected={vi.fn()}
        onGroupSelected={vi.fn()}
        onGroupExpanded={vi.fn()}
        onGroupSubmit={vi.fn()}
      />,
    );

    const action = screen.getByRole("button", { name: "Rename A now" });
    expect(action).toBeDisabled();
    expect(action.closest("td")).toHaveClass("sticky", "right-0");
    expect(screen.getByRole("columnheader", { name: "Folder action" })).toHaveClass("right-0", "text-left");
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
        directoryNodes={treeDirectoryNodes()}
        rootGroupPaths={["albums/A"]}
        expandedGroups={new Set(["albums/A"])}
        labels={strings.en}
        onItemSelected={vi.fn()}
        onGroupSelected={vi.fn()}
        onGroupExpanded={vi.fn()}
        onGroupSubmit={vi.fn()}
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
          { path: "albums/A/notes.txt", name: "notes.txt", kind: "file", reason: "unsupported-extension" },
        ],
        childDirectories: [{ path: "albums/A/nested", name: "nested" }],
        directOccupiedPaths: ["albums/A/photo.jpg", "albums/A/clip.mp4", "albums/A/nested", "albums/A/notes.txt"],
        videoDirectory: { status: "missing", path: "albums/A/视频", occupiedPaths: [] },
        recoveryResidues: [],
      },
    ],
  };
}

function treeDirectoryNodes(): Record<string, SuperRenameDirectoryNode> {
  return {
    "albums/A": {
      path: "albums/A",
      name: "A",
      parentPath: null,
      depth: 0,
      loadState: "loaded",
      childPaths: ["albums/A/nested"],
      selectionIntent: "all",
      ownLayerCompleted: false,
      hidden: false,
      error: null,
    },
    "albums/A/nested": {
      path: "albums/A/nested",
      name: "nested",
      parentPath: "albums/A",
      depth: 1,
      loadState: "unloaded",
      childPaths: [],
      selectionIntent: "none",
      ownLayerCompleted: false,
      hidden: false,
      error: null,
    },
  };
}
