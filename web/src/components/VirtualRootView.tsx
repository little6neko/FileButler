import { useDroppable } from "@dnd-kit/core";
import { useCallback } from "react";
import { HardDrive } from "lucide-react";
import type { Root } from "../api/types";
import type { FileDropData, FileDropFeedback } from "../fileDrag";
import type { UIStrings } from "../i18n";
import type { FileAction } from "./fileActions";
import { PaneContextMenu } from "./PaneContextMenu";

export function VirtualRootView({
  roots,
  surfaceId,
  dropFeedback,
  labels,
  onActivate,
  onOpenRoot,
  actionsForRoot,
  dropLayer = 0,
}: {
  roots: Root[];
  surfaceId: string;
  dropFeedback: FileDropFeedback | null;
  labels: UIStrings;
  onActivate(): void;
  onOpenRoot(root: Root): void;
  actionsForRoot(root: Root): FileAction[];
  dropLayer?: number;
}) {
  return (
    <section className="virtual-root" aria-label={labels.allLocations} onPointerDown={onActivate}>
      <header>
        <div>
          <strong>{labels.allLocations}</strong>
          <span>{labels.mappedLocations}</span>
        </div>
      </header>
      {roots.length === 0 ? (
        <div className="virtual-root-empty">{labels.noMappedRoots}</div>
      ) : (
        <div className="virtual-root-grid">
          {roots.map((root) => (
            <RootCard
              key={root.id}
              root={root}
              surfaceId={surfaceId}
              dropFeedback={dropFeedback}
              labels={labels}
              onOpen={() => onOpenRoot(root)}
              actions={actionsForRoot(root)}
              dropLayer={dropLayer}
            />
          ))}
        </div>
      )}
      <footer>{roots.length} {labels.mappedLocations.toLowerCase()}</footer>
    </section>
  );
}

function RootCard({
  root,
  surfaceId,
  dropFeedback,
  labels,
  onOpen,
  actions,
  dropLayer,
}: {
  root: Root;
  surfaceId: string;
  dropFeedback: FileDropFeedback | null;
  labels: UIStrings;
  onOpen(): void;
  actions: FileAction[];
  dropLayer: number;
}) {
  const target: FileDropData = {
    id: `drop:${surfaceId}:root:${encodeURIComponent(root.id)}`,
    kind: "current-directory",
    pane: surfaceId,
    rootId: root.id,
    path: ".",
    label: root.name,
    layer: dropLayer,
  };
  const drop = useDroppable({ id: target.id, data: target });
  const setDropNodeRef = drop.setNodeRef;
  const setRootCardNode = useCallback((node: HTMLButtonElement | null) => {
    setDropNodeRef(node);
  }, [setDropNodeRef]);
  const feedback = dropFeedback?.target.id === target.id ? dropFeedback : null;
  return (
    <PaneContextMenu actions={actions} label={labels.fileActions}>
      <button
        ref={setRootCardNode}
        type="button"
        className="virtual-root-card"
        data-drop-state={feedback ? (feedback.valid ? "valid" : "invalid") : undefined}
        onClick={(event) => {
          if (event.detail === 0) onOpen();
        }}
        onDoubleClick={onOpen}
      >
        <span className="virtual-root-icon"><HardDrive aria-hidden="true" /></span>
        <span><strong>{root.name}</strong><small>/</small></span>
      </button>
    </PaneContextMenu>
  );
}
