import { mediaKindForPath } from "./media";
import type {
  SuperRenameCandidate,
  SuperRenameInventory,
  SuperRenameMediaKind,
  SuperRenameUnmatched,
  SuperRenameVideoDirectory,
} from "./api/types";

export type {
  SuperRenameCandidate,
  SuperRenameEntryKind,
  SuperRenameInventory,
  SuperRenameInventoryGroup,
  SuperRenameMediaKind,
  SuperRenameUnmatched,
  SuperRenameUnmatchedReason,
  SuperRenameVideoDirectory,
  SuperRenameVideoDirectoryStatus,
} from "./api/types";

export type SuperRenameProjectedCandidate = SuperRenameCandidate & {
  selected: boolean;
  targetPath: string;
  targetName: string;
  changed: boolean;
};

export type SuperRenameConflictCode =
  | "target_occupied"
  | "duplicate_target"
  | "video_directory_blocked"
  | "recovery_required";

export type SuperRenameProjectedItem = SuperRenameProjectedCandidate & {
  conflict: boolean;
  errorCode?: SuperRenameConflictCode;
};

export type SuperRenameSelectionState = "none" | "some" | "all";

export type SuperRenameProjectedGroup = {
  path: string;
  name: string;
  images: SuperRenameProjectedItem[];
  videos: SuperRenameProjectedItem[];
  unmatched: SuperRenameUnmatched[];
  videoDirectory: SuperRenameVideoDirectory;
  recoveryResidues: string[];
  matchedCount: number;
  selectedCount: number;
  selectionState: SuperRenameSelectionState;
  createVideoDirectory: boolean;
  hasConflict: boolean;
};

export type SuperRenameProjectionSummary = {
  groupCount: number;
  matchedGroupCount: number;
  selectedCount: number;
  unmatchedCount: number;
  conflictCount: number;
  createVideoDirectoryCount: number;
};

export type SuperRenameProjection = {
  rootId: string;
  directoryPath: string;
  groups: SuperRenameProjectedGroup[];
  summary: SuperRenameProjectionSummary;
  hasConflict: boolean;
};

export type SuperRenameMediaClassification = {
  kind: SuperRenameMediaKind | null;
  extension: string;
};

export function classifySuperRenameMedia(name: string): SuperRenameMediaClassification {
  const dot = name.lastIndexOf(".");
  const extension = dot < 0 ? "" : name.slice(dot);
  return { kind: mediaKindForPath(name), extension };
}

export function superRenamePadding(count: number): number {
  const normalized = Math.max(0, Math.trunc(count));
  return Math.max(2, String(normalized).length);
}

export function projectSuperRenameCandidates(
  groupPath: string,
  kind: SuperRenameMediaKind,
  candidates: readonly SuperRenameCandidate[],
  selectedPaths: ReadonlySet<string>,
): SuperRenameProjectedCandidate[] {
  const selectedCount = candidates.reduce(
    (count, candidate) => count + Number(selectedPaths.has(candidate.sourcePath)),
    0,
  );
  const padding = superRenamePadding(selectedCount);
  let sequence = 0;

  return candidates.map((candidate) => {
    const selected = selectedPaths.has(candidate.sourcePath);
    if (!selected) {
      return { ...candidate, selected: false, targetPath: "", targetName: "", changed: false };
    }

    sequence += 1;
    const prefix = kind === "video" ? "V" : "";
    const targetName = `${prefix}${String(sequence).padStart(padding, "0")}${candidate.extension}`;
    const targetPath = kind === "video"
      ? joinRelativePath(groupPath, "视频", targetName)
      : joinRelativePath(groupPath, targetName);
    return {
      ...candidate,
      selected: true,
      targetPath,
      targetName,
      changed: targetPath !== candidate.sourcePath,
    };
  });
}

export function projectSuperRenameInventory(
  inventory: SuperRenameInventory,
  selectedPaths: ReadonlySet<string>,
): SuperRenameProjection {
  const summary: SuperRenameProjectionSummary = {
    groupCount: inventory.groups.length,
    matchedGroupCount: 0,
    selectedCount: 0,
    unmatchedCount: 0,
    conflictCount: 0,
    createVideoDirectoryCount: 0,
  };

  const groups = inventory.groups.map<SuperRenameProjectedGroup>((group) => {
    const images = projectSuperRenameCandidates(
      group.path,
      "image",
      group.images,
      selectedPaths,
    ).map<SuperRenameProjectedItem>((row) => ({ ...row, conflict: false }));
    const videos = projectSuperRenameCandidates(
      group.path,
      "video",
      group.videos,
      selectedPaths,
    ).map<SuperRenameProjectedItem>((row) => ({ ...row, conflict: false }));
    const rows = [...images, ...videos];
    const matchedCount = rows.length;
    const selectedRows = rows.filter((row) => row.selected);
    const selectedCount = selectedRows.length;

    if (matchedCount > 0) summary.matchedGroupCount += 1;
    summary.selectedCount += selectedCount;
    summary.unmatchedCount += group.unmatched.length;

    if (group.recoveryResidues.length > 0) {
      for (const row of selectedRows) markConflict(row, "recovery_required");
    } else {
      const targetRows = new Map<string, SuperRenameProjectedItem[]>();
      const sourceRows = new Map(selectedRows.map((row) => [row.sourcePath, row]));
      for (const row of selectedRows) {
        const existing = targetRows.get(row.targetPath);
        if (existing) existing.push(row);
        else targetRows.set(row.targetPath, [row]);
      }
      for (const duplicateRows of targetRows.values()) {
        if (duplicateRows.length < 2) continue;
        for (const row of duplicateRows) markConflict(row, "duplicate_target");
      }

      const occupied = new Set([
        ...group.directOccupiedPaths,
        ...group.videoDirectory.occupiedPaths,
      ]);
      for (const row of selectedRows) {
        if (row.conflict) continue;
        if (row.mediaKind === "video" && group.videoDirectory.status === "blocking-entry") {
          markConflict(row, "video_directory_blocked");
          continue;
        }
        if (row.targetPath === row.sourcePath || !occupied.has(row.targetPath)) continue;
        const occupant = sourceRows.get(row.targetPath);
        if (occupant?.changed) continue;
        markConflict(row, "target_occupied");
      }
    }

    const conflictCount = selectedRows.reduce(
      (count, row) => count + Number(row.conflict),
      0,
    );
    const createVideoDirectory = videos.some((row) => row.selected)
      && group.videoDirectory.status === "missing";
    summary.conflictCount += conflictCount;
    summary.createVideoDirectoryCount += Number(createVideoDirectory);

    return {
      path: group.path,
      name: group.name,
      images,
      videos,
      unmatched: group.unmatched,
      videoDirectory: group.videoDirectory,
      recoveryResidues: group.recoveryResidues,
      matchedCount,
      selectedCount,
      selectionState: selectionState(matchedCount, selectedCount),
      createVideoDirectory,
      hasConflict: conflictCount > 0,
    };
  });

  return {
    rootId: inventory.rootId,
    directoryPath: inventory.directoryPath,
    groups,
    summary,
    hasConflict: summary.conflictCount > 0,
  };
}

export function defaultSuperRenameSelection(inventory: SuperRenameInventory): Set<string> {
  return new Set(
    inventory.groups.flatMap((group) => [
      ...group.images.map((candidate) => candidate.sourcePath),
      ...group.videos.map((candidate) => candidate.sourcePath),
    ]),
  );
}

function selectionState(matchedCount: number, selectedCount: number): SuperRenameSelectionState {
  if (selectedCount === 0) return "none";
  if (selectedCount === matchedCount) return "all";
  return "some";
}

function markConflict(row: SuperRenameProjectedItem, code: SuperRenameConflictCode): void {
  row.conflict = true;
  row.errorCode = code;
}

function joinRelativePath(...parts: string[]): string {
  const segments = parts.flatMap((part) => part.replaceAll("\\", "/").split("/"));
  const normalized: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      normalized.pop();
    } else {
      normalized.push(segment);
    }
  }
  return normalized.join("/");
}
