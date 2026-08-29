import { APIError, api } from "./api/client";
import type {
  Job,
  SuperRenameCreateJobRequest,
  SuperRenameGroupPreviewRequest,
  SuperRenameInventory,
  SuperRenameInventoryGroup,
  SuperRenameMediaKind,
  SuperRenamePreviewRequest,
} from "./api/types";
import {
  projectSuperRenameInventory,
  type SuperRenameProjection,
} from "./superRename";

export type SuperRenameDirectoryLoadState = "unloaded" | "loading" | "loaded" | "failed";
export type SuperRenameSelectionIntent = "none" | "custom" | "all";

export type SuperRenameDirectoryNode = {
  path: string;
  name: string;
  parentPath: string | null;
  depth: number;
  loadState: SuperRenameDirectoryLoadState;
  childPaths: readonly string[];
  selectionIntent: SuperRenameSelectionIntent;
  ownLayerCompleted: boolean;
  hidden: boolean;
  error: string | null;
};

export type SuperRenameManagerSnapshot = {
  rootId: string;
  directoryPath: string;
  inventory: SuperRenameInventory | null;
  projection: SuperRenameProjection | null;
  directoryNodes: Readonly<Record<string, SuperRenameDirectoryNode>>;
  rootGroupPaths: readonly string[];
  selectedPaths: ReadonlySet<string>;
  expandedGroups: ReadonlySet<string>;
  loading: boolean;
  refreshing: boolean;
  submitting: boolean;
  submittingGroups: ReadonlySet<string>;
  error: string | null;
  confirmationRequired: boolean;
};

export type SuperRenameClient = {
  superRenamePreview(request: SuperRenamePreviewRequest): Promise<SuperRenameInventory>;
  superRenameGroupPreview(request: SuperRenameGroupPreviewRequest): Promise<SuperRenameInventoryGroup>;
  superRenameCreateJob(request: SuperRenameCreateJobRequest): Promise<{ id: string }>;
};

type Listener = () => void;

type GroupSubmission = {
  groupPath: string;
  selectedPaths: readonly string[];
  selectionIntent: SuperRenameSelectionIntent;
};

type WorkingDirectoryState = {
  nodes: Record<string, SuperRenameDirectoryNode>;
  rootPaths: string[];
  groups: Map<string, SuperRenameInventoryGroup>;
  selectedPaths: Set<string>;
  expandedGroups: Set<string>;
};

type MergeGroupOptions = {
  parentPath: string | null;
  depth: number;
  defaultIntent: SuperRenameSelectionIntent;
  selectedOverride?: ReadonlySet<string>;
};

type GroupRefreshResult = {
  path: string;
  group?: SuperRenameInventoryGroup;
  error?: unknown;
};

const deepRefreshConcurrency = 4;

export class SuperRenameManager {
  private readonly client: SuperRenameClient;
  private readonly listeners = new Set<Listener>();
  private snapshot: SuperRenameManagerSnapshot;
  private previewGeneration = 0;
  private submitPromise: Promise<string | null> | null = null;
  private readonly groupLoadPromises = new Map<string, Promise<void>>();
  private readonly groupLoadVersions = new Map<string, number>();
  private readonly groupSubmitPromises = new Map<string, Promise<string | null>>();
  private readonly submissionByJobID = new Map<string, GroupSubmission>();
  private destroyed = false;

  constructor(rootId: string, directoryPath: string, client: SuperRenameClient = api) {
    this.client = client;
    this.snapshot = {
      rootId,
      directoryPath,
      inventory: null,
      projection: null,
      directoryNodes: {},
      rootGroupPaths: [],
      selectedPaths: new Set(),
      expandedGroups: new Set(),
      loading: false,
      refreshing: false,
      submitting: false,
      submittingGroups: new Set(),
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
    if (
      this.destroyed
      || this.snapshot.submitting
      || this.snapshot.submittingGroups.size > 0
    ) return;
    this.invalidateGroupLoads();
    const generation = ++this.previewGeneration;
    const initial = this.snapshot.inventory === null;
    const previouslyLoadedDeepPaths = Object.values(this.snapshot.directoryNodes)
      .filter((node) => node.depth > 0 && node.loadState === "loaded")
      .map((node) => node.path);
    this.update({ loading: initial, refreshing: !initial, error: null });

    try {
      const response = await this.client.superRenamePreview({
        rootId: this.snapshot.rootId,
        directoryPath: this.snapshot.directoryPath,
      });
      if (this.destroyed || generation !== this.previewGeneration) return;

      const state = workingStateFromSnapshot(this.snapshot);
      normalizeInterruptedLoads(state);
      mergeInitialInventory(state, response);
      const deepPaths = previouslyLoadedDeepPaths.filter((path) => state.nodes[path]);
      const results = await mapWithConcurrency(deepPaths, deepRefreshConcurrency, async (groupPath) => {
        try {
          return {
            path: groupPath,
            group: await this.client.superRenameGroupPreview(this.groupPreviewRequest(groupPath)),
          } satisfies GroupRefreshResult;
        } catch (error) {
          return { path: groupPath, error } satisfies GroupRefreshResult;
        }
      });
      if (this.destroyed || generation !== this.previewGeneration) return;

      for (const result of results) {
        const node = state.nodes[result.path];
        if (!node) continue;
        if (result.group) {
          mergeInventoryGroup(state, result.group, {
            parentPath: node.parentPath,
            depth: node.depth,
            defaultIntent: "none",
          });
        } else if (isNotFound(result.error)) {
          removeDirectorySubtree(state, result.path);
        } else {
          markDirectoryLoadFailed(state, result.path, result.error);
        }
      }

      this.commitWorkingState(state, response, {
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
    if (!location || this.snapshot.submittingGroups.has(location.groupPath)) return;
    const selectedPaths = new Set(this.snapshot.selectedPaths);
    if (selected === selectedPaths.has(sourcePath)) return;
    if (selected) selectedPaths.add(sourcePath);
    else selectedPaths.delete(sourcePath);

    const group = inventory.groups.find((candidate) => candidate.path === location.groupPath);
    const nodes = cloneDirectoryNodes(this.snapshot.directoryNodes);
    const node = nodes[location.groupPath];
    if (!group || !node || node.ownLayerCompleted) return;
    const selectedCount = candidatesInGroup(group)
      .reduce((count, candidate) => count + Number(selectedPaths.has(candidate.sourcePath)), 0);
    nodes[location.groupPath] = {
      ...node,
      selectionIntent: selectionIntent(group.images.length + group.videos.length, selectedCount),
      error: null,
    };
    const projection = withVisibleDirectoryCount(
      projectWithPreservedPartitions(
        inventory,
        selectedPaths,
        previousProjection,
        location.groupPath,
        new Set([location.kind]),
      ),
      visibleDirectoryCount(nodes),
    );
    this.update({
      directoryNodes: nodes,
      selectedPaths,
      projection,
      error: null,
      confirmationRequired: false,
    });
  }

  async setGroupSelected(groupPath: string, selected: boolean): Promise<void> {
    const node = this.snapshot.directoryNodes[groupPath];
    if (!node || node.ownLayerCompleted || this.snapshot.submittingGroups.has(groupPath)) return;
    const nodes = cloneDirectoryNodes(this.snapshot.directoryNodes);
    nodes[groupPath] = {
      ...node,
      selectionIntent: selected ? "all" : "none",
      error: null,
    };
    const selectedPaths = new Set(this.snapshot.selectedPaths);
    const group = this.snapshot.inventory?.groups.find((candidate) => candidate.path === groupPath);
    if (group) {
      for (const candidate of candidatesInGroup(group)) {
        if (selected) selectedPaths.add(candidate.sourcePath);
        else selectedPaths.delete(candidate.sourcePath);
      }
    }
    const expandedGroups = new Set(this.snapshot.expandedGroups);
    if (selected) expandedGroups.add(groupPath);
    const projection = this.snapshot.inventory && this.snapshot.projection
      ? withVisibleDirectoryCount(
          projectWithPreservedPartitions(
            this.snapshot.inventory,
            selectedPaths,
            this.snapshot.projection,
            groupPath,
            new Set(["image", "video"]),
          ),
          visibleDirectoryCount(nodes),
        )
      : null;
    this.update({
      directoryNodes: nodes,
      selectedPaths,
      expandedGroups,
      projection,
      error: null,
      confirmationRequired: false,
    });
    if (selected && (node.loadState === "unloaded" || node.loadState === "failed" || node.loadState === "loading")) {
      await this.loadDirectory(groupPath);
    }
  }

  async setGroupExpanded(groupPath: string, expanded: boolean): Promise<void> {
    const node = this.snapshot.directoryNodes[groupPath];
    if (!node || node.hidden) return;
    const expandedGroups = new Set(this.snapshot.expandedGroups);
    if (expanded) expandedGroups.add(groupPath);
    else expandedGroups.delete(groupPath);
    this.update({ expandedGroups });
    if (expanded && (node.loadState === "unloaded" || node.loadState === "failed" || node.loadState === "loading")) {
      await this.loadDirectory(groupPath);
    }
  }

  submit(): Promise<string | null> {
    if (this.submitPromise) return this.submitPromise;
    const { inventory, projection } = this.snapshot;
    if (
      !inventory
      || !projection
      || projection.hasConflict
      || projection.summary.selectedCount === 0
      || this.snapshot.submittingGroups.size > 0
      || hasLoadingDirectory(this.snapshot.directoryNodes)
    ) {
      return Promise.resolve(null);
    }
    this.update({ submitting: true, error: null, confirmationRequired: false });
    const request = {
      rootId: this.snapshot.rootId,
      directoryPath: this.snapshot.directoryPath,
      selectedPaths: selectedPathsInInventoryOrder(inventory, this.snapshot.selectedPaths),
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
          if (!this.destroyed) this.update({ confirmationRequired: true, error: error.message });
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

  submitGroup(groupPath: string): Promise<string | null> {
    const existing = this.groupSubmitPromises.get(groupPath);
    if (existing) return existing;
    const { inventory, projection } = this.snapshot;
    const inventoryGroup = inventory?.groups.find((group) => group.path === groupPath);
    const projectedGroup = projection?.groups.find((group) => group.path === groupPath);
    const node = this.snapshot.directoryNodes[groupPath];
    if (
      !inventory
      || !projection
      || !inventoryGroup
      || !projectedGroup
      || !node
      || node.loadState !== "loaded"
      || node.ownLayerCompleted
      || this.snapshot.submitting
      || projectedGroup.hasConflict
      || projectedGroup.selectedCount === 0
    ) {
      return Promise.resolve(null);
    }

    const selectedPaths = selectedPathsInGroupOrder(inventoryGroup, this.snapshot.selectedPaths);
    const submission: GroupSubmission = {
      groupPath,
      selectedPaths,
      selectionIntent: node.selectionIntent,
    };
    const submittingGroups = new Set(this.snapshot.submittingGroups);
    submittingGroups.add(groupPath);
    this.update({ submittingGroups, error: null, confirmationRequired: false });
    const request = {
      rootId: this.snapshot.rootId,
      directoryPath: this.snapshot.directoryPath,
      selectedPaths,
    };
    const promise = this.client.superRenameCreateJob(request)
      .then((job) => {
        if (this.destroyed) return null;
        this.submissionByJobID.set(job.id, submission);
        this.markGroupCompleted(groupPath);
        return job.id;
      })
      .catch(async (error: unknown) => {
        if (this.destroyed) return null;
        this.clearGroupSubmitting(groupPath);
        if (error instanceof APIError && error.status === 409) {
          await this.reloadDirectory(submission);
          if (!this.destroyed) this.update({ confirmationRequired: true, error: error.message });
          return null;
        }
        this.update({ error: errorMessage(error) });
        return null;
      })
      .finally(() => {
        if (this.groupSubmitPromises.get(groupPath) === promise) {
          this.groupSubmitPromises.delete(groupPath);
        }
      });
    this.groupSubmitPromises.set(groupPath, promise);
    return promise;
  }

  async handleTerminalJobs(jobs: readonly Pick<Job, "id" | "status">[]): Promise<void> {
    for (const job of jobs) {
      const submission = this.submissionByJobID.get(job.id);
      if (!submission) continue;
      this.submissionByJobID.delete(job.id);
      if (job.status === "completed") continue;
      await this.reloadDirectory(submission);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.previewGeneration += 1;
    this.groupLoadPromises.clear();
    this.groupLoadVersions.clear();
    this.groupSubmitPromises.clear();
    this.submissionByJobID.clear();
    this.listeners.clear();
  }

  private groupPreviewRequest(groupPath: string): SuperRenameGroupPreviewRequest {
    return {
      rootId: this.snapshot.rootId,
      directoryPath: this.snapshot.directoryPath,
      groupPath,
    };
  }

  private invalidateGroupLoads(): void {
    for (const groupPath of this.groupLoadPromises.keys()) {
      this.groupLoadVersions.set(groupPath, (this.groupLoadVersions.get(groupPath) ?? 0) + 1);
    }
    this.groupLoadPromises.clear();
  }

  private loadDirectory(groupPath: string): Promise<void> {
    const existing = this.groupLoadPromises.get(groupPath);
    if (existing) return existing;
    const node = this.snapshot.directoryNodes[groupPath];
    if (!node || node.hidden || node.ownLayerCompleted) return Promise.resolve();
    const generation = this.previewGeneration;
    const version = (this.groupLoadVersions.get(groupPath) ?? 0) + 1;
    this.groupLoadVersions.set(groupPath, version);
    const nodes = cloneDirectoryNodes(this.snapshot.directoryNodes);
    nodes[groupPath] = { ...node, loadState: "loading", error: null };
    this.update({ directoryNodes: nodes, error: null });

    const promise = this.client.superRenameGroupPreview(this.groupPreviewRequest(groupPath))
      .then((group) => {
        if (!this.isCurrentGroupLoad(groupPath, version, generation)) return;
        const currentNode = this.snapshot.directoryNodes[groupPath];
        if (!currentNode) return;
        const state = workingStateFromSnapshot(this.snapshot);
        mergeInventoryGroup(state, group, {
          parentPath: currentNode.parentPath,
          depth: currentNode.depth,
          defaultIntent: "none",
        });
        this.commitWorkingState(state, this.snapshot.inventory, { error: null });
      })
      .catch((error: unknown) => {
        if (!this.isCurrentGroupLoad(groupPath, version, generation)) return;
        const state = workingStateFromSnapshot(this.snapshot);
        if (isNotFound(error)) removeDirectorySubtree(state, groupPath);
        else markDirectoryLoadFailed(state, groupPath, error);
        this.commitWorkingState(state, this.snapshot.inventory, { error: errorMessage(error) });
      })
      .finally(() => {
        if (this.groupLoadPromises.get(groupPath) === promise) {
          this.groupLoadPromises.delete(groupPath);
        }
      });
    this.groupLoadPromises.set(groupPath, promise);
    return promise;
  }

  private async reloadDirectory(submission: GroupSubmission): Promise<void> {
    const node = this.snapshot.directoryNodes[submission.groupPath];
    if (!node || this.destroyed) return;
    const state = workingStateFromSnapshot(this.snapshot);
    unhideDirectoryAncestors(state, submission.groupPath);
    const currentNode = state.nodes[submission.groupPath];
    state.nodes[submission.groupPath] = {
      ...currentNode,
      loadState: "loading",
      selectionIntent: submission.selectionIntent,
      ownLayerCompleted: false,
      hidden: false,
      error: null,
    };
    state.groups.delete(submission.groupPath);
    this.commitWorkingState(state, this.snapshot.inventory, { error: null });

    const generation = this.previewGeneration;
    const version = (this.groupLoadVersions.get(submission.groupPath) ?? 0) + 1;
    this.groupLoadVersions.set(submission.groupPath, version);
    try {
      const group = await this.client.superRenameGroupPreview(this.groupPreviewRequest(submission.groupPath));
      if (!this.isCurrentGroupLoad(submission.groupPath, version, generation)) return;
      const latestNode = this.snapshot.directoryNodes[submission.groupPath];
      if (!latestNode) return;
      const latest = workingStateFromSnapshot(this.snapshot);
      mergeInventoryGroup(latest, group, {
        parentPath: latestNode.parentPath,
        depth: latestNode.depth,
        defaultIntent: submission.selectionIntent,
        selectedOverride: submission.selectionIntent === "custom"
          ? new Set(submission.selectedPaths)
          : undefined,
      });
      this.commitWorkingState(latest, this.snapshot.inventory, { error: null });
    } catch (error) {
      if (!this.isCurrentGroupLoad(submission.groupPath, version, generation)) return;
      const latest = workingStateFromSnapshot(this.snapshot);
      if (isNotFound(error)) removeDirectorySubtree(latest, submission.groupPath);
      else markDirectoryLoadFailed(latest, submission.groupPath, error);
      this.commitWorkingState(latest, this.snapshot.inventory, { error: errorMessage(error) });
    }
  }

  private isCurrentGroupLoad(groupPath: string, version: number, generation: number): boolean {
    return !this.destroyed
      && generation === this.previewGeneration
      && this.groupLoadVersions.get(groupPath) === version;
  }

  private markGroupCompleted(groupPath: string): void {
    const state = workingStateFromSnapshot(this.snapshot);
    const node = state.nodes[groupPath];
    if (!node) {
      this.clearGroupSubmitting(groupPath);
      return;
    }
    const group = state.groups.get(groupPath);
    if (group) removeGroupCandidateSelection(state.selectedPaths, group);
    state.groups.delete(groupPath);
    state.nodes[groupPath] = {
      ...node,
      loadState: "loaded",
      ownLayerCompleted: true,
      error: null,
    };
    pruneCompletedDirectory(state, groupPath);
    const submittingGroups = new Set(this.snapshot.submittingGroups);
    submittingGroups.delete(groupPath);
    this.commitWorkingState(state, this.snapshot.inventory, {
      submittingGroups,
      error: null,
      confirmationRequired: false,
    });
  }

  private clearGroupSubmitting(groupPath: string): void {
    if (!this.snapshot.submittingGroups.has(groupPath)) return;
    const submittingGroups = new Set(this.snapshot.submittingGroups);
    submittingGroups.delete(groupPath);
    this.update({ submittingGroups });
  }

  private commitWorkingState(
    state: WorkingDirectoryState,
    metadata: SuperRenameInventory | null,
    partial: Partial<SuperRenameManagerSnapshot> = {},
  ): void {
    if (!metadata) return;
    const inventory = inventoryFromWorkingState(metadata, state);
    const projection = withVisibleDirectoryCount(
      projectSuperRenameInventory(inventory, state.selectedPaths),
      visibleDirectoryCount(state.nodes),
    );
    this.update({
      inventory,
      projection,
      directoryNodes: state.nodes,
      rootGroupPaths: state.rootPaths,
      selectedPaths: state.selectedPaths,
      expandedGroups: state.expandedGroups,
      ...partial,
    });
  }

  private update(partial: Partial<SuperRenameManagerSnapshot>): void {
    if (this.destroyed) return;
    this.snapshot = { ...this.snapshot, ...partial };
    for (const listener of this.listeners) listener();
  }
}

function workingStateFromSnapshot(snapshot: SuperRenameManagerSnapshot): WorkingDirectoryState {
  return {
    nodes: cloneDirectoryNodes(snapshot.directoryNodes),
    rootPaths: [...snapshot.rootGroupPaths],
    groups: new Map(snapshot.inventory?.groups.map((group) => [group.path, group]) ?? []),
    selectedPaths: new Set(snapshot.selectedPaths),
    expandedGroups: new Set(snapshot.expandedGroups),
  };
}

function cloneDirectoryNodes(
  nodes: Readonly<Record<string, SuperRenameDirectoryNode>>,
): Record<string, SuperRenameDirectoryNode> {
  return Object.fromEntries(Object.entries(nodes).map(([path, node]) => [
    path,
    { ...node, childPaths: [...node.childPaths] },
  ]));
}

function normalizeInterruptedLoads(state: WorkingDirectoryState): void {
  for (const [path, node] of Object.entries(state.nodes)) {
    if (node.loadState !== "loading") continue;
    state.nodes[path] = {
      ...node,
      loadState: state.groups.has(path) ? "loaded" : "unloaded",
      error: null,
    };
  }
}

function mergeInitialInventory(state: WorkingDirectoryState, inventory: SuperRenameInventory): void {
  const nextRootPaths = inventory.groups.map((group) => group.path);
  const nextRoots = new Set(nextRootPaths);
  for (const rootPath of state.rootPaths) {
    if (!nextRoots.has(rootPath)) removeDirectorySubtree(state, rootPath);
  }
  state.rootPaths = nextRootPaths;
  for (const group of inventory.groups) {
    mergeInventoryGroup(state, group, {
      parentPath: null,
      depth: 0,
      defaultIntent: "all",
    });
  }
}

function mergeInventoryGroup(
  state: WorkingDirectoryState,
  group: SuperRenameInventoryGroup,
  options: MergeGroupOptions,
): void {
  const existingNode = state.nodes[group.path];
  const oldGroup = state.groups.get(group.path);
  const previousSelected = new Set(state.selectedPaths);
  if (oldGroup) removeGroupCandidateSelection(state.selectedPaths, oldGroup);

  const intent = existingNode?.selectionIntent ?? options.defaultIntent;
  const incomingChildPaths = group.childDirectories.map((child) => child.path);
  const incomingChildren = new Set(incomingChildPaths);
  for (const oldChildPath of existingNode?.childPaths ?? []) {
    if (!incomingChildren.has(oldChildPath)) removeDirectorySubtree(state, oldChildPath);
  }
  for (const child of group.childDirectories) {
    const existingChild = state.nodes[child.path];
    state.nodes[child.path] = existingChild
      ? {
          ...existingChild,
          name: child.name,
          parentPath: group.path,
          depth: options.depth + 1,
        }
      : {
          path: child.path,
          name: child.name,
          parentPath: group.path,
          depth: options.depth + 1,
          loadState: "unloaded",
          childPaths: [],
          selectionIntent: "none",
          ownLayerCompleted: false,
          hidden: false,
          error: null,
        };
  }

  const node: SuperRenameDirectoryNode = {
    path: group.path,
    name: group.name,
    parentPath: options.parentPath,
    depth: options.depth,
    loadState: "loaded",
    childPaths: incomingChildPaths,
    selectionIntent: intent,
    ownLayerCompleted: existingNode?.ownLayerCompleted ?? false,
    hidden: existingNode?.hidden ?? false,
    error: null,
  };
  if (node.ownLayerCompleted) {
    node.hidden = !hasVisibleChild(state.nodes, node);
    state.groups.delete(group.path);
  } else {
    node.hidden = false;
    state.groups.set(group.path, group);
    const candidatePaths = candidatesInGroup(group).map((candidate) => candidate.sourcePath);
    if (options.selectedOverride) {
      for (const sourcePath of candidatePaths) {
        if (options.selectedOverride.has(sourcePath)) state.selectedPaths.add(sourcePath);
      }
    } else if (intent === "all") {
      for (const sourcePath of candidatePaths) state.selectedPaths.add(sourcePath);
    } else if (intent === "custom") {
      for (const sourcePath of candidatePaths) {
        if (previousSelected.has(sourcePath)) state.selectedPaths.add(sourcePath);
      }
    }
  }
  state.nodes[group.path] = node;

  const oldMatched = oldGroup ? oldGroup.images.length + oldGroup.videos.length : 0;
  const newMatched = group.images.length + group.videos.length;
  if (!existingNode && options.depth === 0 && newMatched > 0) {
    state.expandedGroups.add(group.path);
  } else if (existingNode && oldMatched === 0 && newMatched > 0) {
    state.expandedGroups.add(group.path);
  }
  if (node.hidden) state.expandedGroups.delete(group.path);
  else if (node.ownLayerCompleted) unhideDirectoryAncestors(state, group.path);
}

function markDirectoryLoadFailed(
  state: WorkingDirectoryState,
  groupPath: string,
  error: unknown,
): void {
  const node = state.nodes[groupPath];
  if (!node) return;
  state.nodes[groupPath] = {
    ...node,
    loadState: "failed",
    error: errorMessage(error),
  };
  state.groups.delete(groupPath);
  state.expandedGroups.delete(groupPath);
}

function removeDirectorySubtree(state: WorkingDirectoryState, groupPath: string): void {
  const node = state.nodes[groupPath];
  if (!node) return;
  for (const childPath of node.childPaths) removeDirectorySubtree(state, childPath);
  const group = state.groups.get(groupPath);
  if (group) removeGroupCandidateSelection(state.selectedPaths, group);
  for (const sourcePath of [...state.selectedPaths]) {
    if (sourcePath.startsWith(`${groupPath}/`)) state.selectedPaths.delete(sourcePath);
  }
  state.groups.delete(groupPath);
  state.expandedGroups.delete(groupPath);
  delete state.nodes[groupPath];
  if (node.parentPath) {
    const parent = state.nodes[node.parentPath];
    if (parent) {
      state.nodes[node.parentPath] = {
        ...parent,
        childPaths: parent.childPaths.filter((path) => path !== groupPath),
      };
      pruneCompletedDirectory(state, node.parentPath);
    }
  } else {
    state.rootPaths = state.rootPaths.filter((path) => path !== groupPath);
  }
}

function pruneCompletedDirectory(state: WorkingDirectoryState, groupPath: string): void {
  let currentPath: string | null = groupPath;
  while (currentPath) {
    const node: SuperRenameDirectoryNode | undefined = state.nodes[currentPath];
    if (!node || !node.ownLayerCompleted || hasVisibleChild(state.nodes, node)) break;
    state.nodes[currentPath] = { ...node, hidden: true };
    state.expandedGroups.delete(currentPath);
    currentPath = node.parentPath;
  }
}

function unhideDirectoryAncestors(state: WorkingDirectoryState, groupPath: string): void {
  let currentPath: string | null = groupPath;
  while (currentPath) {
    const node: SuperRenameDirectoryNode | undefined = state.nodes[currentPath];
    if (!node) break;
    if (node.hidden) state.nodes[currentPath] = { ...node, hidden: false };
    currentPath = node.parentPath;
  }
}

function hasVisibleChild(
  nodes: Readonly<Record<string, SuperRenameDirectoryNode>>,
  node: SuperRenameDirectoryNode,
): boolean {
  return node.childPaths.some((path) => nodes[path] && !nodes[path].hidden);
}

function inventoryFromWorkingState(
  metadata: SuperRenameInventory,
  state: WorkingDirectoryState,
): SuperRenameInventory {
  const groups: SuperRenameInventoryGroup[] = [];
  for (const path of orderedVisibleDirectoryPaths(state.nodes, state.rootPaths)) {
    const group = state.groups.get(path);
    const node = state.nodes[path];
    if (group && node?.loadState === "loaded" && !node.ownLayerCompleted) groups.push(group);
  }
  return { ...metadata, groups };
}

function orderedVisibleDirectoryPaths(
  nodes: Readonly<Record<string, SuperRenameDirectoryNode>>,
  rootPaths: readonly string[],
): string[] {
  const result: string[] = [];
  const visit = (path: string) => {
    const node = nodes[path];
    if (!node || node.hidden) return;
    result.push(path);
    for (const childPath of node.childPaths) visit(childPath);
  };
  for (const rootPath of rootPaths) visit(rootPath);
  return result;
}

function visibleDirectoryCount(nodes: Readonly<Record<string, SuperRenameDirectoryNode>>): number {
  return Object.values(nodes).reduce((count, node) => count + Number(!node.hidden), 0);
}

function withVisibleDirectoryCount(
  projection: SuperRenameProjection,
  groupCount: number,
): SuperRenameProjection {
  if (projection.summary.groupCount === groupCount) return projection;
  return { ...projection, summary: { ...projection.summary, groupCount } };
}

function hasLoadingDirectory(nodes: Readonly<Record<string, SuperRenameDirectoryNode>>): boolean {
  return Object.values(nodes).some((node) => node.loadState === "loading");
}

function selectionIntent(matchedCount: number, selectedCount: number): SuperRenameSelectionIntent {
  if (selectedCount === 0) return "none";
  if (selectedCount === matchedCount) return "all";
  return "custom";
}

function candidatesInGroup(group: SuperRenameInventoryGroup) {
  return [...group.images, ...group.videos];
}

function removeGroupCandidateSelection(
  selectedPaths: Set<string>,
  group: SuperRenameInventoryGroup,
): void {
  for (const candidate of candidatesInGroup(group)) selectedPaths.delete(candidate.sourcePath);
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
  return inventory.groups.flatMap((group) => candidatesInGroup(group))
    .map((candidate) => candidate.sourcePath)
    .filter((sourcePath) => selectedPaths.has(sourcePath));
}

function selectedPathsInGroupOrder(
  group: SuperRenameInventoryGroup,
  selectedPaths: ReadonlySet<string>,
): string[] {
  return candidatesInGroup(group)
    .map((candidate) => candidate.sourcePath)
    .filter((sourcePath) => selectedPaths.has(sourcePath));
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function isNotFound(error: unknown): boolean {
  return error instanceof APIError && error.status === 404;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "SuperRename request failed";
}
