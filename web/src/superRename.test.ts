import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifySuperRenameMedia,
  projectSuperRenameInventory,
  projectSuperRenameCandidates,
  superRenamePadding,
  type SuperRenameCandidate,
  type SuperRenameMediaKind,
} from "./superRename";

type PlannerFixture = {
  classificationCases: Array<{
    name: string;
    kind: SuperRenameMediaKind | null;
    extension: string;
  }>;
  paddingCases: Array<{ count: number; padding: number }>;
  projectionCases: Array<{
    name: string;
    groupPath: string;
    kind: SuperRenameMediaKind;
    candidates: SuperRenameCandidate[];
    selectedPaths: string[];
    targets: Array<string | null>;
  }>;
  planCases: Array<{
    name: string;
    inventory: import("./superRename").SuperRenameInventory;
    selectedPaths: string[];
    items: Array<{
      sourcePath: string;
      targetPath: string;
      errorCode: import("./superRename").SuperRenameConflictCode | null;
    }>;
  }>;
};

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), "../testdata/superrename/planner.json"), "utf8"),
) as PlannerFixture;

describe("SuperRename shared planning rules", () => {
  it("classifies the shared media extension catalogue and preserves extension spelling", () => {
    for (const test of fixture.classificationCases) {
      expect(classifySuperRenameMedia(test.name), test.name).toEqual({
        kind: test.kind,
        extension: test.extension,
      });
    }
  });

  it("uses at least two padding digits and grows without an upper cap", () => {
    for (const test of fixture.paddingCases) {
      expect(superRenamePadding(test.count), String(test.count)).toBe(test.padding);
    }
  });

  it("projects images and videos from the same fixture as the Go planner", () => {
    for (const test of fixture.projectionCases) {
      const rows = projectSuperRenameCandidates(
        test.groupPath,
        test.kind,
        test.candidates,
        new Set(test.selectedPaths),
      );
      expect(rows.map((row) => (row.selected ? row.targetPath : null)), test.name).toEqual(test.targets);
    }
  });

  it("reprojects only the affected media partition", () => {
    const images = fixture.projectionCases[0];
    const videos = fixture.projectionCases[1];
    const selectedImages = new Set(images.selectedPaths);
    selectedImages.delete(images.selectedPaths[1]);

    const changedImages = projectSuperRenameCandidates(
      images.groupPath,
      images.kind,
      images.candidates,
      selectedImages,
    );
    const unchangedVideos = projectSuperRenameCandidates(
      videos.groupPath,
      videos.kind,
      videos.candidates,
      new Set(videos.selectedPaths),
    );

    expect(changedImages.map((row) => row.targetPath)).toEqual([
      "albums/写真 A/01.JPG",
      "",
      "albums/写真 A/02.webp",
    ]);
    expect(unchangedVideos.map((row) => (row.selected ? row.targetPath : null))).toEqual(videos.targets);
  });

  it("matches the Go planner for occupied targets and recovery blockers", () => {
    for (const test of fixture.planCases) {
      const projection = projectSuperRenameInventory(test.inventory, new Set(test.selectedPaths));
      const items = projection.groups.flatMap((group) => [...group.images, ...group.videos])
        .filter((item) => item.selected)
        .map((item) => ({
          sourcePath: item.sourcePath,
          targetPath: item.targetPath,
          errorCode: item.errorCode ?? null,
        }));

      expect(items, test.name).toEqual(test.items);
    }
  });
});
