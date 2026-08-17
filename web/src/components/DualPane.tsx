import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { api } from "../api/client";
import type { Entry, OpsRequest, RenameOptions, Root } from "../api/types";
import {
  buildDragRequest,
  buildFileDragSource,
  buildFileDropFeedback,
  isFileDragData,
  isFileDropData,
  type DragOperation,
  type FileDragData,
  type FileDragSource,
  type FileDropFeedback,
  type PaneKey,
} from "../fileDrag";
import { fileSelectionMode } from "../fileSelection";
import type { FileSelectionModifiers } from "../fileSelection";
import { createFileSelectionStore, type FileSelectionStore } from "../fileSelectionStore";
import { strings } from "../i18n";
import type { LanguageMode, UIStrings } from "../i18n";
import { JobEventsStore } from "../jobEvents";
import { useOptionalJobEventsStore } from "../jobEventsContext";
import { mediaKindForPath } from "../media";
import type { MediaKind } from "../media";
import { ActionToolbar } from "./ActionToolbar";
import { AppShell } from "./AppShell";
import { createFileActions } from "./fileActions";
import type { FileAction } from "./fileActions";
import { createFileDragAnnouncements } from "./fileDragAnnouncements";
import { FileDragOverlay } from "./FileDragOverlay";
import { FilePane } from "./FilePane";
import { JobsSheet } from "./JobsSheet";
import { LanguageSelect } from "./LanguageSelect";
import { MediaPreview } from "./MediaPreview";
import { MkdirDialog } from "./MkdirDialog";
import { OperationPreview } from "./OperationPreview";
import { RenameDialog } from "./RenameDialog";
import { SingleRenameDialog } from "./SingleRenameDialog";

type PaneState = {
  rootId: string;
  path: string;
  entries: Entry[];
  loading: boolean;
  error: string | null;
};

type MediaPreviewState = {
  name: string;
  url: string;
  kind: MediaKind;
};

type PreviewState = {
  request: OpsRequest;
  operationChoices?: readonly DragOperation[];
};

export function DualPane({
  labels = strings.en,
  languageMode = "auto",
  onLanguageModeChange = () => undefined,
  jobEventsStore,
}: {
  labels?: UIStrings;
  languageMode?: LanguageMode;
  onLanguageModeChange?(mode: LanguageMode): void;
  jobEventsStore?: JobEventsStore;
}) {
  const [roots, setRoots] = useState<Root[]>([]);
  const [activePane, setActivePane] = useState<PaneKey>("left");
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [mediaPreview, setMediaPreview] = useState<MediaPreviewState | null>(null);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [singleRenameOpen, setSingleRenameOpen] = useState(false);
  const [powerRenameOpen, setPowerRenameOpen] = useState(false);
  const [powerRenameOptions, setPowerRenameOptions] = useState<RenameOptions | undefined>();
  const [jobsOpen, setJobsOpen] = useState(false);
  const [leftPanePercent, setLeftPanePercent] = useState(50);
  const [left, setLeft] = useState<PaneState>({ rootId: "", path: ".", entries: [], loading: false, error: null });
  const [right, setRight] = useState<PaneState>({ rootId: "", path: ".", entries: [], loading: false, error: null });
  const [selectionStores] = useState(() => ({
    left: createFileSelectionStore(),
    right: createFileSelectionStore(),
  }));
  const [dragSource, setDragSource] = useState<FileDragSource | null>(null);
  const [dropFeedback, setDropFeedback] = useState<FileDropFeedback | null>(null);
  const dragSourceRef = useRef<FileDragSource | null>(null);
  const paneStatesRef = useRef({ left, right });
  const refreshStateRef = useRef({ running: false, pending: false });
  const contextJobEvents = useOptionalJobEventsStore();
  const [fallbackJobEvents] = useState(() => new JobEventsStore());
  const jobEvents = jobEventsStore ?? contextJobEvents ?? fallbackJobEvents;
  const jobEventsState = useSyncExternalStore(jobEvents.subscribe, jobEvents.getSnapshot, jobEvents.getSnapshot);
  const sensors = useSensors(useSensor(PointerSensor, pointerSensorOptions));

  useLayoutEffect(() => {
    paneStatesRef.current = { left, right };
  }, [left, right]);

  const updatePane = useCallback((which: PaneKey, update: (pane: PaneState) => PaneState) => {
    if (which === "left") setLeft(update);
    else setRight(update);
  }, []);

  const loadPane = useCallback(async (which: PaneKey, rootId: string, path: string) => {
    updatePane(which, (pane) => ({ ...pane, loading: true, error: null }));
    try {
      const entries = await api.browse(rootId, path);
      updatePane(which, (pane) => ({
        ...pane,
        entries,
        loading: false,
        error: null,
      }));
    } catch (err) {
      updatePane(which, (pane) => ({
        ...pane,
        entries: [],
        loading: false,
        error: err instanceof Error ? err.message : labels.browseFailed,
      }));
    }
  }, [labels.browseFailed, updatePane]);

  useEffect(() => {
    let active = true;
    api.roots().then((items) => {
      if (!active) return;
      setRoots(items);
      const first = items[0]?.id ?? "";
      setLeft((pane) => ({ ...pane, rootId: pane.rootId || first }));
      setRight((pane) => ({ ...pane, rootId: pane.rootId || first }));
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (left.rootId) void loadPane("left", left.rootId, left.path);
  }, [left.rootId, left.path, loadPane]);

  useEffect(() => {
    if (right.rootId) void loadPane("right", right.rootId, right.path);
  }, [right.rootId, right.path, loadPane]);

  const refreshBothPanes = useCallback(async () => {
    const refreshes: Promise<void>[] = [];
    if (left.rootId) refreshes.push(loadPane("left", left.rootId, left.path));
    if (right.rootId) refreshes.push(loadPane("right", right.rootId, right.path));
    await Promise.all(refreshes);
  }, [left.rootId, left.path, loadPane, right.rootId, right.path]);

  const requestPaneRefresh = useCallback(() => {
    const state = refreshStateRef.current;
    if (state.running) {
      state.pending = true;
      return;
    }
    state.running = true;
    void (async () => {
      try {
        do {
          state.pending = false;
          await refreshBothPanes();
        } while (state.pending);
      } finally {
        state.running = false;
      }
    })();
  }, [refreshBothPanes]);

  useEffect(() => jobEvents.subscribeTerminal(requestPaneRefresh), [jobEvents, requestPaneRefresh]);

  function handleJobCreated(id: string) {
    clearSelections();
    toast.success(labels.jobCreated);
    jobEvents.registerCreatedJob(id);
  }

  function clearSelections() {
    selectionStores.left.clear();
    selectionStores.right.clear();
  }

  function paneProps(which: PaneKey, pane: PaneState) {
    return {
      paneKey: which,
      actionsForSelection: (selectedCount: number) => actionsFor(which, selectedCount),
      onContextTarget: (path: string | null) => selectContextTarget(which, path),
      dropFeedback,
      roots,
      selectedRootId: pane.rootId,
      currentPath: pane.path,
      entries: pane.entries,
      selectionStore: selectionStoreFor(which),
      loading: pane.loading,
      error: pane.error,
      onRootChange: (rootId: string) => {
        clearFileDrag();
        const selection = selectionStoreFor(which);
        selection.clear();
        selection.setVisibleOrder([]);
        updatePane(which, (current) => ({ ...current, rootId, path: "." }));
      },
      onPathChange: (path: string) => {
        clearFileDrag();
        const selection = selectionStoreFor(which);
        selection.clear();
        selection.setVisibleOrder([]);
        updatePane(which, (current) => ({ ...current, path }));
      },
      onToggleSelection: (path: string) => selectionStoreFor(which).toggle(path),
      onSelectEntry: (path: string, modifiers: FileSelectionModifiers) =>
        selectionStoreFor(which).select(path, fileSelectionMode(modifiers)),
      onSelectAll: (checked: boolean) => selectionStoreFor(which).selectAll(checked),
      onSelectPaths: (paths: string[]) => selectionStoreFor(which).replace(paths),
      onOpenFile: (entry: Entry) => openMediaPreview(pane.rootId, entry),
      onRefresh: () => {
        if (pane.rootId) void loadPane(which, pane.rootId, pane.path);
      },
      onActivate: () => setActivePane(which),
      isActive: activePane === which,
    };
  }

  function selectContextTarget(which: PaneKey, path: string | null) {
    setActivePane(which);
    selectionStoreFor(which).selectContextTarget(path);
  }

  const resolveFileDragSource = useCallback((data: FileDragData) => {
    const pane = paneStatesRef.current[data.pane];
    const selection = selectionStores[data.pane];
    const entriesByPath = new Map(pane.entries.map((entry) => [entry.relativePath, entry]));
    const orderedEntries = selection.getVisibleOrder().flatMap((path) => {
      const entry = entriesByPath.get(path);
      return entry ? [entry] : [];
    });
    const visibleEntries = orderedEntries.length === pane.entries.length ? orderedEntries : pane.entries;
    return buildFileDragSource(data, selection.getSelected(), visibleEntries);
  }, [selectionStores]);
  const dragAnnouncements = useMemo(
    () => createFileDragAnnouncements(labels, resolveFileDragSource),
    [labels, resolveFileDragSource],
  );
  const dndAccessibility = useMemo(() => ({ announcements: dragAnnouncements }), [dragAnnouncements]);

  function handleFileDragStart(event: DragStartEvent) {
    const data = event.active.data.current;
    if (!isFileDragData(data)) return;
    const source = resolveFileDragSource(data);
    dragSourceRef.current = source;
    setDragSource(source);
    setDropFeedback(null);
    setActivePane(source.pane);

    const selection = selectionStores[data.pane];
    if (!selection.isSelected(data.entry.relativePath)) {
      selection.replace(source.entries.map((entry) => entry.relativePath), data.entry.relativePath);
    }
  }

  function handleFileDragOver(event: DragOverEvent) {
    const source = dragSourceRef.current;
    const target = event.over?.data.current;
    setDropFeedback(source && isFileDropData(target) ? buildFileDropFeedback(source, target) : null);
  }

  function clearFileDrag() {
    dragSourceRef.current = null;
    setDragSource(null);
    setDropFeedback(null);
  }

  function handleFileDragEnd(event: DragEndEvent) {
    const source = dragSourceRef.current;
    const target = event.over?.data.current;
    clearFileDrag();
    if (!source || !isFileDropData(target)) return;

    const feedback = buildFileDropFeedback(source, target);
    if (!feedback.valid) {
      toast.error(labels.invalidDrop(feedback.reason ?? "inside-source"));
      return;
    }

    setPreviewState({
      request: buildDragRequest(source, target),
      operationChoices: ["move", "copy"],
    });
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={fileCollisionDetection}
        onDragStart={handleFileDragStart}
        onDragOver={handleFileDragOver}
        onDragEnd={handleFileDragEnd}
        onDragCancel={clearFileDrag}
        accessibility={dndAccessibility}
      >
        <AppShell
          labels={labels}
          activeJobCount={jobEventsState.activeCount}
          onJobsOpen={() => setJobsOpen(true)}
          languageControl={<LanguageSelect value={languageMode} onChange={onLanguageModeChange} labels={labels} />}
        >
          <div className="grid h-full min-h-0 grid-rows-[42px_minmax(0,1fr)] overflow-hidden">
            <SelectionActionToolbar
              selectionStore={selectionStoreFor(activePane)}
              actionsForSelection={(selectedCount) => actionsFor(activePane, selectedCount)}
              labels={labels}
            />
            <section
              className="workspace"
              data-testid="workspace"
              data-active-pane={activePane}
              data-file-drag-active={dragSource ? "true" : "false"}
              style={workspaceStyle(leftPanePercent)}
            >
              <FilePane title={labels.leftPane} labels={labels} {...paneProps("left", left)} />
              <div
                className="pane-divider"
                role="separator"
                aria-label={labels.resizePanes}
                aria-orientation="vertical"
                onMouseDown={startPaneResize}
              />
              <FilePane title={labels.rightPane} labels={labels} {...paneProps("right", right)} />
            </section>
          </div>
        </AppShell>
        <DragOverlay dropAnimation={null}>
          {dragSource ? <FileDragOverlay source={dragSource} feedback={dropFeedback} labels={labels} /> : null}
        </DragOverlay>
      </DndContext>
      {previewState ? (
        <OperationPreview
          request={previewState.request}
          operationChoices={previewState.operationChoices}
          labels={labels}
          onClose={() => setPreviewState(null)}
          onJobCreated={(id) => {
            setPreviewState(null);
            handleJobCreated(id);
          }}
        />
      ) : null}
      {mediaPreview ? (
        <MediaPreview
          name={mediaPreview.name}
          url={mediaPreview.url}
          kind={mediaPreview.kind}
          labels={labels}
          onClose={() => setMediaPreview(null)}
        />
      ) : null}
      {mkdirOpen ? (
        <MkdirDialog
          labels={labels}
          onClose={() => setMkdirOpen(false)}
          onSubmit={async (name) => {
            const source = activeState();
            const job = await api.opsCreateJob({
              type: "mkdir",
              sourceRoot: source.rootId,
              sources: [],
              destRoot: source.rootId,
              destPath: source.path,
              newName: name,
            });
            handleJobCreated(job.id);
            setMkdirOpen(false);
          }}
        />
      ) : null}
      {singleRenameOpen ? (
        <SingleRenameDialog
          rootId={activeState().rootId}
          path={activeSelection()[0]}
          initialName={basename(activeSelection()[0])}
          entryType={activeEntry()?.type ?? "file"}
          labels={labels}
          onClose={() => setSingleRenameOpen(false)}
          onJobCreated={(id) => {
            setSingleRenameOpen(false);
            handleJobCreated(id);
          }}
        />
      ) : null}
      {powerRenameOpen ? (
        <RenameDialog
          rootId={activeState().rootId}
          paths={activeSelection()}
          initialOptions={powerRenameOptions}
          labels={labels}
          onClose={() => setPowerRenameOpen(false)}
          onOptionsCommitted={setPowerRenameOptions}
          onJobCreated={(id) => {
            setPowerRenameOpen(false);
            handleJobCreated(id);
          }}
        />
      ) : null}
      <JobsSheet
        open={jobsOpen}
        onOpenChange={setJobsOpen}
        eventsStore={jobEvents}
        labels={labels}
      />
    </>
  );

  function activeState() {
    return stateFor(activePane);
  }

  function activeSelection() {
    return selectionFor(activePane);
  }

  function activeEntry() {
    const selectedPath = activeSelection()[0];
    return activeState().entries.find((entry) => entry.relativePath === selectedPath);
  }

  function stateFor(which: PaneKey) {
    return which === "left" ? left : right;
  }

  function oppositePane(which: PaneKey): PaneKey {
    return which === "left" ? "right" : "left";
  }

  function selectionFor(which: PaneKey) {
    return selectionStoreFor(which).getOrderedPaths();
  }

  function selectionStoreFor(which: PaneKey) {
    return selectionStores[which];
  }

  function actionsFor(which: PaneKey, selectedCount = selectionStoreFor(which).getSummary().selectedCount) {
    const destinationPane = oppositePane(which);
    return createFileActions({
      destination: destinationPane === "left" ? labels.leftPane : labels.rightPane,
      selectedCount,
      labels,
      commands: {
        onOperation: (type) => openOperationFrom(which, type),
        onMkdir: () => {
          setActivePane(which);
          setMkdirOpen(true);
        },
        onRename: () => {
          setActivePane(which);
          setSingleRenameOpen(true);
        },
        onPowerRename: () => {
          setActivePane(which);
          setPowerRenameOpen(true);
        },
      },
    });
  }

  function basename(path: string) {
    const parts = path.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? path;
  }

  function openMediaPreview(rootId: string, entry: Entry) {
    const kind = mediaKindForPath(entry.name);
    if (!kind) return;
    setMediaPreview({
      name: entry.name,
      url: api.mediaUrl(rootId, entry.relativePath),
      kind,
    });
  }

  function openOperationFrom(which: PaneKey, type: OpsRequest["type"]) {
    const source = stateFor(which);
    const dest = stateFor(oppositePane(which));
    setActivePane(which);
    setPreviewState({
      request: {
        type,
        sourceRoot: source.rootId,
        sources: selectionFor(which),
        destRoot: type === "delete" ? undefined : dest.rootId,
        destPath: type === "delete" ? undefined : dest.path,
      },
    });
  }

  function startPaneResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const workspace = event.currentTarget.parentElement;
    if (!workspace) return;
    const rect = workspace.getBoundingClientRect();
    function onMouseMove(moveEvent: MouseEvent) {
      const next = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setLeftPanePercent(clamp(next, 20, 80));
    }
    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }
}

const pointerSensorOptions = { activationConstraint: { distance: 6 } } as const;

const fileCollisionDetection: CollisionDetection = (args) => {
  const collisions = pointerWithin(args);
  const directory = collisions.find((collision) =>
    collision.data?.droppableContainer.data.current?.kind === "directory",
  );
  if (directory) return [directory];
  const pane = collisions.find((collision) =>
    collision.data?.droppableContainer.data.current?.kind === "current-directory",
  );
  return pane ? [pane] : [];
};

function SelectionActionToolbar({
  selectionStore,
  actionsForSelection,
  labels,
}: {
  selectionStore: FileSelectionStore;
  actionsForSelection(selectedCount: number): FileAction[];
  labels: UIStrings;
}) {
  const summary = useSyncExternalStore(
    selectionStore.subscribeSummary,
    selectionStore.getSummary,
    selectionStore.getSummary,
  );
  return (
    <ActionToolbar
      actions={actionsForSelection(summary.selectedCount)}
      selectedCount={summary.selectedCount}
      labels={labels}
    />
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function workspaceStyle(leftPanePercent: number) {
  return {
    gridTemplateColumns: `${leftPanePercent}fr 8px ${100 - leftPanePercent}fr`,
  } as CSSProperties;
}
