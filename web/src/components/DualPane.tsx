import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Entry, OpsRequest, Root } from "../api/types";
import { FilePane } from "./FilePane";
import { JobsPanel } from "./JobsPanel";
import { OperationPreview } from "./OperationPreview";

type PaneKey = "left" | "right";

type PaneState = {
  rootId: string;
  path: string;
  entries: Entry[];
  selected: Set<string>;
};

export function DualPane() {
  const [roots, setRoots] = useState<Root[]>([]);
  const [activePane, setActivePane] = useState<PaneKey>("left");
  const [previewRequest, setPreviewRequest] = useState<OpsRequest | null>(null);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [left, setLeft] = useState<PaneState>({ rootId: "", path: ".", entries: [], selected: new Set() });
  const [right, setRight] = useState<PaneState>({ rootId: "", path: ".", entries: [], selected: new Set() });

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
    updatePane(which, (pane) => ({ ...pane, entries }));
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
        updatePane(which, (current) => ({ ...current, rootId, path: ".", selected: new Set() })),
      onPathChange: (path: string) =>
        updatePane(which, (current) => ({ ...current, path, selected: new Set() })),
      onToggleSelection: (path: string) =>
        updatePane(which, (current) => {
          const selected = new Set(current.selected);
          if (selected.has(path)) selected.delete(path);
          else selected.add(path);
          return { ...current, selected };
        }),
      onClearSelection: () => updatePane(which, (current) => ({ ...current, selected: new Set() })),
      onRefresh: () => {
        if (pane.rootId) void loadPane(which, pane.rootId, pane.path);
      },
      onActivate: () => setActivePane(which),
    };
  }

  return (
    <>
      <div className="workspace-toolbar">
        {(["move", "copy", "symlink", "hardlink", "delete"] as const).map((type) => (
          <button key={type} type="button" onClick={() => openOperation(type)} disabled={!activeSelection().length}>
            {type}
          </button>
        ))}
        <button type="button" onClick={openMkdir}>
          mkdir
        </button>
        <button type="button" onClick={() => setJobsOpen((value) => !value)}>
          Jobs
        </button>
      </div>
      <section className="workspace" data-active-pane={activePane}>
        <FilePane title="Left pane" {...paneProps("left", left)} />
        <div className="pane-divider" aria-hidden="true" />
        <FilePane title="Right pane" {...paneProps("right", right)} />
      </section>
      {previewRequest ? (
        <OperationPreview
          request={previewRequest}
          onClose={() => setPreviewRequest(null)}
          onJobCreated={() => {
            setPreviewRequest(null);
            setJobsOpen(true);
          }}
        />
      ) : null}
      <JobsPanel open={jobsOpen} />
    </>
  );

  function activeState() {
    return activePane === "left" ? left : right;
  }

  function oppositeState() {
    return activePane === "left" ? right : left;
  }

  function activeSelection() {
    return Array.from(activeState().selected);
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
    const name = window.prompt("Directory name");
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
