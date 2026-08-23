import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
import { Files, ScanText } from "lucide-react";
import { toast } from "sonner";
import { buildClipboardRequest, createAppClipboard, isEditableShortcutTarget, type AppClipboard } from "../appClipboard";
import { api } from "../api/client";
import type { Entry, OpsRequest, RenameOptions, Root } from "../api/types";
import { powerRenameCoversPoint } from "../desktopWindowHitTest";
import {
  buildDragRequest,
  buildFileDragSource,
  buildFileDropFeedback,
  isFileDragData,
  isFileDropData,
  type DragOperation,
  type FileDragData,
  type FileDragSource,
  type FileDropData,
  type FileDropFeedback,
} from "../fileDrag";
import { fileSelectionMode } from "../fileSelection";
import type { FileSelectionModifiers } from "../fileSelection";
import { createFileSelectionStore, type FileSelectionStore } from "../fileSelectionStore";
import { createDefaultFilePaneViewState, type FilePaneViewState } from "../filePaneViewState";
import { strings } from "../i18n";
import type { LanguageMode, UIStrings } from "../i18n";
import { JobEventsStore } from "../jobEvents";
import { useOptionalJobEventsStore } from "../jobEventsContext";
import { mediaKindForPath } from "../media";
import type { MediaKind } from "../media";
import {
  closeWindow,
  createWindowManagerState,
  focusWindow,
  isFileWindow,
  minimizeWindow,
  openFileWindow,
  openPowerRenameWindow,
  reconcileWindowBounds,
  restoreWindow,
  setWindowRect,
  toggleMaximizeWindow,
  windowsByMostRecent,
  type DesktopBounds,
  type FileWindowRecord,
  type PowerRenameWindowRecord,
  type WindowManagerState,
  type WindowRect,
} from "../windowManager";
import {
  closeWindowDialog,
  openWindowDialog,
  type WindowDialogs,
  type WindowDialogState,
} from "../windowDialogs";
import { ActionToolbar } from "./ActionToolbar";
import {
  createClipboardActions,
  createFileActions,
  createWindowFileActions,
  type FileAction,
  type FileActionCommands,
} from "./fileActions";
import { createFileDragAnnouncements } from "./fileDragAnnouncements";
import { FileDragOverlay } from "./FileDragOverlay";
import { FilePane } from "./FilePane";
import { JobsSheet } from "./JobsSheet";
import { LanguageSelect } from "./LanguageSelect";
import { MediaPreview } from "./MediaPreview";
import { MkdirContent, MkdirDialog } from "./MkdirDialog";
import { OperationPreview, OperationPreviewContent } from "./OperationPreview";
import { defaultRenameOptions } from "./powerRenameOptions";
import { PowerRenameContent, RenameDialog } from "./RenameDialog";
import { SingleRenameContent, SingleRenameDialog } from "./SingleRenameDialog";
import { VirtualRootView } from "./VirtualRootView";
import { WindowFrame } from "./WindowFrame";
import { WindowDialogLayer } from "./WindowDialogLayer";
import { WorkspaceShell, type TaskbarWindow, type WorkspaceMode } from "./WorkspaceShell";

type DirectoryLocation = { kind: "directory"; rootId: string; path: string };
type BrowserLocation = DirectoryLocation | { kind: "virtual-root" };

type BrowserSession = {
  id: string;
  location: BrowserLocation;
  entries: Entry[];
  loading: boolean;
  error: string | null;
  loadedKey: string | null;
  requestGeneration: number;
  selectionStore: FileSelectionStore;
  viewState: FilePaneViewState;
};

type CompactPane = "left" | "right";
type CompactBindings = Record<CompactPane, string>;

type MediaPreviewState = {
  name: string;
  url: string;
  kind: MediaKind;
};

type PreviewState = {
  request: OpsRequest;
  operationChoices?: readonly DragOperation[];
  clearMoveClipboard?: boolean;
};

type PowerRenameInstance = {
  id: string;
  rootId: string;
  paths: string[];
  sourceTitle: string;
  options: RenameOptions;
  submitting: boolean;
  submitError: string | null;
};

export const workspaceModeStorageKey = "filebutler.workspace-mode";

export function FileWorkspace({
  labels = strings.en,
  languageMode = "auto",
  onLanguageModeChange = () => undefined,
  jobEventsStore,
  initialMode,
  persistMode = true,
}: {
  labels?: UIStrings;
  languageMode?: LanguageMode;
  onLanguageModeChange?(mode: LanguageMode): void;
  jobEventsStore?: JobEventsStore;
  initialMode?: WorkspaceMode;
  persistMode?: boolean;
}) {
  const initialSessionMap = useMemo(() => ({
    left: createBrowserSession("left", { kind: "directory", rootId: "", path: "." }),
    right: createBrowserSession("right", { kind: "directory", rootId: "", path: "." }),
  }), []);
  const [sessions, setSessionsState] = useState<Record<string, BrowserSession>>(initialSessionMap);
  const sessionsRef = useRef(sessions);
  const [compactBindings, setCompactBindings] = useState<CompactBindings>({ left: "left", right: "right" });
  const [activeCompactPane, setActiveCompactPane] = useState<CompactPane>("left");
  const [mode, setModeState] = useState<WorkspaceMode>(() => initialMode ?? readStoredMode() ?? "desktop");
  const [roots, setRoots] = useState<Root[]>([]);
  const [rootsLoaded, setRootsLoaded] = useState(false);
  const [rootsError, setRootsError] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [mediaPreview, setMediaPreview] = useState<MediaPreviewState | null>(null);
  const [mkdirSessionId, setMkdirSessionId] = useState<string | null>(null);
  const [singleRenameSessionId, setSingleRenameSessionId] = useState<string | null>(null);
  const [windowDialogs, setWindowDialogsState] = useState<WindowDialogs>({});
  const windowDialogsRef = useRef(windowDialogs);
  const [powerRenameSessionId, setPowerRenameSessionId] = useState<string | null>(null);
  const [powerRenameOptions, setPowerRenameOptions] = useState<RenameOptions | undefined>();
  const [powerRenameInstances, setPowerRenameInstancesState] = useState<Record<string, PowerRenameInstance>>({});
  const powerRenameInstancesRef = useRef(powerRenameInstances);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [leftPanePercent, setLeftPanePercent] = useState(50);
  const [clipboard, setClipboard] = useState<AppClipboard | null>(null);
  const clipboardRef = useRef(clipboard);
  const [windowState, setWindowStateValue] = useState<WindowManagerState>(() => createWindowManagerState());
  const windowStateRef = useRef(windowState);
  const [desktopBounds, setDesktopBoundsValue] = useState<DesktopBounds>(initialDesktopBounds);
  const desktopBoundsRef = useRef(desktopBounds);
  const desktopRef = useRef<HTMLElement>(null);
  const sessionCounterRef = useRef(0);
  const windowCounterRef = useRef(0);
  const powerRenameCounterRef = useRef(0);
  const dialogCounterRef = useRef(0);
  const contextTargetsRef = useRef<Record<string, string | null>>({});
  const visibleSessionIdsRef = useRef<string[]>([]);
  const activeSessionIdRef = useRef<string | null>(null);
  const activeFileWindowIdRef = useRef<string | null>(null);
  const [dragSource, setDragSource] = useState<FileDragSource | null>(null);
  const [dropFeedback, setDropFeedback] = useState<FileDropFeedback | null>(null);
  const dragSourceRef = useRef<FileDragSource | null>(null);
  const refreshStateRef = useRef({ running: false, pending: false });
  const contextJobEvents = useOptionalJobEventsStore();
  const [fallbackJobEvents] = useState(() => new JobEventsStore());
  const jobEvents = jobEventsStore ?? contextJobEvents ?? fallbackJobEvents;
  const jobEventsState = useSyncExternalStore(jobEvents.subscribe, jobEvents.getSnapshot, jobEvents.getSnapshot);
  const sensors = useSensors(useSensor(PointerSensor, pointerSensorOptions));

  const commitSessions = useCallback((update: (current: Record<string, BrowserSession>) => Record<string, BrowserSession>) => {
    const next = update(sessionsRef.current);
    sessionsRef.current = next;
    setSessionsState(next);
  }, []);

  const updateSession = useCallback((id: string, update: (session: BrowserSession) => BrowserSession) => {
    commitSessions((current) => {
      const session = current[id];
      if (!session) return current;
      const next = update(session);
      return next === session ? current : { ...current, [id]: next };
    });
  }, [commitSessions]);

  const commitPowerRenameInstances = useCallback((
    update: (current: Record<string, PowerRenameInstance>) => Record<string, PowerRenameInstance>,
  ) => {
    const next = update(powerRenameInstancesRef.current);
    powerRenameInstancesRef.current = next;
    setPowerRenameInstancesState(next);
  }, []);

  const commitWindowDialogs = useCallback((update: (current: WindowDialogs) => WindowDialogs) => {
    const next = update(windowDialogsRef.current);
    windowDialogsRef.current = next;
    setWindowDialogsState(next);
  }, []);

  const loadSession = useCallback(async (id: string, force = false) => {
    const session = sessionsRef.current[id];
    if (!session || session.location.kind !== "directory" || !session.location.rootId) return;
    const key = locationKey(session.location);
    if (!force && (session.loadedKey === key || session.loading)) return;
    const generation = session.requestGeneration + 1;
    updateSession(id, (current) => ({
      ...current,
      loading: true,
      error: null,
      loadedKey: key,
      requestGeneration: generation,
    }));
    try {
      const entries = await api.browse(session.location.rootId, session.location.path);
      updateSession(id, (current) =>
        current.requestGeneration === generation && current.location.kind === "directory" && locationKey(current.location) === key
          ? { ...current, entries, loading: false, error: null }
          : current,
      );
    } catch (error) {
      updateSession(id, (current) =>
        current.requestGeneration === generation && current.location.kind === "directory" && locationKey(current.location) === key
          ? {
            ...current,
            entries: [],
            loading: false,
            error: error instanceof Error ? error.message : labels.browseFailed,
          }
          : current,
      );
    }
  }, [labels.browseFailed, updateSession]);

  const visibleSessionIds = useMemo(() => {
    if (mode === "compact") return unique([compactBindings.left, compactBindings.right]);
    return unique(windowState.windows.filter(isFileWindow).filter((window) => window.status !== "minimized").map((window) => window.sessionId));
  }, [compactBindings, mode, windowState.windows]);

  const activeWindow = windowState.windows.find((window) => window.id === windowState.activeWindowId);
  const activeSessionId = mode === "compact"
    ? compactBindings[activeCompactPane]
    : activeWindow && isFileWindow(activeWindow) ? activeWindow.sessionId : null;
  const activeFileWindowId = mode === "desktop" && activeWindow && isFileWindow(activeWindow)
    ? activeWindow.id
    : null;

  useLayoutEffect(() => {
    visibleSessionIdsRef.current = visibleSessionIds;
    activeSessionIdRef.current = activeSessionId;
    activeFileWindowIdRef.current = activeFileWindowId;
    clipboardRef.current = clipboard;
  }, [activeFileWindowId, activeSessionId, clipboard, visibleSessionIds]);

  useEffect(() => {
    for (const id of visibleSessionIds) {
      const session = sessions[id];
      if (session?.location.kind === "directory") void loadSession(id);
    }
  }, [loadSession, sessions, visibleSessionIds]);

  useEffect(() => {
    let active = true;
    api.roots().then((items) => {
      if (!active) return;
      setRoots(items);
      setRootsLoaded(true);
      setRootsError(null);
      const firstRootId = items[0]?.id ?? "";
      commitSessions((current) => Object.fromEntries(Object.entries(current).map(([id, session]) => {
        if (session.location.kind !== "directory" || session.location.rootId) return [id, session];
        return [id, {
          ...session,
          location: { kind: "directory", rootId: firstRootId, path: "." },
          loadedKey: null,
        }];
      })));
    }).catch((error) => {
      if (!active) return;
      setRootsLoaded(true);
      setRootsError(error instanceof Error ? error.message : labels.browseFailed);
    });
    return () => {
      active = false;
    };
  }, [commitSessions, labels.browseFailed]);

  useEffect(() => {
    if (!persistMode) return;
    try {
      window.localStorage.setItem(workspaceModeStorageKey, mode);
    } catch {
      // Local storage can be unavailable in hardened browsers. Mode switching
      // remains functional for the current page lifetime.
    }
  }, [mode, persistMode]);

  useLayoutEffect(() => {
    if (mode !== "desktop") return;
    const desktop = desktopRef.current;
    if (!desktop) return;
    function measure() {
      const next = {
        width: Math.max(1, desktop?.clientWidth || window.innerWidth),
        height: Math.max(1, desktop?.clientHeight || window.innerHeight - 44),
      };
      if (next.width === desktopBoundsRef.current.width && next.height === desktopBoundsRef.current.height) return;
      desktopBoundsRef.current = next;
      setDesktopBoundsValue(next);
      commitWindowState((current) => reconcileWindowBounds(current, next));
    }
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(desktop);
    return () => observer.disconnect();
  }, [mode]);

  const requestVisibleRefresh = useCallback(() => {
    const refresh = refreshStateRef.current;
    if (refresh.running) {
      refresh.pending = true;
      return;
    }
    refresh.running = true;
    void (async () => {
      try {
        do {
          refresh.pending = false;
          await Promise.all(visibleSessionIdsRef.current.map((id) => loadSession(id, true)));
        } while (refresh.pending);
      } finally {
        refresh.running = false;
      }
    })();
  }, [loadSession]);

  const handleTerminalJob = useCallback(() => {
    const visible = new Set(visibleSessionIdsRef.current);
    commitSessions((current) => Object.fromEntries(Object.entries(current).map(([id, session]) => [
      id,
      session.location.kind === "directory" && !visible.has(id)
        ? { ...session, loadedKey: null }
        : session,
    ])));
    requestVisibleRefresh();
  }, [commitSessions, requestVisibleRefresh]);

  useEffect(() => jobEvents.subscribeTerminal(handleTerminalJob), [handleTerminalJob, jobEvents]);

  const resolveFileDragSource = useCallback((data: FileDragData) => {
    const session = sessionsRef.current[data.pane];
    if (!session) return buildFileDragSource(data, new Set(), [data.entry]);
    const entriesByPath = new Map(session.entries.map((entry) => [entry.relativePath, entry]));
    const orderedEntries = session.selectionStore.getVisibleOrder().flatMap((path) => {
      const entry = entriesByPath.get(path);
      return entry ? [entry] : [];
    });
    const visibleEntries = orderedEntries.length === session.entries.length ? orderedEntries : session.entries;
    return buildFileDragSource(data, session.selectionStore.getSelected(), visibleEntries);
  }, []);
  const dragAnnouncements = useMemo(
    () => createFileDragAnnouncements(labels, resolveFileDragSource),
    [labels, resolveFileDragSource],
  );
  const dndAccessibility = useMemo(() => ({ announcements: dragAnnouncements }), [dragAnnouncements]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (isEditableShortcutTarget(event.target) || document.querySelector("[role='dialog']")) return;
      const key = event.key.toLowerCase();
      if ((key === "c" || key === "x") && !window.getSelection()?.toString()) {
        if (!copySessionSelection(activeSessionIdRef.current, key === "c" ? "copy" : "move")) {
          toast.error(labels.clipboardSelectionRequired);
        }
        event.preventDefault();
        return;
      }
      if (key === "v") {
        pasteClipboardIntoActiveSession();
        event.preventDefault();
      }
    }
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  });

  const taskbarWindows = windowState.windows.reduce<TaskbarWindow[]>((items, window) => {
    if (isFileWindow(window)) {
      items.push({
        id: window.id,
        kind: window.kind,
        title: titleForSession(sessions[window.sessionId], roots, labels),
        status: window.status,
      });
      return items;
    }
    const instance = powerRenameInstances[window.instanceId];
    if (instance) {
      items.push({
        id: window.id,
        kind: window.kind,
        title: labels.powerRenameWindowTitle(instance.paths.length),
        status: window.status,
      });
    }
    return items;
  }, []);

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
        <WorkspaceShell
          labels={labels}
          mode={mode}
          windows={taskbarWindows}
          activeWindowId={windowState.activeWindowId}
          activeJobCount={jobEventsState.activeCount}
          jobsOpen={jobsOpen}
          onModeChange={switchWorkspaceMode}
          onWindowActivate={activateTaskbarWindow}
          onJobsToggle={() => setJobsOpen((current) => !current)}
          languageControl={<LanguageSelect value={languageMode} onChange={onLanguageModeChange} labels={labels} />}
        >
          {mode === "compact" ? renderCompactWorkspace() : renderDesktopWorkspace()}
        </WorkspaceShell>
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
            const clearMoveClipboard = previewState.clearMoveClipboard;
            setPreviewState(null);
            if (clearMoveClipboard) setClipboard(null);
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
      {mkdirSessionId ? renderMkdirDialog(mkdirSessionId) : null}
      {singleRenameSessionId ? renderSingleRenameDialog(singleRenameSessionId) : null}
      {powerRenameSessionId ? renderPowerRenameDialog(powerRenameSessionId) : null}
      <JobsSheet open={jobsOpen} onOpenChange={setJobsOpen} eventsStore={jobEvents} labels={labels} />
    </>
  );

  function renderCompactWorkspace() {
    if (rootsLoaded && roots.length === 0) {
      return <div className="workspace-empty-state">{rootsError ?? labels.noMappedRoots}</div>;
    }
    const left = sessions[compactBindings.left];
    const right = sessions[compactBindings.right];
    if (!left || !right) return null;
    return (
      <div className="compact-workspace-layout">
        <SelectionActionToolbar
          selectionStore={sessions[compactBindings[activeCompactPane]].selectionStore}
          actionsForSelection={(selectedCount) => compactToolbarActions(activeCompactPane, selectedCount)}
          labels={labels}
        />
        <section
          className="workspace"
          data-testid="workspace"
          data-active-pane={activeCompactPane}
          data-file-drag-active={dragSource ? "true" : "false"}
          style={workspaceStyle(leftPanePercent)}
        >
          <FilePane
            title={labels.leftPane}
            labels={labels}
            {...filePaneProps(compactBindings.left, left, () => setActiveCompactPane("left"), 0)}
            actionsForSelection={(selectedCount) => contextActions(compactBindings.left, selectedCount, "left")}
          />
          <div
            className="pane-divider"
            role="separator"
            aria-label={labels.resizePanes}
            aria-orientation="vertical"
            onMouseDown={startPaneResize}
          />
          <FilePane
            title={labels.rightPane}
            labels={labels}
            {...filePaneProps(compactBindings.right, right, () => setActiveCompactPane("right"), 0)}
            actionsForSelection={(selectedCount) => contextActions(compactBindings.right, selectedCount, "right")}
          />
        </section>
      </div>
    );
  }

  function renderDesktopWorkspace() {
    return (
      <section ref={desktopRef} className="desktop-workspace" data-testid="desktop-workspace" data-file-drag-active={dragSource ? "true" : "false"}>
        <button type="button" className="desktop-app-icon" aria-label={labels.openFileManager} onClick={openVirtualRootWindow}>
          <span><Files aria-hidden="true" /></span>
          <strong>{labels.fileManager}</strong>
        </button>
        {rootsError ? <div className="desktop-root-error">{rootsError}</div> : null}
        {rootsLoaded && roots.length === 0 && !rootsError ? (
          <div className="desktop-empty-roots">{labels.noMappedRoots}</div>
        ) : null}
        {windowState.windows.filter((window) => window.status !== "minimized").map(renderDesktopWindow)}
      </section>
    );
  }

  function renderDesktopWindow(window: FileWindowRecord | PowerRenameWindowRecord) {
    const active = windowState.activeWindowId === window.id;
    const frameProps = {
      window,
      bounds: desktopBounds,
      active,
      labels,
      onFocus: () => focusDesktopWindow(window.id),
      onRectChange: (rect: WindowRect) => updateWindowRect(window.id, rect),
      onMinimize: () => commitWindowState((current) => minimizeWindow(current, window.id)),
      onToggleMaximize: () => commitWindowState((current) => toggleMaximizeWindow(current, window.id)),
      onClose: () => closeDesktopWindow(window.id),
    };

    if (isFileWindow(window)) {
      const session = sessions[window.sessionId];
      if (!session) return null;
      const title = titleForSession(session, roots, labels);
      return (
        <WindowFrame
          key={window.id}
          {...frameProps}
          title={title}
          childDialog={renderWindowDialog(window)}
        >
          {renderFileWindow(window, session)}
        </WindowFrame>
      );
    }

    const instance = powerRenameInstances[window.instanceId];
    if (!instance) return null;
    const title = labels.powerRenameWindowTitle(instance.paths.length);
    return (
      <WindowFrame
        key={window.id}
        {...frameProps}
        title={title}
        icon={<ScanText aria-hidden="true" />}
        closeDisabled={instance.submitting}
      >
        <div className="power-rename-window-layout" data-source-title={instance.sourceTitle}>
          <PowerRenameContent
            rootId={instance.rootId}
            paths={instance.paths}
            options={instance.options}
            submitting={instance.submitting}
            submitError={instance.submitError}
            labels={labels}
            onOptionsChange={(options) => updatePowerRenameInstance(instance.id, (current) => ({
              ...current,
              options,
              submitError: null,
            }))}
            onClose={() => closeDesktopWindow(window.id)}
            onSubmit={() => void submitPowerRename(window.id, instance.id)}
          />
        </div>
      </WindowFrame>
    );
  }

  function renderFileWindow(window: FileWindowRecord, session: BrowserSession) {
    const locationReady = session.location.kind === "directory" && Boolean(session.location.rootId);
    let rootName = labels.fileManager;
    if (session.location.kind === "directory") {
      const rootId = session.location.rootId;
      rootName = roots.find((root) => root.id === rootId)?.name ?? rootId;
    }
    return (
      <div className="file-window-layout">
        <SelectionActionToolbar
          selectionStore={session.selectionStore}
          actionsForSelection={(selectedCount) => windowToolbarActions(window.id, session.id, selectedCount, locationReady)}
          labels={labels}
        />
        {session.location.kind === "virtual-root" ? (
          <VirtualRootView
            roots={roots}
            surfaceId={session.id}
            dropWindowId={window.id}
            dropDisabled={Boolean(windowDialogs[window.id])}
            dropLayer={window.zOrder}
            dropFeedback={dropFeedback}
            labels={labels}
            onActivate={() => focusDesktopWindow(window.id)}
            onOpenRoot={(root) => setSessionLocation(session.id, { kind: "directory", rootId: root.id, path: "." })}
            actionsForRoot={(root) => rootContextActions(window.id, root)}
          />
        ) : (
          <FilePane
            title={titleForSession(session, roots, labels)}
            labels={labels}
            {...filePaneProps(session.id, session, () => focusDesktopWindow(window.id), window.zOrder, window.id)}
            showRootSelector={false}
            pathRootLabel={rootName}
            rootCatalogLabel={labels.allLocations}
            onOpenRootCatalog={() => setSessionLocation(session.id, { kind: "virtual-root" })}
            actionsForSelection={(selectedCount) => contextActions(session.id, selectedCount, undefined, window.id)}
          />
        )}
      </div>
    );
  }

  function renderWindowDialog(window: FileWindowRecord) {
    const dialog = windowDialogs[window.id];
    if (!dialog) return null;
    const titleId = `window-dialog-title-${dialog.dialogId}`;
    const close = () => dismissWindowDialog(dialog);

    if (dialog.kind === "mkdir") {
      return (
        <WindowDialogLayer labelledBy={titleId} onClose={close}>
          <MkdirContent
            titleId={titleId}
            labels={labels}
            onClose={close}
            onSubmit={(name) => submitWindowDialogJob(
              dialog,
              () => api.opsCreateJob({
                type: "mkdir",
                sourceRoot: dialog.rootId,
                sources: [],
                destRoot: dialog.rootId,
                destPath: dialog.directoryPath,
                newName: name,
              }),
              labels.jobCreationFailed,
            )}
          />
        </WindowDialogLayer>
      );
    }

    if (dialog.kind === "singleRename") {
      return (
        <WindowDialogLayer labelledBy={titleId} onClose={close}>
          <SingleRenameContent
            titleId={titleId}
            initialName={dialog.initialName}
            entryType={dialog.entryType}
            labels={labels}
            onClose={close}
            onSubmit={(newName) => submitWindowDialogJob(
              dialog,
              () => api.singleRenameCreateJob({ rootId: dialog.rootId, paths: [dialog.path], newName }),
              labels.renameFailed,
            )}
          />
        </WindowDialogLayer>
      );
    }

    const descriptionId = `window-dialog-description-${dialog.dialogId}`;
    return (
      <WindowDialogLayer labelledBy={titleId} describedBy={descriptionId} size="operation" onClose={close}>
        <OperationPreviewContent
          request={dialog.request}
          operationChoices={dialog.operationChoices}
          titleId={titleId}
          descriptionId={descriptionId}
          labels={labels}
          onClose={close}
          onSubmit={(request) => submitWindowDialogJob(
            dialog,
            () => api.opsCreateJob(request),
            labels.jobCreationFailed,
          )}
        />
      </WindowDialogLayer>
    );
  }

  function renderMkdirDialog(sessionId: string) {
    const session = sessions[sessionId];
    if (!session || session.location.kind !== "directory") return null;
    const location = session.location;
    return (
      <MkdirDialog
        labels={labels}
        onClose={() => setMkdirSessionId(null)}
        onSubmit={async (name) => {
          const job = await api.opsCreateJob({
            type: "mkdir",
            sourceRoot: location.rootId,
            sources: [],
            destRoot: location.rootId,
            destPath: location.path,
            newName: name,
          });
          setMkdirSessionId(null);
          handleJobCreated(job.id);
        }}
      />
    );
  }

  function renderSingleRenameDialog(sessionId: string) {
    const session = sessions[sessionId];
    const path = session?.selectionStore.getOrderedPaths()[0];
    if (!session || session.location.kind !== "directory" || !path) return null;
    const entry = session.entries.find((item) => item.relativePath === path);
    return (
      <SingleRenameDialog
        rootId={session.location.rootId}
        path={path}
        initialName={basename(path)}
        entryType={entry?.type ?? "file"}
        labels={labels}
        onClose={() => setSingleRenameSessionId(null)}
        onJobCreated={(id) => {
          setSingleRenameSessionId(null);
          handleJobCreated(id);
        }}
      />
    );
  }

  function renderPowerRenameDialog(sessionId: string) {
    const session = sessions[sessionId];
    if (!session || session.location.kind !== "directory") return null;
    return (
      <RenameDialog
        rootId={session.location.rootId}
        paths={session.selectionStore.getOrderedPaths()}
        initialOptions={powerRenameOptions}
        labels={labels}
        onClose={() => setPowerRenameSessionId(null)}
        onOptionsCommitted={setPowerRenameOptions}
        onJobCreated={(id) => {
          setPowerRenameSessionId(null);
          handleJobCreated(id);
        }}
      />
    );
  }

  function filePaneProps(
    sessionId: string,
    session: BrowserSession,
    onActivate: () => void,
    dropLayer: number,
    dropWindowId?: string,
  ) {
    const location = session.location.kind === "directory" ? session.location : { kind: "directory" as const, rootId: "", path: "." };
    return {
      paneKey: sessionId,
      dropLayer,
      dropWindowId,
      dropDisabled: Boolean(dropWindowId && windowDialogs[dropWindowId]),
      onContextTarget: (path: string | null) => selectContextTarget(sessionId, path, onActivate),
      dropFeedback,
      roots,
      selectedRootId: location.rootId,
      currentPath: location.path,
      entries: session.entries,
      cutPaths: clipboard?.operation === "move"
        && clipboard.sourceRootId === location.rootId
        && clipboard.sourceParentPath === location.path
        ? new Set(clipboard.paths)
        : undefined,
      initialViewState: session.viewState,
      onViewStateChange: (viewState: FilePaneViewState) => updateSession(sessionId, (current) => ({ ...current, viewState })),
      selectionStore: session.selectionStore,
      loading: session.loading,
      error: session.error,
      onRootChange: (rootId: string) => setSessionLocation(sessionId, { kind: "directory", rootId, path: "." }),
      onPathChange: (path: string) => setSessionLocation(sessionId, { kind: "directory", rootId: location.rootId, path }),
      onToggleSelection: (path: string) => session.selectionStore.toggle(path),
      onSelectEntry: (path: string, modifiers: FileSelectionModifiers) => session.selectionStore.select(path, fileSelectionMode(modifiers)),
      onSelectAll: (checked: boolean) => session.selectionStore.selectAll(checked),
      onSelectPaths: (paths: string[]) => session.selectionStore.replace(paths),
      onOpenFile: (entry: Entry) => openMediaPreview(location.rootId, entry),
      onRefresh: () => void loadSession(sessionId, true),
      onActivate,
      isActive: activeSessionId === sessionId,
    };
  }

  function compactToolbarActions(which: CompactPane, selectedCount: number) {
    const sourceId = compactBindings[which];
    const destinationPane = oppositePane(which);
    return createFileActions({
      destination: destinationPane === "left" ? labels.leftPane : labels.rightPane,
      destinationDirection: destinationPane,
      selectedCount,
      labels,
      commands: actionCommands(sourceId, (type) => openCompactOperation(which, type)),
    });
  }

  function windowToolbarActions(windowId: string, sessionId: string, selectedCount: number, locationReady = true) {
    return createWindowFileActions({
      selectedCount,
      locationReady,
      labels,
      commands: actionCommands(sessionId, (type) => openSingleSessionOperation(windowId, sessionId, type), windowId),
    });
  }

  function contextActions(sessionId: string, selectedCount: number, compactPane?: CompactPane, windowId?: string) {
    const session = sessionsRef.current[sessionId];
    const locationReady = session?.location.kind === "directory" && Boolean(session.location.rootId);
    const base = compactPane
      ? compactToolbarActions(compactPane, selectedCount)
      : windowId
        ? windowToolbarActions(windowId, sessionId, selectedCount, locationReady)
        : [];
    const targetPath = contextTargetsRef.current[sessionId] ?? null;
    const targetEntry = session?.entries.find((entry) => entry.relativePath === targetPath);
    const pasteTarget = resolveContextPasteTarget(session, targetEntry);
    if (compactPane) return base;

    const clipboardActions = createClipboardActions({
      selectedCount,
      canPaste: Boolean(clipboardRef.current && pasteTarget),
      canOpenInNewWindow: mode === "desktop" && targetEntry?.type === "directory",
      labels,
      commands: {
        onCopy: () => copySessionSelection(sessionId, "copy"),
        onCut: () => copySessionSelection(sessionId, "move"),
        onPaste: () => pasteTarget && pasteClipboard(pasteTarget, windowId),
        onOpenInNewWindow: () => {
          if (session?.location.kind === "directory" && targetEntry?.type === "directory") {
            openDirectoryWindow(session.location.rootId, targetEntry.relativePath);
          }
        },
      },
    });
    return [
      ...clipboardActions,
      ...base.map((action, index) => index === 0 ? { ...action, separatorBefore: true } : action),
    ];
  }

  function rootContextActions(windowId: string, root: Root) {
    return createClipboardActions({
      selectedCount: 0,
      canPaste: Boolean(clipboardRef.current),
      canOpenInNewWindow: false,
      labels,
      commands: {
        onCopy: () => undefined,
        onCut: () => undefined,
        onPaste: () => pasteClipboard({ rootId: root.id, path: "." }, windowId),
        onOpenInNewWindow: () => undefined,
      },
    }).filter((action) => action.id === "clipboardPaste");
  }

  function actionCommands(
    sessionId: string,
    onOperation: FileActionCommands["onOperation"],
    windowId?: string,
  ): FileActionCommands {
    return {
      onOperation,
      onMkdir: () => {
        if (mode === "desktop" && windowId) openMkdirWindowDialog(windowId, sessionId);
        else setMkdirSessionId(sessionId);
      },
      onRename: () => {
        if (mode === "desktop" && windowId) openSingleRenameWindowDialog(windowId, sessionId);
        else setSingleRenameSessionId(sessionId);
      },
      onPowerRename: () => {
        if (mode === "desktop") openPowerRenameForSession(sessionId);
        else setPowerRenameSessionId(sessionId);
      },
    };
  }

  function nextDialogId() {
    return `window-dialog-${++dialogCounterRef.current}`;
  }

  function openDialogForWindow(dialog: WindowDialogState) {
    focusDesktopWindow(dialog.windowId);
    commitWindowDialogs((current) => openWindowDialog(current, dialog));
  }

  function openMkdirWindowDialog(windowId: string, sessionId: string) {
    const session = sessionsRef.current[sessionId];
    if (!session || session.location.kind !== "directory" || !session.location.rootId) return;
    openDialogForWindow({
      dialogId: nextDialogId(),
      windowId,
      kind: "mkdir",
      rootId: session.location.rootId,
      directoryPath: session.location.path,
    });
  }

  function openSingleRenameWindowDialog(windowId: string, sessionId: string) {
    const session = sessionsRef.current[sessionId];
    const path = session?.selectionStore.getOrderedPaths()[0];
    if (!session || session.location.kind !== "directory" || !session.location.rootId || !path) return;
    const entry = session.entries.find((item) => item.relativePath === path);
    openDialogForWindow({
      dialogId: nextDialogId(),
      windowId,
      kind: "singleRename",
      rootId: session.location.rootId,
      path,
      initialName: basename(path),
      entryType: entry?.type ?? "file",
    });
  }

  function dismissWindowDialog(dialog: WindowDialogState) {
    commitWindowDialogs((current) => closeWindowDialog(current, dialog.windowId, dialog.dialogId));
  }

  async function submitWindowDialogJob(
    dialog: WindowDialogState,
    createJob: () => Promise<{ id: string }>,
    fallbackMessage: string,
  ) {
    try {
      const job = await createJob();
      dismissWindowDialog(dialog);
      if (dialog.kind === "operation" && dialog.clearMoveClipboard) {
        clipboardRef.current = null;
        setClipboard(null);
      }
      handleJobCreated(job.id);
    } catch (error) {
      if (windowDialogsRef.current[dialog.windowId]?.dialogId === dialog.dialogId) throw error;
      toast.error(error instanceof Error ? error.message : fallbackMessage);
    }
  }

  function openCompactOperation(which: CompactPane, type: OpsRequest["type"]) {
    const source = sessionsRef.current[compactBindings[which]];
    const destination = sessionsRef.current[compactBindings[oppositePane(which)]];
    if (!source || source.location.kind !== "directory") return;
    setActiveCompactPane(which);
    setPreviewState({
      request: {
        type,
        sourceRoot: source.location.rootId,
        sources: source.selectionStore.getOrderedPaths(),
        destRoot: type === "delete" ? undefined : destination?.location.kind === "directory" ? destination.location.rootId : undefined,
        destPath: type === "delete" ? undefined : destination?.location.kind === "directory" ? destination.location.path : undefined,
      },
    });
  }

  function openSingleSessionOperation(windowId: string, sessionId: string, type: OpsRequest["type"]) {
    const session = sessionsRef.current[sessionId];
    if (!session || session.location.kind !== "directory" || type !== "delete") return;
    openDialogForWindow({
      dialogId: nextDialogId(),
      windowId,
      kind: "operation",
      request: {
        type,
        sourceRoot: session.location.rootId,
        sources: session.selectionStore.getOrderedPaths(),
      },
    });
  }

  function copySessionSelection(sessionId: string | null, operation: "copy" | "move") {
    if (!sessionId) return false;
    const session = sessionsRef.current[sessionId];
    if (!session || session.location.kind !== "directory") return false;
    const entries = selectedEntries(session);
    const next = createAppClipboard(operation, session.location.rootId, session.location.path, entries);
    if (!next) return false;
    setClipboard(next);
    clipboardRef.current = next;
    toast.success(operation === "copy" ? labels.clipboardCopied(entries.length) : labels.clipboardCut(entries.length));
    return true;
  }

  function pasteClipboardIntoActiveSession() {
    if (!clipboardRef.current) {
      toast.error(labels.clipboardEmpty);
      return false;
    }
    const sessionId = activeSessionIdRef.current;
    const session = sessionId ? sessionsRef.current[sessionId] : undefined;
    if (!session || session.location.kind !== "directory" || !session.location.rootId) {
      if (clipboardRef.current) toast.error(labels.pasteUnavailable);
      return false;
    }
    return pasteClipboard(
      { rootId: session.location.rootId, path: session.location.path },
      activeFileWindowIdRef.current ?? undefined,
    );
  }

  function pasteClipboard(target: { rootId: string; path: string }, windowId?: string) {
    const currentClipboard = clipboardRef.current;
    if (!currentClipboard) return false;
    const source: FileDragSource = {
      pane: "clipboard",
      rootId: currentClipboard.sourceRootId,
      parentPath: currentClipboard.sourceParentPath,
      entries: currentClipboard.entries,
    };
    const dropTarget: FileDropData = {
      id: "clipboard-target",
      kind: "current-directory",
      pane: "clipboard-target",
      rootId: target.rootId,
      path: target.path,
      label: target.path,
    };
    const feedback = buildFileDropFeedback(source, dropTarget);
    if (!feedback.valid) {
      toast.error(labels.invalidDrop(feedback.reason ?? "inside-source"));
      return true;
    }
    const preview = {
      request: buildClipboardRequest(currentClipboard, target),
      clearMoveClipboard: currentClipboard.operation === "move",
    };
    if (mode === "desktop" && windowId) {
      openDialogForWindow({
        dialogId: nextDialogId(),
        windowId,
        kind: "operation",
        ...preview,
      });
    } else {
      setPreviewState(preview);
    }
    return true;
  }

  function handleFileDragStart(event: DragStartEvent) {
    const data = event.active.data.current;
    if (!isFileDragData(data)) return;
    const source = resolveFileDragSource(data);
    dragSourceRef.current = source;
    setDragSource(source);
    setDropFeedback(null);
    activateSession(data.pane);
    const selection = sessionsRef.current[data.pane]?.selectionStore;
    if (selection && !selection.isSelected(data.entry.relativePath)) {
      selection.replace(source.entries.map((entry) => entry.relativePath), data.entry.relativePath);
    }
  }

  function handleFileDragOver(event: DragOverEvent) {
    const source = dragSourceRef.current;
    const target = event.over?.data.current;
    setDropFeedback(source && isFileDropData(target) ? buildFileDropFeedback(source, target) : null);
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
    const preview = { request: buildDragRequest(source, target), operationChoices: ["move", "copy"] as const };
    if (mode === "desktop" && target.windowId) {
      openDialogForWindow({
        dialogId: nextDialogId(),
        windowId: target.windowId,
        kind: "operation",
        ...preview,
      });
    } else {
      setPreviewState(preview);
    }
  }

  function clearFileDrag() {
    dragSourceRef.current = null;
    setDragSource(null);
    setDropFeedback(null);
  }

  function activateSession(sessionId: string) {
    if (mode === "compact") {
      if (compactBindings.left === sessionId) setActiveCompactPane("left");
      else if (compactBindings.right === sessionId) setActiveCompactPane("right");
      return;
    }
    const window = windowStateRef.current.windows.find((candidate) => isFileWindow(candidate) && candidate.sessionId === sessionId);
    if (window) focusDesktopWindow(window.id);
  }

  function selectContextTarget(sessionId: string, path: string | null, onActivate: () => void) {
    contextTargetsRef.current[sessionId] = path;
    onActivate();
    sessionsRef.current[sessionId]?.selectionStore.selectContextTarget(path);
  }

  function setSessionLocation(id: string, location: BrowserLocation) {
    clearFileDrag();
    const selection = sessionsRef.current[id]?.selectionStore;
    selection?.clear();
    selection?.setVisibleOrder([]);
    updateSession(id, (session) => ({
      ...session,
      location,
      entries: [],
      loading: false,
      error: null,
      loadedKey: null,
      requestGeneration: session.requestGeneration + 1,
    }));
  }

  function createSession(location: BrowserLocation) {
    const id = `session-${++sessionCounterRef.current}`;
    const session = createBrowserSession(id, location);
    commitSessions((current) => ({ ...current, [id]: session }));
    return id;
  }

  function commitWindowState(update: (current: WindowManagerState) => WindowManagerState) {
    const next = update(windowStateRef.current);
    windowStateRef.current = next;
    setWindowStateValue(next);
  }

  function openWindowForSession(sessionId: string) {
    const id = `window-${++windowCounterRef.current}`;
    commitWindowState((current) => openFileWindow(current, id, sessionId, desktopBoundsRef.current));
    return id;
  }

  function openPowerRenameForSession(sessionId: string) {
    const session = sessionsRef.current[sessionId];
    if (!session || session.location.kind !== "directory" || !session.location.rootId) return null;
    const paths = [...session.selectionStore.getOrderedPaths()];
    if (paths.length === 0) return null;
    const instanceId = `power-rename-${++powerRenameCounterRef.current}`;
    const instance: PowerRenameInstance = {
      id: instanceId,
      rootId: session.location.rootId,
      paths,
      sourceTitle: titleForSession(session, roots, labels),
      options: { ...(powerRenameOptions ?? defaultRenameOptions) },
      submitting: false,
      submitError: null,
    };
    commitPowerRenameInstances((current) => ({ ...current, [instanceId]: instance }));
    const windowId = `window-${++windowCounterRef.current}`;
    commitWindowState((current) => openPowerRenameWindow(
      current,
      windowId,
      instanceId,
      desktopBoundsRef.current,
    ));
    return windowId;
  }

  function openVirtualRootWindow() {
    openWindowForSession(createSession({ kind: "virtual-root" }));
  }

  function openDirectoryWindow(rootId: string, path: string) {
    openWindowForSession(createSession({ kind: "directory", rootId, path }));
  }

  function focusDesktopWindow(id: string) {
    commitWindowState((current) => focusWindow(current, id));
  }

  function updateWindowRect(id: string, rect: WindowRect) {
    commitWindowState((current) => setWindowRect(current, id, rect, desktopBoundsRef.current));
  }

  function closeDesktopWindow(id: string) {
    const target = windowStateRef.current.windows.find((window) => window.id === id);
    if (!target) return;
    if (!isFileWindow(target)) {
      const instance = powerRenameInstancesRef.current[target.instanceId];
      if (instance?.submitting) return;
      commitWindowState((current) => closeWindow(current, id));
      removePowerRenameInstance(target.instanceId);
      return;
    }
    const next = closeWindow(windowStateRef.current, id);
    commitWindowState(() => next);
    const retainedByCompact = Object.values(compactBindings).includes(target.sessionId);
    const retainedByWindow = next.windows.some((window) => isFileWindow(window) && window.sessionId === target.sessionId);
    if (retainedByCompact || retainedByWindow) return;
    delete contextTargetsRef.current[target.sessionId];
    commitSessions((current) => {
      if (!current[target.sessionId]) return current;
      const remaining = { ...current };
      delete remaining[target.sessionId];
      return remaining;
    });
  }

  function updatePowerRenameInstance(
    id: string,
    update: (instance: PowerRenameInstance) => PowerRenameInstance,
  ) {
    commitPowerRenameInstances((current) => {
      const instance = current[id];
      if (!instance) return current;
      const next = update(instance);
      return next === instance ? current : { ...current, [id]: next };
    });
  }

  function removePowerRenameInstance(id: string) {
    commitPowerRenameInstances((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  async function submitPowerRename(windowId: string, instanceId: string) {
    const instance = powerRenameInstancesRef.current[instanceId];
    if (!instance || instance.submitting) return;
    const options = { ...instance.options };
    updatePowerRenameInstance(instanceId, (current) => ({ ...current, submitting: true, submitError: null }));
    try {
      const job = await api.renameCreateJob({
        rootId: instance.rootId,
        paths: instance.paths,
        options,
      });
      setPowerRenameOptions(options);
      commitWindowState((current) => closeWindow(current, windowId));
      removePowerRenameInstance(instanceId);
      handleJobCreated(job.id);
    } catch (error) {
      updatePowerRenameInstance(instanceId, (current) => ({
        ...current,
        submitting: false,
        submitError: error instanceof Error ? error.message : labels.renameFailed,
      }));
    }
  }

  function activateTaskbarWindow(id: string) {
    setJobsOpen(false);
    const current = windowStateRef.current;
    const target = current.windows.find((window) => window.id === id);
    if (!target) return;
    if (current.activeWindowId === id && target.status !== "minimized") {
      commitWindowState((state) => minimizeWindow(state, id));
    } else if (target.status === "minimized") {
      commitWindowState((state) => restoreWindow(state, id));
    } else {
      focusDesktopWindow(id);
    }
  }

  function switchWorkspaceMode(nextMode: WorkspaceMode) {
    if (nextMode === mode) return;
    setJobsOpen(false);
    if (nextMode === "compact") switchToCompactMode();
    else switchToDesktopMode();
  }

  function switchToCompactMode() {
    const currentWindows = windowStateRef.current;
    const fileWindows = windowsByMostRecent(currentWindows).filter(isFileWindow);
    const active = fileWindows.find((window) => window.id === currentWindows.activeWindowId);
    const candidates = active
      ? [active, ...fileWindows.filter((window) => window.id !== active.id)]
      : fileWindows;
    const leftId = candidates[0]?.sessionId ?? compactBindings.left;
    let rightId = candidates.find((window) => window.sessionId !== leftId)?.sessionId ?? compactBindings.right;
    if (rightId === leftId) rightId = createSession(defaultDirectoryLocation(roots));
    ensureCompactDirectory(leftId);
    ensureCompactDirectory(rightId);
    setCompactBindings({ left: leftId, right: rightId });
    setActiveCompactPane("left");
    setModeState("compact");
  }

  function switchToDesktopMode() {
    const sessionIds = unique([compactBindings.left, compactBindings.right]);
    const windowIds: string[] = [];
    for (const sessionId of sessionIds) {
      const existing = windowStateRef.current.windows.find((window) => isFileWindow(window) && window.sessionId === sessionId);
      if (existing) {
        if (existing.status === "minimized") commitWindowState((current) => restoreWindow(current, existing.id));
        windowIds.push(existing.id);
      } else {
        windowIds.push(openWindowForSession(sessionId));
      }
    }
    const activeSession = compactBindings[activeCompactPane];
    const activeWindow = windowStateRef.current.windows.find((window) => isFileWindow(window) && window.sessionId === activeSession);
    const activeWindowId = activeWindow?.id ?? windowIds[0];
    if (activeWindowId) focusDesktopWindow(activeWindowId);
    setModeState("desktop");
  }

  function ensureCompactDirectory(sessionId: string) {
    const session = sessionsRef.current[sessionId];
    if (!session || session.location.kind === "virtual-root") {
      setSessionLocation(sessionId, defaultDirectoryLocation(roots));
    }
  }

  function handleJobCreated(id: string) {
    for (const session of Object.values(sessionsRef.current)) session.selectionStore.clear();
    toast.success(labels.jobCreated);
    jobEvents.registerCreatedJob(id);
  }

  function openMediaPreview(rootId: string, entry: Entry) {
    const kind = mediaKindForPath(entry.name);
    if (!kind) return;
    setMediaPreview({ name: entry.name, url: api.mediaUrl(rootId, entry.relativePath), kind });
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
  if (args.pointerCoordinates && powerRenameCoversPoint(args.pointerCoordinates.x, args.pointerCoordinates.y)) {
    return [];
  }
  const collisions = pointerWithin(args);
  if (collisions.length === 0) return [];
  const highestLayer = Math.max(...collisions.map((collision) => Number(collision.data?.droppableContainer.data.current?.layer ?? 0)));
  const top = collisions.filter((collision) => Number(collision.data?.droppableContainer.data.current?.layer ?? 0) === highestLayer);
  const directory = top.find((collision) => collision.data?.droppableContainer.data.current?.kind === "directory");
  if (directory) return [directory];
  const currentDirectory = top.find((collision) => collision.data?.droppableContainer.data.current?.kind === "current-directory");
  return currentDirectory ? [currentDirectory] : [];
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
  return <ActionToolbar actions={actionsForSelection(summary.selectedCount)} selectedCount={summary.selectedCount} labels={labels} />;
}

function createBrowserSession(id: string, location: BrowserLocation): BrowserSession {
  return {
    id,
    location,
    entries: [],
    loading: false,
    error: null,
    loadedKey: null,
    requestGeneration: 0,
    selectionStore: createFileSelectionStore(),
    viewState: createDefaultFilePaneViewState(),
  };
}

function selectedEntries(session: BrowserSession) {
  const entriesByPath = new Map(session.entries.map((entry) => [entry.relativePath, entry]));
  return session.selectionStore.getOrderedPaths().flatMap((path) => {
    const entry = entriesByPath.get(path);
    return entry ? [entry] : [];
  });
}

function resolveContextPasteTarget(session: BrowserSession | undefined, targetEntry: Entry | undefined) {
  if (!session || session.location.kind !== "directory" || !session.location.rootId) return null;
  return {
    rootId: session.location.rootId,
    path: targetEntry?.type === "directory" ? targetEntry.relativePath : session.location.path,
  };
}

function titleForSession(session: BrowserSession | undefined, roots: Root[], labels: UIStrings) {
  if (!session) return labels.fileManager;
  const location = session.location;
  if (location.kind === "virtual-root") return labels.fileManager;
  if (location.path === ".") return roots.find((root) => root.id === location.rootId)?.name ?? labels.fileManager;
  return basename(location.path);
}

function basename(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function locationKey(location: DirectoryLocation) {
  return `${location.rootId}:${location.path}`;
}

function defaultDirectoryLocation(roots: Root[]): DirectoryLocation {
  return { kind: "directory", rootId: roots[0]?.id ?? "", path: "." };
}

function oppositePane(which: CompactPane): CompactPane {
  return which === "left" ? "right" : "left";
}

function initialDesktopBounds(): DesktopBounds {
  if (typeof window === "undefined") return { width: 1024, height: 724 };
  return { width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight - 44) };
}

function readStoredMode(): WorkspaceMode | null {
  try {
    const value = window.localStorage.getItem(workspaceModeStorageKey);
    return value === "compact" || value === "desktop" ? value : null;
  } catch {
    return null;
  }
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function workspaceStyle(leftPanePercent: number) {
  return { gridTemplateColumns: `${leftPanePercent}fr 8px ${100 - leftPanePercent}fr` } as CSSProperties;
}
