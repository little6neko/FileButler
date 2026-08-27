import { APIError, api } from "./api/client";
import type {
  SuperRenameCreateJobRequest,
  SuperRenameInventory,
  SuperRenamePreviewRequest,
} from "./api/types";
import {
  defaultSuperRenameSelection,
  projectSuperRenameInventory,
  type SuperRenameMediaKind,
  type SuperRenameProjection,
} from "./superRename";

export type SuperRenameManagerSnapshot = {
  rootId: string;
  directoryPath: string;
  inventory: SuperRenameInventory | null;
  projection: SuperRenameProjection | null;
  selectedPaths: ReadonlySet<string>;
  expandedGroups: ReadonlySet<string>;
  loading: boolean;
  refreshing: boolean;
  submitting: boolean;
  error: string | null;
  confirmationRequired: boolean;
};

export type SuperRenameClient = {
  superRenamePreview(request: SuperRenamePreviewRequest): Promise<SuperRenameInventory>;
  superRenameCreateJob(request: SuperRenameCreateJobRequest): Promise<{ id: string }>;
};

type Listener = () => void;

export class SuperRenameManager {
  private readonly client: SuperRenameClient;
  private readonly listeners = new Set<Listener>();
  private snapshot: SuperRenameManagerSnapshot;
  private previewGeneration = 0;
  private submitPromise: Promise<string | null> | null = null;
  private destroyed = false;

  constructor(rootId: string, directoryPath: string, client: SuperRenameClient = api) {
    this.client = client;
    this.snapshot = {
      rootId,
      directoryPath,
      inventory: null,
      projection: null,
      selectedPaths: new Set(),
      expandedGroups: new Set(),
      loading: false,
      refreshing: false,
      submitting: false,
      error: null,
      confirmationRequired: false,
    };
  }

  getSnapshot = (): SuperRenameManagerSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  load(): Promise<void> {
    return this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.destroyed || this.snapshot.submitting) return;
    const generation = ++this.previewGeneration;
    const initial = this.snapshot.inventory === null;
    this.update({
      loading: initial,
      refreshing: !initial,
      error: null,
    });

    try {
      const inventory = await this.client.superRenamePreview({
        rootId: this.snapshot.rootId,
        directoryPath: this.snapshot.directoryPath,
      });
      if (this.destroyed || generation !== this.previewGeneration) return;
      const selectedPaths = reconcileSelection(
        this.snapshot.inventory,
        this.snapshot.selectedPaths,
        inventory,
      );
      const expandedGroups = reconcileExpansion(
        this.snapshot.inventory,
        this.snapshot.expandedGroups,
        inventory,
      );
      this.update({
        inventory,
        projection: projectSuperRenameInventory(inventory, selectedPaths),
        selectedPaths,
        expandedGroups,
        loading: false,
        refreshing: false,
        error: null,
      });
    } catch (error) {
      if (this.destroyed || generation !== this.previewGeneration) return;
      this.update({
        loading: false,
        refreshing: false,
        error: errorMessage(error),
      });
    }
  }

  setItemSelected(sourcePath: string, selected: boolean): void {
    const inventory = this.snapshot.inventory;
    const previousProjection = this.snapshot.projection;
    if (!inventory || !previousProjection) return;
    const location = candidateLocation(inventory, sourcePath);
    if (!location) return;
    const selectedPaths = new Set(this.snapshot.selectedPaths);
    if (selected === selectedPaths.has(sourcePath)) return;
    if (selected) selectedPaths.add(sourcePath);
    else selectedPaths.delete(sourcePath);
    const projection = projectWithPreservedPartitions(
      inventory,
      selectedPaths,
      previousProjection,
      location.groupPath,
      new Set([location.kind]),
    );
    this.update({ selectedPaths, projection, error: null, confirmationRequired: false });
  }

  setGroupSelected(groupPath: string, selected: boolean): void {
    const inventory = this.snapshot.inventory;
    const previousProjection = this.snapshot.projection;
    if (!inventory || !previousProjection) return;
    const group = inventory.groups.find((candidate) => candidate.path === groupPath);
    if (!group) return;
    const selectedPaths = new Set(this.snapshot.selectedPaths);
    for (const candidate of [...group.images, ...group.videos]) {
      if (selected) selectedPaths.add(candidate.sourcePath);
      else selectedPaths.delete(candidate.sourcePath);
    }
    const projection = projectWithPreservedPartitions(
      inventory,
      selectedPaths,
      previousProjection,
      groupPath,
      new Set(["image", "video"]),
    );
    this.update({ selectedPaths, projection, error: null, confirmationRequired: false });
  }

  setGroupExpanded(groupPath: string, expanded: boolean): void {
    if (!this.snapshot.inventory?.groups.some((group) => group.path === groupPath)) return;
    const expandedGroups = new Set(this.snapshot.expandedGroups);
    if (expanded) expandedGroups.add(groupPath);
    else expandedGroups.delete(groupPath);
    this.update({ expandedGroups });
  }

  submit(): Promise<string | null> {
    if (this.submitPromise) return this.submitPromise;
    const { inventory, projection } = this.snapshot;
    if (!inventory || !projection || projection.hasConflict || projection.summary.selectedCount === 0) {
      return Promise.resolve(null);
    }
    this.update({ submitting: true, error: null, confirmationRequired: false });
    const selectedPaths = selectedPathsInInventoryOrder(inventory, this.snapshot.selectedPaths);
    const request = {
      rootId: this.snapshot.rootId,
      directoryPath: this.snapshot.directoryPath,
      selectedPaths,
    };
    const promise = this.client.superRenameCreateJob(request)
      .then((job) => {
        if (!this.destroyed) this.update({ submitting: false });
        return this.destroyed ? null : job.id;
      })
      .catch(async (error: unknown) => {
        if (this.destroyed) return null;
        this.update({ submitting: false });
        if (error instanceof APIError && error.status === 409) {
          await this.refresh();
          if (!this.destroyed) {
            this.update({ confirmationRequired: true, error: error.message });
          }
          return null;
        }
        this.update({ error: errorMessage(error) });
        return null;
      })
      .finally(() => {
        if (this.submitPromise === promise) this.submitPromise = null;
      });
    this.submitPromise = promise;
    return promise;
  }

  destroy(): void {
    this.destroyed = true;
    this.previewGeneration += 1;
    this.listeners.clear();
  }

  private update(partial: Partial<SuperRenameManagerSnapshot>): void {
    if (this.destroyed) return;
    this.snapshot = { ...this.snapshot, ...partial };
    for (const listener of this.listeners) listener();
  }
}

function reconcileSelection(
  previous: SuperRenameInventory | null,
  previousSelection: ReadonlySet<string>,
  next: SuperRenameInventory,
): Set<string> {
  if (!previous) return defaultSuperRenameSelection(next);
  const known = allCandidatePaths(previous);
  const selected = new Set<string>();
  for (const path of allCandidatePaths(next)) {
    if (!known.has(path) || previousSelection.has(path)) selected.add(path);
  }
  return selected;
}

function reconcileExpansion(
  previous: SuperRenameInventory | null,
  previousExpansion: ReadonlySet<string>,
  next: SuperRenameInventory,
): Set<string> {
  const previousGroups = new Map(previous?.groups.map((group) => [group.path, group]) ?? []);
  const expanded = new Set<string>();
  for (const group of next.groups) {
    const previousGroup = previousGroups.get(group.path);
    if (previousGroup) {
      const newlyMatched = previousGroup.images.length + previousGroup.videos.length === 0
        && group.images.length + group.videos.length > 0;
      if (previousExpansion.has(group.path) || newlyMatched) expanded.add(group.path);
    } else if (group.images.length + group.videos.length > 0) {
      expanded.add(group.path);
    }
  }
  return expanded;
}

function allCandidatePaths(inventory: SuperRenameInventory): Set<string> {
  return new Set(inventory.groups.flatMap((group) => [
    ...group.images.map((candidate) => candidate.sourcePath),
    ...group.videos.map((candidate) => candidate.sourcePath),
  ]));
}

function candidateLocation(
  inventory: SuperRenameInventory,
  sourcePath: string,
): { groupPath: string; kind: SuperRenameMediaKind } | null {
  for (const group of inventory.groups) {
    if (group.images.some((candidate) => candidate.sourcePath === sourcePath)) {
      return { groupPath: group.path, kind: "image" };
    }
    if (group.videos.some((candidate) => candidate.sourcePath === sourcePath)) {
      return { groupPath: group.path, kind: "video" };
    }
  }
  return null;
}

function projectWithPreservedPartitions(
  inventory: SuperRenameInventory,
  selectedPaths: ReadonlySet<string>,
  previous: SuperRenameProjection,
  changedGroupPath: string,
  changedKinds: ReadonlySet<SuperRenameMediaKind>,
): SuperRenameProjection {
  const projected = projectSuperRenameInventory(inventory, selectedPaths);
  const previousGroups = new Map(previous.groups.map((group) => [group.path, group]));
  const groups = projected.groups.map((group) => {
    const oldGroup = previousGroups.get(group.path);
    if (!oldGroup) return group;
    if (group.path !== changedGroupPath) return oldGroup;
    return {
      ...group,
      images: changedKinds.has("image") ? group.images : oldGroup.images,
      videos: changedKinds.has("video") ? group.videos : oldGroup.videos,
    };
  });
  return { ...projected, groups };
}

function selectedPathsInInventoryOrder(
  inventory: SuperRenameInventory,
  selectedPaths: ReadonlySet<string>,
): string[] {
  return inventory.groups.flatMap((group) => [...group.images, ...group.videos])
    .map((candidate) => candidate.sourcePath)
    .filter((sourcePath) => selectedPaths.has(sourcePath));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "SuperRename request failed";
}
