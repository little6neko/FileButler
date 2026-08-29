import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ComponentProps, CSSProperties, MouseEvent as ReactMouseEvent } from "react";
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
import { FileCode2, FileImage, FileVideo, Files, ScanText, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { buildClipboardRequest, createAppClipboard, isEditableShortcutTarget, type AppClipboard } from "../appClipboard";
import { api } from "../api/client";
import type { Entry, OpsRequest, RenameOptions, Root } from "../api/types";
import { applicationWindowCoversPoint } from "../desktopWindowHitTest";
import { fileOpenKind } from "../fileOpenKind";
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
import {
  canMoveMedia,
  createMediaGallerySnapshot,
  currentMediaItem,
  moveMedia,
  type MediaDirection,
  type MediaGallerySnapshot,
} from "../mediaGallery";
import {
  closeWindow,
  createWindowManagerState,
  focusWindow,
  isFileWindow,
  isMediaPreviewWindow,
  isSuperRenameWindow,
  isTextEditorWindow,
  minimizeWindow,
  openFileWindow,
  openMediaPreviewWindow,
  openPowerRenameWindow,
  openSuperRenameWindow,
  openTextEditorWindow,
  reconcileWindowBounds,
  restoreWindow,
  setWindowRect,
  toggleMaximizeWindow,
  windowsByMostRecent,
  type DesktopBounds,
  type DesktopWindowRecord,
  type FileWindowRecord,
  type WindowManagerState,
  type WindowRect,
} from "../windowManager";
import { createTextEditorManager } from "../textEditorManager";
import {
  createTextEditorController,
  textEditorIssue,
  type TextEditorActionResult,
} from "../textEditorController";
import type { TextEditorSession } from "../textEditorSession";
import type { TextFileDescriptor } from "../textFiles";
import { SuperRenameManager } from "../superRenameManager";
import {
  clearAllWindowDialogs,
  clearWindowDialog,
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
import { MediaPreview, MediaPreviewContent } from "./MediaPreview";
import { MkdirContent, MkdirDialog } from "./MkdirDialog";
import { OperationPreview, OperationPreviewContent } from "./OperationPreview";
import { defaultRenameOptions } from "./powerRenameOptions";
import { PowerRenameContent, RenameDialog } from "./RenameDialog";
import { SingleRenameContent, SingleRenameDialog } from "./SingleRenameDialog";
import { SuperRenameContent } from "./SuperRenameContent";
import { SuperRenameDialog } from "./SuperRenameDialog";
import { TextEditor } from "./TextEditor";
import {
  TextEditorConfirm,
  TextEditorPageConfirm,
  type TextEditorConflictAction,
} from "./TextEditorConfirm";
import { TextEditorDialog } from "./TextEditorDialog";
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

type MediaPreviewState = MediaGallerySnapshot;

type MediaPreviewInstance = MediaGallerySnapshot & {
  id: string;
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

type SuperRenameInstance = {
  id: string;
  rootId: string;
  directoryPath: string;
  sourceTitle: string;
  manager: SuperRenameManager;
};

type CompactSuperRenameTarget = {
  rootId: string;
  directoryPath: string;
};

type TextEditorConflictPrompt = {
  instanceId: string;
  busy: TextEditorConflictAction | null;
  error: string | null;
};

type TextEditorUnsavedPrompt = {
  instanceId: string;
  busy: boolean;
  error: string | null;
};

type CompactTextEditorView = {
  holderId: string;
  instanceId: string;
};

type CompactTextEditorOpenTarget = {
  rootId: string;
  path: string;
  fileName: string;
  text: TextFileDescriptor;
};

type CompactTextEditorPendingAction =
  | { kind: "close" }
  | { kind: "open"; target: CompactTextEditorOpenTarget }
  | { kind: "switch-to-desktop" };

type CompactTextEditorUnsavedPrompt = TextEditorUnsavedPrompt & {
  pending: CompactTextEditorPendingAction;
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
  const [compactSuperRenameTarget, setCompactSuperRenameTarget] = useState<CompactSuperRenameTarget | null>(null);
  const [superRenameInstances, setSuperRenameInstancesState] = useState<Record<string, SuperRenameInstance>>({});
  const superRenameInstancesRef = useRef(superRenameInstances);
  const [mediaPreviewInstances, setMediaPreviewInstancesState] = useState<Record<string, MediaPreviewInstance>>({});
  const mediaPreviewInstancesRef = useRef(mediaPreviewInstances);
  const [compactTextEditor, setCompactTextEditorState] = useState<CompactTextEditorView | null>(null);
  const compactTextEditorRef = useRef(compactTextEditor);
  const [compactTextEditorConflict, setCompactTextEditorConflict] = useState<TextEditorConflictPrompt | null>(null);
  const [compactTextEditorUnsaved, setCompactTextEditorUnsaved] = useState<CompactTextEditorUnsavedPrompt | null>(null);
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
  const superRenameCounterRef = useRef(0);
  const mediaPreviewCounterRef = useRef(0);
  const compactTextEditorCounterRef = useRef(0);
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
  const [textEditors] = useState(() => createTextEditorManager());
  const [textEditorController] = useState(() => createTextEditorController({
    read: api.textRead,
    save: api.textSave,
  }));
  const [textEditorConflicts, setTextEditorConflicts] = useState<Record<string, TextEditorConflictPrompt>>({});
  const [textEditorUnsaved, setTextEditorUnsaved] = useState<Record<string, TextEditorUnsavedPrompt>>({});
  const jobEvents = jobEventsStore ?? contextJobEvents ?? fallbackJobEvents;
  const jobEventsState = useSyncExternalStore(jobEvents.subscribe, jobEvents.getSnapshot, jobEvents.getSnapshot);
  const textEditorState = useSyncExternalStore(textEditors.subscribe, textEditors.getSnapshot, textEditors.getSnapshot);
  const dirtyTextEditorIds = useMemo(
    () => new Set(textEditorState.dirtyInstanceIds),
    [textEditorState.dirtyInstanceIds],
  );
  const hasDirtyTextEditors = textEditorState.dirtyCount > 0;
  const textEditorDisposalGenerationRef = useRef(0);
  const sensors = useSensors(useSensor(PointerSensor, pointerSensorOptions));

  useEffect(() => {
    textEditorDisposalGenerationRef.current += 1;
    return () => {
      const cleanupGeneration = ++textEditorDisposalGenerationRef.current;
      queueMicrotask(() => {
        if (textEditorDisposalGenerationRef.current === cleanupGeneration) textEditors.dispose();
      });
    };
  }, [textEditors]);

  useEffect(() => () => {
    for (const instance of Object.values(superRenameInstancesRef.current)) instance.manager.destroy();
  }, []);

  useEffect(() => {
    if (!hasDirtyTextEditors) return;
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasDirtyTextEditors]);

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

  const commitSuperRenameInstances = useCallback((
    update: (current: Record<string, SuperRenameInstance>) => Record<string, SuperRenameInstance>,
  ) => {
    const next = update(superRenameInstancesRef.current);
    superRenameInstancesRef.current = next;
    setSuperRenameInstancesState(next);
  }, []);

  const commitMediaPreviewInstances = useCallback((
    update: (current: Record<string, MediaPreviewInstance>) => Record<string, MediaPreviewInstance>,
  ) => {
    const next = update(mediaPreviewInstancesRef.current);
    mediaPreviewInstancesRef.current = next;
    setMediaPreviewInstancesState(next);
  }, []);

  const commitCompactTextEditor = useCallback((next: CompactTextEditorView | null) => {
    compactTextEditorRef.current = next;
    setCompactTextEditorState(next);
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
      if (isEditableShortcutTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const pageDialogOpen = Boolean(document.querySelector("[role='dialog']:not(.window-dialog-panel)"));
      const activeFileWindowId = activeFileWindowIdRef.current;
      const activeWindowDialogOpen = Boolean(activeFileWindowId && windowDialogsRef.current[activeFileWindowId]);
      if (key === "a") {
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
        if (
          pageDialogOpen
          || activeWindowDialogOpen
          || document.querySelector("[role='alertdialog'], [role='menu'], [role='listbox']")
        ) return;
        const activeSessionId = activeSessionIdRef.current;
        if (activeSessionId) sessionsRef.current[activeSessionId]?.selectionStore.selectAll(true);
        return;
      }
      if (pageDialogOpen || activeWindowDialogOpen) return;
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
    if (isMediaPreviewWindow(window)) {
      const instance = mediaPreviewInstances[window.instanceId];
      const item = instance ? currentMediaItem(instance) : null;
      if (instance && item) {
        items.push({
          id: window.id,
          kind: window.kind,
          mediaKind: item.kind,
          title: item.name,
          status: window.status,
        });
      }
      return items;
    }
    if (isTextEditorWindow(window)) {
      const session = textEditors.get(window.instanceId);
      if (session) {
        items.push({
          id: window.id,
          kind: window.kind,
          title: textEditorTitle(session.fileName, dirtyTextEditorIds.has(session.id)),
          status: window.status,
        });
      }
      return items;
    }
    if (isSuperRenameWindow(window)) {
      const instance = superRenameInstances[window.instanceId];
      if (instance) {
        items.push({
          id: window.id,
          kind: window.kind,
          title: labels.superRenameWindowTitle(instance.sourceTitle),
          status: window.status,
        });
      }
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
  const compactMediaItem = mediaPreview ? currentMediaItem(mediaPreview) : null;
  const compactTextEditorSession = compactTextEditor ? textEditors.get(compactTextEditor.instanceId) : null;

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
      {mediaPreview && compactMediaItem ? (
        <MediaPreview
          name={compactMediaItem.name}
          url={api.mediaUrl(mediaPreview.rootId, compactMediaItem.relativePath)}
          kind={compactMediaItem.kind}
          mediaKey={compactMediaItem.relativePath}
          canPrevious={canMoveMedia(mediaPreview, "previous")}
          canNext={canMoveMedia(mediaPreview, "next")}
          labels={labels}
          onPrevious={() => setMediaPreview((current) => current ? moveMedia(current, "previous") : current)}
          onNext={() => setMediaPreview((current) => current ? moveMedia(current, "next") : current)}
          onClose={() => setMediaPreview(null)}
        />
      ) : null}
      {mode === "compact" && compactTextEditor && compactTextEditorSession ? (
        <TextEditorDialog
          session={compactTextEditorSession}
          labels={labels}
          title={textEditorTitle(
            compactTextEditorSession.fileName,
            dirtyTextEditorIds.has(compactTextEditorSession.id),
          )}
          onSave={() => void saveCompactTextEditor(compactTextEditorSession)}
          onClose={() => requestCompactTextEditorAction({ kind: "close" })}
        />
      ) : null}
      {mode === "compact" && compactTextEditorSession ? renderCompactTextEditorPrompt(compactTextEditorSession) : null}
      {mkdirSessionId ? renderMkdirDialog(mkdirSessionId) : null}
      {singleRenameSessionId ? renderSingleRenameDialog(singleRenameSessionId) : null}
      {powerRenameSessionId ? renderPowerRenameDialog(powerRenameSessionId) : null}
      {mode === "compact" && compactSuperRenameTarget ? (
        <SuperRenameDialog
          rootId={compactSuperRenameTarget.rootId}
          directoryPath={compactSuperRenameTarget.directoryPath}
          labels={labels}
          onClose={() => setCompactSuperRenameTarget(null)}
          onJobCreated={(id) => {
            setCompactSuperRenameTarget(null);
            handleJobCreated(id);
          }}
          onGroupJobCreated={handleJobCreated}
        />
      ) : null}
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

  function renderDesktopWindow(window: DesktopWindowRecord) {
    const active = windowState.activeWindowId === window.id;
    const frameProps = {
      window,
      bounds: desktopBounds,
      active,
      labels,
      onFocus: () => focusDesktopWindow(window.id),
      onRectChange: (rect: WindowRect) => updateWindowRect(window.id, rect),
      onMinimize: () => minimizeDesktopWindow(window.id),
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

    if (isMediaPreviewWindow(window)) {
      const instance = mediaPreviewInstances[window.instanceId];
      const item = instance ? currentMediaItem(instance) : null;
      if (!instance || !item) return null;
      return (
        <WindowFrame
          key={window.id}
          {...frameProps}
          title={item.name}
          icon={item.kind === "video" ? <FileVideo aria-hidden="true" /> : <FileImage aria-hidden="true" />}
        >
          <div className="media-preview-window-layout">
            <MediaPreviewContent
              name={item.name}
              url={api.mediaUrl(instance.rootId, item.relativePath)}
              kind={item.kind}
              mediaKey={item.relativePath}
              canPrevious={canMoveMedia(instance, "previous")}
              canNext={canMoveMedia(instance, "next")}
              previousLabel={labels.previousMedia}
              nextLabel={labels.nextMedia}
              onPrevious={() => moveMediaPreviewInstance(instance.id, "previous")}
              onNext={() => moveMediaPreviewInstance(instance.id, "next")}
            />
          </div>
        </WindowFrame>
      );
    }

    if (isTextEditorWindow(window)) {
      const session = textEditors.get(window.instanceId);
      if (!session) return null;
      const title = textEditorTitle(session.fileName, dirtyTextEditorIds.has(session.id));
      const promptBusy = Boolean(textEditorUnsaved[window.id]?.busy || textEditorConflicts[window.id]?.busy);
      return (
        <WindowFrame
          key={window.id}
          {...frameProps}
          title={title}
          icon={<FileCode2 aria-hidden="true" />}
          closeDisabled={promptBusy}
          childDialog={renderTextEditorWindowPrompt(window.id, session)}
        >
          <TextEditor
            session={session}
            labels={labels}
            onSave={() => void saveTextEditor(window.id, session)}
          />
        </WindowFrame>
      );
    }

    if (isSuperRenameWindow(window)) {
      const instance = superRenameInstances[window.instanceId];
      if (!instance) return null;
      return (
        <SuperRenameApplicationWindow
          key={window.id}
          {...frameProps}
          title={labels.superRenameWindowTitle(instance.sourceTitle)}
          instance={instance}
          onJobCreated={(id) => completeSuperRenameJob(window.id, instance.id, id)}
          onGroupJobCreated={handleJobCreated}
        />
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

  function renderTextEditorWindowPrompt(windowId: string, session: TextEditorSession) {
    const unsaved = textEditorUnsaved[windowId];
    if (unsaved?.instanceId === session.id) {
      const titleId = `text-editor-unsaved-title-${windowId}`;
      return (
        <WindowDialogLayer
          labelledBy={titleId}
          onClose={() => { if (!unsaved.busy) dismissDesktopTextEditorUnsaved(windowId); }}
        >
          <TextEditorConfirm
            kind="unsaved"
            titleId={titleId}
            fileName={session.fileName}
            labels={labels}
            busy={unsaved.busy}
            error={unsaved.error}
            onCancel={() => dismissDesktopTextEditorUnsaved(windowId)}
            onSave={() => void saveAndCloseDesktopTextEditor(windowId, session)}
            onDiscard={() => discardAndCloseDesktopTextEditor(windowId, session)}
          />
        </WindowDialogLayer>
      );
    }

    const prompt = textEditorConflicts[windowId];
    if (!prompt || prompt.instanceId !== session.id) return null;
    const titleId = `text-editor-conflict-title-${windowId}`;
    const canDismiss = prompt.busy === null;
    return (
      <WindowDialogLayer
        labelledBy={titleId}
        onClose={() => { if (canDismiss) dismissTextEditorConflict(windowId, session); }}
      >
        <TextEditorConfirm
          kind="conflict"
          titleId={titleId}
          fileName={session.fileName}
          labels={labels}
          busy={prompt.busy}
          error={prompt.error}
          onCancel={() => dismissTextEditorConflict(windowId, session)}
          onReload={() => void resolveTextEditorConflict(windowId, session, "reload")}
          onOverwrite={() => void resolveTextEditorConflict(windowId, session, "overwrite")}
        />
      </WindowDialogLayer>
    );
  }

  function renderCompactTextEditorPrompt(session: TextEditorSession) {
    const unsaved = compactTextEditorUnsaved;
    if (unsaved?.instanceId === session.id) {
      const titleId = `compact-text-editor-unsaved-title-${session.id}`;
      return (
        <TextEditorPageConfirm
          titleId={titleId}
          busy={unsaved.busy}
          onClose={dismissCompactTextEditorUnsaved}
        >
          <TextEditorConfirm
            kind="unsaved"
            titleId={titleId}
            fileName={session.fileName}
            labels={labels}
            busy={unsaved.busy}
            error={unsaved.error}
            onCancel={dismissCompactTextEditorUnsaved}
            onSave={() => void saveAndCloseCompactTextEditor(session)}
            onDiscard={discardCompactTextEditor}
          />
        </TextEditorPageConfirm>
      );
    }

    const conflict = compactTextEditorConflict;
    if (!conflict || conflict.instanceId !== session.id) return null;
    const titleId = `compact-text-editor-conflict-title-${session.id}`;
    return (
      <TextEditorPageConfirm
        titleId={titleId}
        busy={conflict.busy !== null}
        onClose={() => dismissCompactTextEditorConflict(session)}
      >
        <TextEditorConfirm
          kind="conflict"
          titleId={titleId}
          fileName={session.fileName}
          labels={labels}
          busy={conflict.busy}
          error={conflict.error}
          onCancel={() => dismissCompactTextEditorConflict(session)}
          onReload={() => void resolveCompactTextEditorConflict(session, "reload")}
          onOverwrite={() => void resolveCompactTextEditorConflict(session, "overwrite")}
        />
      </TextEditorPageConfirm>
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
      onOpenFile: (entry: Entry) => openFile(sessionId, entry),
      onRefresh: () => void loadSession(sessionId, true),
      onActivate,
      isActive: activeSessionId === sessionId,
    };
  }

  function compactToolbarActions(which: CompactPane, selectedCount: number) {
    const sourceId = compactBindings[which];
    const source = sessionsRef.current[sourceId];
    const locationReady = source?.location.kind === "directory" && Boolean(source.location.rootId);
    const destinationPane = oppositePane(which);
    return createFileActions({
      destination: destinationPane === "left" ? labels.leftPane : labels.rightPane,
      destinationDirection: destinationPane,
      selectedCount,
      locationReady,
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
      onSuperRename: () => {
        const session = sessionsRef.current[sessionId];
        if (!session || session.location.kind !== "directory" || !session.location.rootId) return;
        if (mode === "desktop") openSuperRenameForSession(sessionId);
        else setCompactSuperRenameTarget({
          rootId: session.location.rootId,
          directoryPath: session.location.path,
        });
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

  function openSuperRenameForSession(sessionId: string) {
    const session = sessionsRef.current[sessionId];
    if (!session || session.location.kind !== "directory" || !session.location.rootId) return null;
    const instanceId = `super-rename-${++superRenameCounterRef.current}`;
    const instance: SuperRenameInstance = {
      id: instanceId,
      rootId: session.location.rootId,
      directoryPath: session.location.path,
      sourceTitle: titleForSession(session, roots, labels),
      manager: new SuperRenameManager(session.location.rootId, session.location.path),
    };
    commitSuperRenameInstances((current) => ({ ...current, [instanceId]: instance }));
    const windowId = `window-${++windowCounterRef.current}`;
    commitWindowState((current) => openSuperRenameWindow(
      current,
      windowId,
      instanceId,
      desktopBoundsRef.current,
    ));
    return windowId;
  }

  function openMediaPreviewWindowForSnapshot(snapshot: MediaGallerySnapshot) {
    const item = currentMediaItem(snapshot);
    if (!item) return null;
    const existingWindow = windowsByMostRecent(windowStateRef.current).find((window) => {
      if (!isMediaPreviewWindow(window)) return false;
      const instance = mediaPreviewInstancesRef.current[window.instanceId];
      const existingItem = instance ? currentMediaItem(instance) : null;
      return instance?.rootId === snapshot.rootId && existingItem?.relativePath === item.relativePath;
    });
    if (existingWindow) {
      focusDesktopWindow(existingWindow.id);
      return existingWindow.id;
    }

    const instanceId = `media-preview-${++mediaPreviewCounterRef.current}`;
    const instance: MediaPreviewInstance = { id: instanceId, ...snapshot };
    commitMediaPreviewInstances((current) => ({ ...current, [instanceId]: instance }));
    const windowId = `window-${++windowCounterRef.current}`;
    commitWindowState((current) => openMediaPreviewWindow(
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

  function minimizeDesktopWindow(id: string) {
    commitWindowDialogs((current) => clearWindowDialog(current, id));
    commitWindowState((current) => minimizeWindow(current, id));
  }

  function updateWindowRect(id: string, rect: WindowRect) {
    commitWindowState((current) => setWindowRect(current, id, rect, desktopBoundsRef.current));
  }

  function closeDesktopWindow(id: string) {
    const target = windowStateRef.current.windows.find((window) => window.id === id);
    if (!target) return;
    commitWindowDialogs((current) => clearWindowDialog(current, id));
    if (isMediaPreviewWindow(target)) {
      commitWindowState((current) => closeWindow(current, id));
      removeMediaPreviewInstance(target.instanceId);
      return;
    }
    if (isTextEditorWindow(target)) {
      const session = textEditors.get(target.instanceId);
      if (!session) {
        commitWindowState((current) => closeWindow(current, id));
        return;
      }
      if (session.getSnapshot().dirty) {
        focusDesktopWindow(id);
        setTextEditorUnsaved((current) => ({
          ...current,
          [id]: { instanceId: session.id, busy: false, error: null },
        }));
        return;
      }
      finalizeDesktopTextEditorClose(id, session, false);
      return;
    }
    if (isSuperRenameWindow(target)) {
      const instance = superRenameInstancesRef.current[target.instanceId];
      if (instance?.manager.getSnapshot().submitting) return;
      commitWindowState((current) => closeWindow(current, id));
      removeSuperRenameInstance(target.instanceId);
      return;
    }
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

  function removeSuperRenameInstance(id: string) {
    const instance = superRenameInstancesRef.current[id];
    if (!instance) return;
    instance.manager.destroy();
    commitSuperRenameInstances((current) => withoutKey(current, id));
  }

  function removeMediaPreviewInstance(id: string) {
    commitMediaPreviewInstances((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function moveMediaPreviewInstance(id: string, direction: MediaDirection) {
    commitMediaPreviewInstances((current) => {
      const instance = current[id];
      if (!instance) return current;
      const next = moveMedia(instance, direction);
      return next === instance ? current : { ...current, [id]: next };
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

  function completeSuperRenameJob(windowId: string, instanceId: string, jobId: string) {
    commitWindowState((current) => closeWindow(current, windowId));
    removeSuperRenameInstance(instanceId);
    handleJobCreated(jobId);
  }

  function activateTaskbarWindow(id: string) {
    setJobsOpen(false);
    const current = windowStateRef.current;
    const target = current.windows.find((window) => window.id === id);
    if (!target) return;
    if (current.activeWindowId === id && target.status !== "minimized") {
      minimizeDesktopWindow(id);
    } else if (target.status === "minimized") {
      commitWindowState((state) => restoreWindow(state, id));
    } else {
      focusDesktopWindow(id);
    }
  }

  function switchWorkspaceMode(nextMode: WorkspaceMode) {
    if (nextMode === mode) return;
    if (nextMode === "desktop" && compactTextEditorRef.current) {
      requestCompactTextEditorAction({ kind: "switch-to-desktop" });
      return;
    }
    performWorkspaceModeSwitch(nextMode);
  }

  function performWorkspaceModeSwitch(nextMode: WorkspaceMode) {
    dismissTransientUIForModeChange();
    if (nextMode === "compact") switchToCompactMode();
    else switchToDesktopMode();
  }

  function dismissTransientUIForModeChange() {
    setJobsOpen(false);
    setPreviewState(null);
    setMediaPreview(null);
    setMkdirSessionId(null);
    setSingleRenameSessionId(null);
    setPowerRenameSessionId(null);
    setCompactSuperRenameTarget(null);
    commitWindowDialogs(clearAllWindowDialogs);
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

  function openMediaPreview(sessionId: string, entry: Entry) {
    const session = sessionsRef.current[sessionId];
    if (!session || session.location.kind !== "directory" || !session.location.rootId) return;
    const snapshot = createMediaGallerySnapshot(
      session.location.rootId,
      session.location.path,
      session.entries,
      session.selectionStore.getVisibleOrder(),
      entry.relativePath,
    );
    if (!snapshot) return;
    if (mode === "desktop") {
      openMediaPreviewWindowForSnapshot(snapshot);
      return;
    }
    setMediaPreview(snapshot);
  }

  function openFile(sessionId: string, entry: Entry) {
    const openKind = fileOpenKind(entry);
    if (openKind.kind === "media") {
      openMediaPreview(sessionId, entry);
      return;
    }
    if (openKind.kind !== "text") return;
    if (mode === "desktop") {
      openTextEditor(sessionId, entry, openKind.text);
      return;
    }
    openCompactTextEditor(sessionId, entry, openKind.text);
  }

  function openTextEditor(sessionId: string, entry: Entry, text: TextFileDescriptor) {
    const browserSession = sessionsRef.current[sessionId];
    if (!browserSession || browserSession.location.kind !== "directory" || !browserSession.location.rootId) return;
    const { rootId } = browserSession.location;
    const existingSession = textEditors.findByPath(rootId, entry.relativePath);
    if (existingSession) {
      const existingWindow = windowsByMostRecent(windowStateRef.current).find(
        (window) => isTextEditorWindow(window) && window.instanceId === existingSession.id,
      );
      if (existingWindow) {
        focusDesktopWindow(existingWindow.id);
        return;
      }
    }

    const windowId = `window-${++windowCounterRef.current}`;
    const acquired = textEditors.acquire({
      rootId,
      path: entry.relativePath,
      fileName: entry.name,
      text,
    }, { kind: "desktop", id: windowId });
    commitWindowState((current) => openTextEditorWindow(
      current,
      windowId,
      acquired.session.id,
      desktopBoundsRef.current,
    ));
    if (acquired.created) loadTextEditorSession(acquired.session);
  }

  function loadTextEditorSession(session: TextEditorSession) {
    void api.textRead(session.rootId, session.path).then((document) => {
      session.applyLoadedDocument(document);
    }).catch((error) => {
      session.failLoading(textEditorIssue(error));
    });
  }

  function openCompactTextEditor(sessionId: string, entry: Entry, text: TextFileDescriptor) {
    const browserSession = sessionsRef.current[sessionId];
    if (!browserSession || browserSession.location.kind !== "directory" || !browserSession.location.rootId) return;
    const target: CompactTextEditorOpenTarget = {
      rootId: browserSession.location.rootId,
      path: entry.relativePath,
      fileName: entry.name,
      text,
    };
    const current = compactTextEditorRef.current;
    const currentSession = current ? textEditors.get(current.instanceId) : null;
    if (currentSession?.rootId === target.rootId && currentSession.path === target.path) return;
    if (current) {
      requestCompactTextEditorAction({ kind: "open", target });
      return;
    }
    openCompactTextEditorNow(target);
  }

  function openCompactTextEditorNow(target: CompactTextEditorOpenTarget) {
    const holderId = `compact-text-editor-${++compactTextEditorCounterRef.current}`;
    const acquired = textEditors.acquire({
      rootId: target.rootId,
      path: target.path,
      fileName: target.fileName,
      text: target.text,
    }, { kind: "compact", id: holderId });
    commitCompactTextEditor({
      holderId,
      instanceId: acquired.session.id,
    });
    setCompactTextEditorUnsaved(null);
    setCompactTextEditorConflict(textEditorController.hasConflict(acquired.session)
      ? { instanceId: acquired.session.id, busy: null, error: null }
      : null);
    if (acquired.created) loadTextEditorSession(acquired.session);
  }

  function requestCompactTextEditorAction(action: CompactTextEditorPendingAction) {
    const view = compactTextEditorRef.current;
    if (!view) {
      performCompactTextEditorAction(action, null);
      return;
    }
    const session = textEditors.get(view.instanceId);
    if (!session) {
      commitCompactTextEditor(null);
      setCompactTextEditorConflict(null);
      setCompactTextEditorUnsaved(null);
      performCompactTextEditorAction(action, null);
      return;
    }
    const borrowed = textEditors.hasDesktopHolder(session.id);
    if (borrowed || !session.getSnapshot().dirty) {
      const restoreWindowId = borrowed
        ? windowsByMostRecent(windowStateRef.current).find(
          (window) => isTextEditorWindow(window) && window.instanceId === session.id,
        )?.id ?? null
        : null;
      releaseCompactTextEditor(view, false);
      performCompactTextEditorAction(action, restoreWindowId);
      return;
    }
    setCompactTextEditorUnsaved({
      instanceId: session.id,
      busy: false,
      error: null,
      pending: action,
    });
  }

  function releaseCompactTextEditor(view: CompactTextEditorView, discardDirty: boolean) {
    const session = textEditors.get(view.instanceId);
    if (session && textEditorController.hasConflict(session) && textEditors.hasDesktopHolder(session.id)) {
      showDesktopTextEditorConflict(session.id);
    }
    const released = textEditors.release(
      view.instanceId,
      { kind: "compact", id: view.holderId },
      { discardDirty },
    );
    if (released.blocked) return false;
    if (compactTextEditorRef.current?.holderId === view.holderId) commitCompactTextEditor(null);
    setCompactTextEditorConflict(null);
    setCompactTextEditorUnsaved(null);
    return true;
  }

  function performCompactTextEditorAction(
    action: CompactTextEditorPendingAction,
    restoreWindowId: string | null,
  ) {
    if (action.kind === "open") {
      openCompactTextEditorNow(action.target);
      return;
    }
    if (action.kind !== "switch-to-desktop") return;
    performWorkspaceModeSwitch("desktop");
    if (restoreWindowId) focusDesktopWindow(restoreWindowId);
  }

  function dismissCompactTextEditorUnsaved() {
    if (!compactTextEditorUnsaved?.busy) setCompactTextEditorUnsaved(null);
  }

  function discardCompactTextEditor() {
    const prompt = compactTextEditorUnsaved;
    const view = compactTextEditorRef.current;
    if (!prompt || prompt.busy || !view || view.instanceId !== prompt.instanceId) return;
    if (!releaseCompactTextEditor(view, true)) return;
    performCompactTextEditorAction(prompt.pending, null);
  }

  async function saveAndCloseCompactTextEditor(session: TextEditorSession) {
    const prompt = compactTextEditorUnsaved;
    const view = compactTextEditorRef.current;
    if (!prompt || prompt.busy || !view || prompt.instanceId !== session.id || view.instanceId !== session.id) return;
    setCompactTextEditorUnsaved({ ...prompt, busy: true, error: null });
    if (textEditorController.hasConflict(session)) {
      textEditorController.dismissConflict(session);
      clearTextEditorConflictPrompts(session.id);
    }
    const result = await textEditorController.save(session);
    if (result.kind === "saved") {
      requestVisibleRefresh();
      if (!session.getSnapshot().dirty && releaseCompactTextEditor(view, false)) {
        performCompactTextEditorAction(prompt.pending, null);
        return;
      }
    }
    if (result.kind === "conflict") {
      setCompactTextEditorUnsaved(null);
      setCompactTextEditorConflict({ instanceId: session.id, busy: null, error: null });
      return;
    }
    setCompactTextEditorUnsaved((current) => current?.instanceId === session.id
      ? {
        ...current,
        busy: false,
        error: result.kind === "failed" ? result.issue.message : null,
      }
      : current);
  }

  async function saveCompactTextEditor(session: TextEditorSession) {
    const result = await textEditorController.save(session);
    if (result.kind === "saved") {
      clearTextEditorConflictPrompts(session.id);
      requestVisibleRefresh();
      return;
    }
    if (result.kind === "conflict" && compactTextEditorRef.current?.instanceId === session.id) {
      setCompactTextEditorConflict({ instanceId: session.id, busy: null, error: null });
    }
  }

  function dismissCompactTextEditorConflict(session: TextEditorSession) {
    if (compactTextEditorConflict?.busy) return;
    textEditorController.dismissConflict(session);
    clearTextEditorConflictPrompts(session.id);
  }

  async function resolveCompactTextEditorConflict(
    session: TextEditorSession,
    action: TextEditorConflictAction,
  ) {
    const prompt = compactTextEditorConflict;
    if (!prompt || prompt.busy || prompt.instanceId !== session.id) return;
    setCompactTextEditorConflict({ ...prompt, busy: action, error: null });
    const result = action === "reload"
      ? await textEditorController.reload(session)
      : await textEditorController.forceSave(session);
    if (result.kind === "reloaded" || result.kind === "saved") {
      clearTextEditorConflictPrompts(session.id);
      requestVisibleRefresh();
      return;
    }
    setCompactTextEditorConflict((current) => current?.instanceId === session.id
      ? {
        ...current,
        busy: null,
        error: result.kind === "failed" ? result.issue.message : null,
      }
      : current);
  }

  function finalizeDesktopTextEditorClose(
    windowId: string,
    session: TextEditorSession,
    discardDirty: boolean,
  ) {
    const released = textEditors.release(
      session.id,
      { kind: "desktop", id: windowId },
      { discardDirty },
    );
    if (released.blocked) return false;
    setTextEditorUnsaved((current) => withoutKey(current, windowId));
    setTextEditorConflicts((current) => withoutKey(current, windowId));
    commitWindowState((current) => closeWindow(current, windowId));
    return true;
  }

  function dismissDesktopTextEditorUnsaved(windowId: string) {
    setTextEditorUnsaved((current) => current[windowId]?.busy ? current : withoutKey(current, windowId));
  }

  function discardAndCloseDesktopTextEditor(windowId: string, session: TextEditorSession) {
    const prompt = textEditorUnsaved[windowId];
    if (!prompt || prompt.busy || prompt.instanceId !== session.id) return;
    finalizeDesktopTextEditorClose(windowId, session, true);
  }

  async function saveAndCloseDesktopTextEditor(windowId: string, session: TextEditorSession) {
    const prompt = textEditorUnsaved[windowId];
    if (!prompt || prompt.busy || prompt.instanceId !== session.id) return;
    setTextEditorUnsaved((current) => ({
      ...current,
      [windowId]: { ...prompt, busy: true, error: null },
    }));
    if (textEditorController.hasConflict(session)) {
      textEditorController.dismissConflict(session);
      clearTextEditorConflictPrompts(session.id);
    }
    const result = await textEditorController.save(session);
    if (result.kind === "saved") {
      requestVisibleRefresh();
      if (!session.getSnapshot().dirty && finalizeDesktopTextEditorClose(windowId, session, false)) return;
    }
    if (result.kind === "conflict") {
      setTextEditorUnsaved((current) => withoutKey(current, windowId));
      setTextEditorConflicts((current) => ({
        ...current,
        [windowId]: { instanceId: session.id, busy: null, error: null },
      }));
      return;
    }
    setTextEditorUnsaved((current) => {
      const latest = current[windowId];
      if (!latest || latest.instanceId !== session.id) return current;
      return {
        ...current,
        [windowId]: {
          ...latest,
          busy: false,
          error: result.kind === "failed" ? result.issue.message : null,
        },
      };
    });
  }

  async function saveTextEditor(windowId: string, session: TextEditorSession) {
    const result = await textEditorController.save(session);
    handleTextEditorSaveResult(windowId, session, result);
  }

  function handleTextEditorSaveResult(
    windowId: string,
    session: TextEditorSession,
    result: TextEditorActionResult,
  ) {
    if (result.kind === "saved") {
      clearTextEditorConflictPrompts(session.id);
      requestVisibleRefresh();
      return;
    }
    if (result.kind === "conflict") {
      setTextEditorConflicts((current) => ({
        ...current,
        [windowId]: { instanceId: session.id, busy: null, error: null },
      }));
    }
  }

  function dismissTextEditorConflict(windowId: string, session: TextEditorSession) {
    const prompt = textEditorConflicts[windowId];
    if (prompt?.busy) return;
    textEditorController.dismissConflict(session);
    clearTextEditorConflictPrompts(session.id);
  }

  async function resolveTextEditorConflict(
    windowId: string,
    session: TextEditorSession,
    action: TextEditorConflictAction,
  ) {
    setTextEditorConflicts((current) => {
      const prompt = current[windowId];
      if (!prompt || prompt.busy || prompt.instanceId !== session.id) return current;
      return { ...current, [windowId]: { ...prompt, busy: action, error: null } };
    });
    const result = action === "reload"
      ? await textEditorController.reload(session)
      : await textEditorController.forceSave(session);
    if (result.kind === "reloaded" || result.kind === "saved") {
      clearTextEditorConflictPrompts(session.id);
      requestVisibleRefresh();
      return;
    }
    setTextEditorConflicts((current) => {
      const prompt = current[windowId];
      if (!prompt || prompt.instanceId !== session.id) return current;
      return {
        ...current,
        [windowId]: {
          ...prompt,
          busy: null,
          error: result.kind === "failed" ? result.issue.message : null,
        },
      };
    });
  }

  function showDesktopTextEditorConflict(instanceId: string) {
    setTextEditorConflicts((current) => {
      let next = current;
      for (const window of windowStateRef.current.windows) {
        if (!isTextEditorWindow(window) || window.instanceId !== instanceId || current[window.id]) continue;
        if (next === current) next = { ...current };
        next[window.id] = { instanceId, busy: null, error: null };
      }
      return next;
    });
  }

  function clearTextEditorConflictPrompts(instanceId: string) {
    setTextEditorConflicts((current) => withoutMatchingValue(current, (prompt) => prompt.instanceId === instanceId));
    setCompactTextEditorConflict((current) => current?.instanceId === instanceId ? null : current);
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

type SuperRenameApplicationWindowProps = Omit<
  ComponentProps<typeof WindowFrame>,
  "children" | "icon" | "closeDisabled"
> & {
  instance: SuperRenameInstance;
  onJobCreated(id: string): void;
  onGroupJobCreated(id: string): void;
};

function SuperRenameApplicationWindow({
  instance,
  onJobCreated,
  onGroupJobCreated,
  labels,
  ...frameProps
}: SuperRenameApplicationWindowProps) {
  const snapshot = useSyncExternalStore(
    instance.manager.subscribe,
    instance.manager.getSnapshot,
    instance.manager.getSnapshot,
  );
  return (
    <WindowFrame
      {...frameProps}
      labels={labels}
      icon={<WandSparkles aria-hidden="true" />}
      closeDisabled={snapshot.submitting || snapshot.submittingGroups.size > 0}
    >
      <div className="super-rename-window-layout" data-source-title={instance.sourceTitle}>
        <SuperRenameContent
          manager={instance.manager}
          labels={labels}
          onClose={frameProps.onClose}
          onJobCreated={onJobCreated}
          onGroupJobCreated={onGroupJobCreated}
        />
      </div>
    </WindowFrame>
  );
}

const pointerSensorOptions = { activationConstraint: { distance: 6 } } as const;

const fileCollisionDetection: CollisionDetection = (args) => {
  if (args.pointerCoordinates && applicationWindowCoversPoint(args.pointerCoordinates.x, args.pointerCoordinates.y)) {
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

function textEditorTitle(fileName: string, dirty: boolean) {
  return dirty ? `${fileName} *` : fileName;
}

function withoutKey<T>(record: Record<string, T>, key: string) {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

function withoutMatchingValue<T>(record: Record<string, T>, matches: (value: T) => boolean) {
  const entries = Object.entries(record).filter(([, value]) => !matches(value));
  return entries.length === Object.keys(record).length ? record : Object.fromEntries(entries);
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
