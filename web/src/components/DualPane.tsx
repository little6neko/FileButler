import { useCallback, useEffect, useRef, useState } from "react";
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
  type FileDragSource,
  type FileDropFeedback,
  type PaneKey,
} from "../fileDrag";
import { applyFileSelection } from "../fileSelection";
import { strings } from "../i18n";
import type { LanguageMode, UIStrings } from "../i18n";
import { mediaKindForPath } from "../media";
import type { MediaKind } from "../media";
import { ActionToolbar } from "./ActionToolbar";
import { AppShell } from "./AppShell";
import { createFileActions } from "./fileActions";
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
  selected: Set<string>;
  selectionAnchor: string | null;
  visibleOrder: string[];
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
}: {
  labels?: UIStrings;
  languageMode?: LanguageMode;
  onLanguageModeChange?(mode: LanguageMode): void;
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
  const [activeJobCount, setActiveJobCount] = useState(0);
  const [leftPanePercent, setLeftPanePercent] = useState(50);
  const [left, setLeft] = useState<PaneState>({ rootId: "", path: ".", entries: [], selected: new Set(), selectionAnchor: null, visibleOrder: [], loading: false, error: null });
  const [right, setRight] = useState<PaneState>({ rootId: "", path: ".", entries: [], selected: new Set(), selectionAnchor: null, visibleOrder: [], loading: false, error: null });
  const [dragSource, setDragSource] = useState<FileDragSource | null>(null);
  const [dropFeedback, setDropFeedback] = useState<FileDropFeedback | null>(null);
  const dragSourceRef = useRef<FileDragSource | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

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
        selected: visibleSelection(pane.selected, entries),
        selectionAnchor: visibleAnchor(pane.selectionAnchor, entries),
        visibleOrder: entries.map((entry) => entry.relativePath),
        loading: false,
        error: null,
      }));
    } catch (err) {
      updatePane(which, (pane) => ({
        ...pane,
        entries: [],
        selected: new Set(),
        selectionAnchor: null,
        visibleOrder: [],
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

  function refreshBothPanes() {
    if (left.rootId) void loadPane("left", left.rootId, left.path);
    if (right.rootId) void loadPane("right", right.rootId, right.path);
  }

  function handleJobCreated(id: string) {
    clearSelections();
    toast.success(labels.jobCreated);
    void refreshWhenJobFinishes(id);
  }

  async function refreshWhenJobFinishes(id: string) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      let job;
      try {
        job = await api.job(id);
      } catch {
        return;
      }
      if (terminalJobStatuses.has(job.status)) {
        refreshBothPanes();
        return;
      }
      await delay(1000);
    }
  }

  function clearSelections() {
    setLeft((pane) => (pane.selected.size || pane.selectionAnchor ? { ...pane, selected: new Set(), selectionAnchor: null } : pane));
    setRight((pane) => (pane.selected.size || pane.selectionAnchor ? { ...pane, selected: new Set(), selectionAnchor: null } : pane));
  }

  function paneProps(which: PaneKey, pane: PaneState) {
    return {
      paneKey: which,
      actions: actionsFor(which),
      onContextTarget: (path: string | null) => selectContextTarget(which, path),
      dropFeedback,
      roots,
      selectedRootId: pane.rootId,
      currentPath: pane.path,
      entries: pane.entries,
      selectedPaths: pane.selected,
      loading: pane.loading,
      error: pane.error,
      onRootChange: (rootId: string) => {
        clearFileDrag();
        updatePane(which, (current) => ({ ...current, rootId, path: ".", selected: new Set(), selectionAnchor: null, visibleOrder: [] }));
      },
      onPathChange: (path: string) => {
        clearFileDrag();
        updatePane(which, (current) => ({ ...current, path, selected: new Set(), selectionAnchor: null, visibleOrder: [] }));
      },
      onToggleSelection: (path: string) =>
        updatePane(which, (current) => {
          const next = applyFileSelection(current.selected, current.selectionAnchor, current.visibleOrder, path, "toggle");
          return { ...current, selected: next.selected, selectionAnchor: next.anchor };
        }),
      onSelectAll: (checked: boolean) =>
        updatePane(which, (current) => ({
          ...current,
          selected: checked ? new Set(current.entries.map((entry) => entry.relativePath)) : new Set(),
          selectionAnchor: null,
        })),
      onSelectPaths: (paths: string[]) =>
        updatePane(which, (current) => ({
          ...current,
          selected: new Set(paths),
          selectionAnchor: null,
        })),
      onVisibleOrderChange: (visibleOrder: string[]) =>
        updatePane(which, (current) => {
          if (sameStringArray(current.visibleOrder, visibleOrder)) return current;
          return { ...current, visibleOrder };
        }),
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
    updatePane(which, (current) => {
      if (path === null) {
        return current.selected.size || current.selectionAnchor
          ? { ...current, selected: new Set(), selectionAnchor: null }
          : current;
      }
      if (current.selected.has(path)) {
        return current.selectionAnchor === path ? current : { ...current, selectionAnchor: path };
      }
      return { ...current, selected: new Set([path]), selectionAnchor: path };
    });
  }

  function handleFileDragStart(event: DragStartEvent) {
    const data = event.active.data.current;
    if (!isFileDragData(data)) return;
    const source = buildFileDragSource(data);
    dragSourceRef.current = source;
    setDragSource(source);
    setDropFeedback(null);
    setActivePane(source.pane);

    if (!data.selectedPaths.includes(data.entry.relativePath)) {
      updatePane(source.pane, (pane) => ({
        ...pane,
        selected: new Set(source.entries.map((entry) => entry.relativePath)),
        selectionAnchor: data.entry.relativePath,
      }));
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
        accessibility={{ announcements: createFileDragAnnouncements(labels) }}
      >
        <AppShell
          labels={labels}
          activeJobCount={activeJobCount}
          onJobsOpen={() => setJobsOpen(true)}
          languageControl={<LanguageSelect value={languageMode} onChange={onLanguageModeChange} labels={labels} />}
        >
          <div className="grid h-full min-h-0 grid-rows-[42px_minmax(0,1fr)] overflow-hidden">
            <ActionToolbar
              actions={actionsFor(activePane)}
              selectedCount={selectionFor(activePane).length}
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
          onSubmit={(name) => {
            setMkdirOpen(false);
            createMkdirPreview(name);
          }}
        />
      ) : null}
      {singleRenameOpen ? (
        <SingleRenameDialog
          rootId={activeState().rootId}
          path={activeSelection()[0]}
          initialName={basename(activeSelection()[0])}
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
        onActiveCountChange={setActiveJobCount}
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

  function stateFor(which: PaneKey) {
    return which === "left" ? left : right;
  }

  function oppositePane(which: PaneKey): PaneKey {
    return which === "left" ? "right" : "left";
  }

  function selectionFor(which: PaneKey) {
    const state = stateFor(which);
    const ordered = state.visibleOrder.filter((path) => state.selected.has(path));
    const visible = new Set(state.visibleOrder);
    return [...ordered, ...Array.from(state.selected).filter((path) => !visible.has(path))];
  }

  function actionsFor(which: PaneKey) {
    const destinationPane = oppositePane(which);
    return createFileActions({
      destination: destinationPane === "left" ? labels.leftPane : labels.rightPane,
      selectedCount: selectionFor(which).length,
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

  function createMkdirPreview(name: string) {
    const source = activeState();
    setPreviewState({
      request: {
        type: "mkdir",
        sourceRoot: source.rootId,
        sources: [],
        destRoot: source.rootId,
        destPath: source.path,
        newName: name,
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

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function visibleSelection(selected: Set<string>, entries: Entry[]) {
  if (!selected.size) return selected;
  const visiblePaths = new Set(entries.map((entry) => entry.relativePath));
  const next = new Set(Array.from(selected).filter((path) => visiblePaths.has(path)));
  return next.size === selected.size ? selected : next;
}

function visibleAnchor(anchor: string | null, entries: Entry[]) {
  return anchor !== null && entries.some((entry) => entry.relativePath === anchor) ? anchor : null;
}

const terminalJobStatuses = new Set(["completed", "completed_with_errors", "failed", "canceled"]);

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function workspaceStyle(leftPanePercent: number) {
  return {
    gridTemplateColumns: `${leftPanePercent}fr 8px ${100 - leftPanePercent}fr`,
  } as CSSProperties;
}
