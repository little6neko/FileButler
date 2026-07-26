import type { Announcements } from "@dnd-kit/core";
import { buildFileDragSource, isFileDragData, isFileDropData } from "../fileDrag";
import type { UIStrings } from "../i18n";

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
