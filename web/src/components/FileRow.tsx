import { useCallback } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Checkbox } from "@/components/ui/checkbox";
import type { Entry } from "../api/types";
import { formatBytes } from "../format";
import type { UIStrings } from "../i18n";
import {
  directoryDropId,
  fileDragId,
  type FileDragData,
  type FileDropData,
  type FileDropFeedback,
  type PaneKey,
} from "../fileDrag";
import { FileIcon } from "./FileIcon";

type Props = {
  paneKey: PaneKey;
  rootId: string;
  entry: Entry;
  selected: boolean;
  dragData: FileDragData;
  dropFeedback: FileDropFeedback | null;
  labels: UIStrings;
  onToggleSelection(path: string): void;
  onOpen(entry: Entry): void;
};

export function FileRow({
  paneKey,
  rootId,
  entry,
  selected,
  dragData,
  dropFeedback,
  labels,
  onToggleSelection,
  onOpen,
}: Props) {
  const drag = useDraggable({
    id: fileDragId(paneKey, entry.relativePath),
    data: dragData,
    attributes: { role: "row", tabIndex: -1 },
  });
  const directoryTarget: FileDropData = {
    id: directoryDropId(paneKey, entry.relativePath),
    kind: "directory",
    pane: paneKey,
    rootId,
    path: entry.relativePath,
    label: entry.name,
  };
  const drop = useDroppable({
    id: directoryTarget.id,
    data: directoryTarget,
    disabled: entry.type !== "directory",
  });
  const setNodeRef = useCallback((node: HTMLTableRowElement | null) => {
    drag.setNodeRef(node);
    drop.setNodeRef(node);
  }, [drag.setNodeRef, drop.setNodeRef]);
  const feedback = dropFeedback?.target.id === directoryTarget.id ? dropFeedback : null;

  return (
    <tr
      ref={setNodeRef}
      {...drag.attributes}
      {...drag.listeners}
      role="row"
      data-entry-path={entry.relativePath}
      data-density="compact"
      data-file-drag-source="true"
      data-dragging={drag.isDragging ? "true" : "false"}
      data-drop-kind={entry.type === "directory" ? "directory" : undefined}
      data-drop-state={feedback ? (feedback.valid ? "valid" : "invalid") : undefined}
      className={entry.type === "directory" ? "directory-row" : undefined}
      onDoubleClick={() => onOpen(entry)}
    >
      <td className="select-cell">
        <Checkbox
          aria-label={labels.selectEntry(entry.name)}
          checked={selected}
          onPointerDown={(event) => event.stopPropagation()}
          onCheckedChange={() => onToggleSelection(entry.relativePath)}
        />
      </td>
      <td>
        <span className="flex min-w-0 items-center gap-1.5">
          <FileIcon name={entry.name} type={entry.type} />
          <span className="truncate font-medium text-slate-700">{entry.name}</span>
          {entry.isSymlink && entry.symlinkTarget ? (
            <small className="truncate text-slate-400">{" -> "}{entry.symlinkTarget}</small>
          ) : null}
        </span>
      </td>
      <td>{entry.type}</td>
      <td>{formatBytes(entry.size)}</td>
      <td>{entry.modifiedUnix ? new Date(entry.modifiedUnix * 1000).toLocaleString() : ""}</td>
    </tr>
  );
}
