import type { Announcements } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import {
  buildFileDragSource,
  isFileDragData,
  isFileDropData,
  type FileDragSource,
  type FileDropFeedback,
} from "../fileDrag";
import type { UIStrings } from "../i18n";
import { FileIcon } from "./FileIcon";

export function FileDragOverlay({
  source,
  feedback,
  labels,
}: {
  source: FileDragSource;
  feedback: FileDropFeedback | null;
  labels: UIStrings;
}) {
  const first = source.entries[0];
  if (!first) return null;
  return (
    <div
      className="file-drag-overlay"
      data-drop-state={feedback ? (feedback.valid ? "valid" : "invalid") : undefined}
      aria-hidden="true"
    >
      <FileIcon name={first.name} type={first.type} />
      <span className="min-w-0">
        <strong>{labels.dragSummary(first.name, source.entries.length)}</strong>
        {feedback ? <small>{labels.dragDestination(feedback.operation, feedback.target.label)}</small> : null}
      </span>
      {source.entries.length > 1 ? (
        <Badge aria-label={labels.selectionSummary(source.entries.length)}>{source.entries.length}</Badge>
      ) : null}
    </div>
  );
}

export function createFileDragAnnouncements(labels: UIStrings): Announcements {
  return {
    onDragStart({ active }) {
      const data = active.data.current;
      if (!isFileDragData(data)) return undefined;
      const source = buildFileDragSource(data);
      return labels.dragStarted(source.entries[0]?.name ?? data.entry.name, source.entries.length);
    },
    onDragOver({ over }) {
      const target = over?.data.current;
      return isFileDropData(target) ? labels.dragOver(target.label) : undefined;
    },
    onDragEnd({ over }) {
      const target = over?.data.current;
      return isFileDropData(target) ? labels.dragDropped(target.label) : labels.dragCanceled;
    },
    onDragCancel() {
      return labels.dragCanceled;
    },
  };
}
