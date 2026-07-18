import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { api } from "../api/client";
import type { Entry, OpsRequest, RenameOptions, Root } from "../api/types";
import { strings } from "../i18n";
import type { LanguageMode, UIStrings } from "../i18n";
import { mediaKindForPath } from "../media";
import type { MediaKind } from "../media";
import { ActionToolbar } from "./ActionToolbar";
import { AppShell } from "./AppShell";
import { FilePane } from "./FilePane";
import { JobsPanel } from "./JobsPanel";
import { LanguageSelect } from "./LanguageSelect";
import { MediaPreview } from "./MediaPreview";
import { MkdirDialog } from "./MkdirDialog";
import { OperationPreview } from "./OperationPreview";
import { RenameDialog } from "./RenameDialog";
import { SingleRenameDialog } from "./SingleRenameDialog";

type PaneKey = "left" | "right";

type PaneState = {
  rootId: string;
  path: string;
  entries: Entry[];
  selected: Set<string>;
  visibleOrder: string[];
  loading: boolean;
  error: string | null;
};

type MediaPreviewState = {
  name: string;
  url: string;
  kind: MediaKind;
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
  const [previewRequest, setPreviewRequest] = useState<OpsRequest | null>(null);
  const [mediaPreview, setMediaPreview] = useState<MediaPreviewState | null>(null);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [singleRenameOpen, setSingleRenameOpen] = useState(false);
  const [powerRenameOpen, setPowerRenameOpen] = useState(false);
  const [powerRenameOptions, setPowerRenameOptions] = useState<RenameOptions | undefined>();
  const [jobsOpen, setJobsOpen] = useState(false);
  const [activeJobCount] = useState(0);
  const [leftPanePercent, setLeftPanePercent] = useState(50);
  const [left, setLeft] = useState<PaneState>({ rootId: "", path: ".", entries: [], selected: new Set(), visibleOrder: [], loading: false, error: null });
  const [right, setRight] = useState<PaneState>({ rootId: "", path: ".", entries: [], selected: new Set(), visibleOrder: [], loading: false, error: null });

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
        visibleOrder: entries.map((entry) => entry.relativePath),
        loading: false,
        error: null,
      }));
    } catch (err) {
      updatePane(which, (pane) => ({
        ...pane,
        entries: [],
        selected: new Set(),
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
    setJobsOpen(true);
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
    setLeft((pane) => (pane.selected.size ? { ...pane, selected: new Set() } : pane));
    setRight((pane) => (pane.selected.size ? { ...pane, selected: new Set() } : pane));
  }

  function paneProps(which: PaneKey, pane: PaneState) {
    return {
      roots,
      selectedRootId: pane.rootId,
      currentPath: pane.path,
      entries: pane.entries,
      selectedPaths: pane.selected,
      loading: pane.loading,
      error: pane.error,
      onRootChange: (rootId: string) =>
        updatePane(which, (current) => ({ ...current, rootId, path: ".", selected: new Set(), visibleOrder: [] })),
      onPathChange: (path: string) =>
        updatePane(which, (current) => ({ ...current, path, selected: new Set(), visibleOrder: [] })),
      onToggleSelection: (path: string) =>
        updatePane(which, (current) => {
          const selected = new Set(current.selected);
          if (selected.has(path)) selected.delete(path);
          else selected.add(path);
          return { ...current, selected };
        }),
      onSelectAll: (checked: boolean) =>
        updatePane(which, (current) => ({
          ...current,
          selected: checked ? new Set(current.entries.map((entry) => entry.relativePath)) : new Set(),
        })),
      onSelectPaths: (paths: string[]) =>
        updatePane(which, (current) => ({
          ...current,
          selected: new Set(paths),
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

  return (
    <>
      <AppShell
        labels={labels}
        activeJobCount={activeJobCount}
        onJobsOpen={() => setJobsOpen(true)}
        languageControl={<LanguageSelect value={languageMode} onChange={onLanguageModeChange} labels={labels} />}
      >
        <div className="grid h-full min-h-0 grid-rows-[42px_minmax(0,1fr)] overflow-hidden">
          <ActionToolbar
            activePane={activePane}
            selectedCount={activeSelection().length}
            labels={labels}
            onOperation={openOperation}
            onMkdir={openMkdir}
            onRename={() => setSingleRenameOpen(true)}
            onPowerRename={() => setPowerRenameOpen(true)}
          />
          <section
            className="workspace"
            data-testid="workspace"
            data-active-pane={activePane}
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
      {previewRequest ? (
        <OperationPreview
          request={previewRequest}
          labels={labels}
          onClose={() => setPreviewRequest(null)}
          onJobCreated={(id) => {
            setPreviewRequest(null);
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
      <JobsPanel open={jobsOpen} labels={labels} />
    </>
  );

  function activeState() {
    return activePane === "left" ? left : right;
  }

  function oppositeState() {
    return activePane === "left" ? right : left;
  }

  function activeSelection() {
    const state = activeState();
    const ordered = state.visibleOrder.filter((path) => state.selected.has(path));
    const visible = new Set(state.visibleOrder);
    const remaining = Array.from(state.selected).filter((path) => !visible.has(path));
    return [...ordered, ...remaining];
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

  function openOperation(type: OpsRequest["type"]) {
    const source = activeState();
    const dest = oppositeState();
    setPreviewRequest({
      type,
      sourceRoot: source.rootId,
      sources: activeSelection(),
      destRoot: type === "delete" ? undefined : dest.rootId,
      destPath: type === "delete" ? undefined : dest.path,
    });
  }

  function openMkdir() {
    setMkdirOpen(true);
  }

  function createMkdirPreview(name: string) {
    const source = activeState();
    setPreviewRequest({
      type: "mkdir",
      sourceRoot: source.rootId,
      sources: [],
      destRoot: source.rootId,
      destPath: source.path,
      newName: name,
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

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function visibleSelection(selected: Set<string>, entries: Entry[]) {
  if (!selected.size) return selected;
  const visiblePaths = new Set(entries.map((entry) => entry.relativePath));
  const next = new Set(Array.from(selected).filter((path) => visiblePaths.has(path)));
  return next.size === selected.size ? selected : next;
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
