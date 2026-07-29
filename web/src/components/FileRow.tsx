import { useCallback, useLayoutEffect, useRef } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Checkbox } from "@/components/ui/checkbox";
import type { Entry } from "../api/types";
import type { FileSelectionModifiers } from "../fileSelection";
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
  onSelect(path: string, modifiers: FileSelectionModifiers): void;
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
  onSelect,
  onOpen,
}: Props) {
  const suppressSelectionClickRef = useRef(false);
  const {
    attributes: dragAttributes,
    isDragging,
    listeners: dragListeners,
    setActivatorNodeRef,
    setNodeRef: setDragNodeRef,
  } = useDraggable({
    id: fileDragId(paneKey, entry.relativePath),
    data: dragData,
    attributes: { role: "button", tabIndex: -1 },
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
  const setDropNodeRef = drop.setNodeRef;
  const setNodeRef = useCallback((node: HTMLTableRowElement | null) => {
    setDragNodeRef(node);
    setDropNodeRef(node);
  }, [setDragNodeRef, setDropNodeRef]);
  const feedback = dropFeedback?.target.id === directoryTarget.id ? dropFeedback : null;

  useLayoutEffect(() => {
    if (isDragging) {
      suppressSelectionClickRef.current = true;
      return;
    }
    if (!suppressSelectionClickRef.current) return;
    const timeout = window.setTimeout(() => {
      suppressSelectionClickRef.current = false;
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [isDragging]);

  return (
    <tr
      ref={setNodeRef}
      role="row"
      data-entry-path={entry.relativePath}
      data-density="compact"
      data-file-drag-source="true"
      data-dragging={isDragging ? "true" : "false"}
      data-drop-kind={entry.type === "directory" ? "directory" : undefined}
      data-drop-state={feedback ? (feedback.valid ? "valid" : "invalid") : undefined}
      aria-selected={selected}
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
        <span className="file-name-content">
          <span
            ref={setActivatorNodeRef}
            {...dragAttributes}
            {...dragListeners}
            className="file-drag-handle"
            data-file-drag-handle="true"
            onClick={(event) => {
              if (suppressSelectionClickRef.current) {
                suppressSelectionClickRef.current = false;
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              onSelect(entry.relativePath, { ctrlKey: event.ctrlKey, shiftKey: event.shiftKey });
            }}
          >
            <FileIcon name={entry.name} type={entry.type} />
            <span className="truncate font-medium text-slate-700">{entry.name}</span>
          </span>
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
