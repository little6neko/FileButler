import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Entry, OpsRequest, Root } from "../api/types";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";
import { FilePane } from "./FilePane";
import { JobsPanel } from "./JobsPanel";
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
};

export function DualPane({ labels = strings.en }: { labels?: UIStrings }) {
  const [roots, setRoots] = useState<Root[]>([]);
  const [activePane, setActivePane] = useState<PaneKey>("left");
  const [previewRequest, setPreviewRequest] = useState<OpsRequest | null>(null);
  const [singleRenameOpen, setSingleRenameOpen] = useState(false);
  const [powerRenameOpen, setPowerRenameOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [left, setLeft] = useState<PaneState>({ rootId: "", path: ".", entries: [], selected: new Set(), visibleOrder: [] });
  const [right, setRight] = useState<PaneState>({ rootId: "", path: ".", entries: [], selected: new Set(), visibleOrder: [] });

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
  }, [left.rootId, left.path]);

  useEffect(() => {
    if (right.rootId) void loadPane("right", right.rootId, right.path);
  }, [right.rootId, right.path]);

  async function loadPane(which: PaneKey, rootId: string, path: string) {
    const entries = await api.browse(rootId, path);
    updatePane(which, (pane) => ({ ...pane, entries, visibleOrder: entries.map((entry) => entry.relativePath) }));
  }

  function updatePane(which: PaneKey, update: (pane: PaneState) => PaneState) {
    if (which === "left") setLeft(update);
    else setRight(update);
  }

  function paneProps(which: PaneKey, pane: PaneState) {
    return {
      roots,
      selectedRootId: pane.rootId,
      currentPath: pane.path,
      entries: pane.entries,
      selectedPaths: pane.selected,
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
      onVisibleOrderChange: (visibleOrder: string[]) =>
        updatePane(which, (current) => {
          if (sameStringArray(current.visibleOrder, visibleOrder)) return current;
          return { ...current, visibleOrder };
        }),
      onRefresh: () => {
        if (pane.rootId) void loadPane(which, pane.rootId, pane.path);
      },
      onActivate: () => setActivePane(which),
      isActive: activePane === which,
    };
  }

  return (
    <>
      <div className="workspace-toolbar">
        {(["move", "copy", "symlink", "hardlink", "delete"] as const).map((type) => (
          <button key={type} type="button" onClick={() => openOperation(type)} disabled={!activeSelection().length}>
            {labels[type]}
          </button>
        ))}
        <button type="button" onClick={openMkdir}>
          {labels.mkdir}
        </button>
        <button type="button" onClick={() => setSingleRenameOpen(true)} disabled={activeSelection().length !== 1}>
          {labels.rename}
        </button>
        <button type="button" onClick={() => setPowerRenameOpen(true)} disabled={!activeSelection().length}>
          {labels.powerRename}
        </button>
        <button type="button" onClick={() => setJobsOpen((value) => !value)}>
          {labels.jobs}
        </button>
      </div>
      <section className="workspace" data-testid="workspace" data-active-pane={activePane}>
        <FilePane title={labels.leftPane} labels={labels} {...paneProps("left", left)} />
        <div className="pane-divider" aria-hidden="true" />
        <FilePane title={labels.rightPane} labels={labels} {...paneProps("right", right)} />
      </section>
      {previewRequest ? (
        <OperationPreview
          request={previewRequest}
          labels={labels}
          onClose={() => setPreviewRequest(null)}
          onJobCreated={() => {
            setPreviewRequest(null);
            setJobsOpen(true);
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
          onJobCreated={() => {
            setSingleRenameOpen(false);
            setJobsOpen(true);
          }}
        />
      ) : null}
      {powerRenameOpen ? (
        <RenameDialog
          rootId={activeState().rootId}
          paths={activeSelection()}
          labels={labels}
          onClose={() => setPowerRenameOpen(false)}
          onJobCreated={() => {
            setPowerRenameOpen(false);
            setJobsOpen(true);
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
    const source = activeState();
    const name = window.prompt(labels.directoryNamePrompt);
    if (!name) return;
    setPreviewRequest({
      type: "mkdir",
      sourceRoot: source.rootId,
      sources: [],
      destRoot: source.rootId,
      destPath: source.path,
      newName: name,
    });
  }
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
