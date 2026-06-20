import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Entry, Root } from "../api/types";
import { FilePane } from "./FilePane";

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
    <section className="workspace" data-active-pane={activePane}>
      <FilePane title="Left pane" {...paneProps("left", left)} />
      <div className="pane-divider" aria-hidden="true" />
      <FilePane title="Right pane" {...paneProps("right", right)} />
    </section>
  );
}
