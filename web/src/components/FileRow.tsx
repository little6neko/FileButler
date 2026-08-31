import { memo, useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Link2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import type { Entry } from "../api/types";
import type { FileSelectionModifiers } from "../fileSelection";
import type { FileSelectionStore } from "../fileSelectionStore";
import { formatBytes } from "../format";
import { entryTypeLabel } from "../entryType";
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
  dropLayer?: number;
  dropWindowId?: string;
  dropDisabled?: boolean;
  rootId: string;
  parentPath: string;
  entry: Entry;
  isCut?: boolean;
  isLinkSource?: boolean;
  selectionStore: FileSelectionStore;
  dropFeedback: FileDropFeedback | null;
  labels: UIStrings;
  onToggleSelection(path: string): void;
  onSelect(path: string, modifiers: FileSelectionModifiers): void;
  onOpen(entry: Entry): void;
};

export const FileRow = memo(function FileRow({
  paneKey,
  dropLayer = 0,
  dropWindowId,
  dropDisabled = false,
  rootId,
  parentPath,
  entry,
  isCut = false,
  isLinkSource = false,
  selectionStore,
  dropFeedback,
  labels,
  onToggleSelection,
  onSelect,
  onOpen,
}: Props) {
  const suppressSelectionClickRef = useRef(false);
  const subscribeToSelection = useCallback(
    (listener: () => void) => selectionStore.subscribePath(entry.relativePath, listener),
    [entry.relativePath, selectionStore],
  );
  const getSelectionSnapshot = useCallback(
    () => selectionStore.isSelected(entry.relativePath),
    [entry.relativePath, selectionStore],
  );
  const selected = useSyncExternalStore(subscribeToSelection, getSelectionSnapshot, getSelectionSnapshot);
  const dragData = useMemo<FileDragData>(() => ({
    kind: "file-entry",
    pane: paneKey,
    rootId,
    parentPath,
    entry,
  }), [entry, paneKey, parentPath, rootId]);
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
    disabled: dropDisabled,
  });
  const directoryTarget = useMemo<FileDropData>(() => ({
    id: directoryDropId(paneKey, entry.relativePath),
    kind: "directory",
    pane: paneKey,
    rootId,
    path: entry.relativePath,
    label: entry.name,
    layer: dropLayer,
    windowId: dropWindowId,
  }), [dropLayer, dropWindowId, entry.name, entry.relativePath, paneKey, rootId]);
  const drop = useDroppable({
    id: directoryTarget.id,
    data: directoryTarget,
    disabled: dropDisabled || entry.type !== "directory",
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
      data-clipboard-cut={isCut ? "true" : undefined}
      data-link-source={isLinkSource ? "true" : undefined}
      data-drop-kind={entry.type === "directory" ? "directory" : undefined}
      data-drop-window-id={dropWindowId}
      data-drop-disabled={dropDisabled ? "true" : undefined}
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
          {isLinkSource ? (
            <span className="file-link-source-marker" aria-label={labels.linkSourceEntry(entry.name)} title={labels.linkSourceEntry(entry.name)}>
              <Link2 aria-hidden="true" />
            </span>
          ) : null}
        </span>
      </td>
      <td>{entryTypeLabel(entry, labels)}</td>
      <td>{formatBytes(entry.size)}</td>
      <td>{entry.modifiedUnix ? new Date(entry.modifiedUnix * 1000).toLocaleString() : ""}</td>
    </tr>
  );
});
