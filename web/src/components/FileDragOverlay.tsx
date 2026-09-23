import { Badge } from "@/components/ui/badge";
import type { FileDragSource, FileDropFeedback } from "../fileDrag";
import { strings, type UIStrings } from "../i18n";
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
        {feedback ? <small>{feedback.transfer ? `${labels === strings["zh-CN"] ? (feedback.transfer === "download" ? "下载到" : "上传到") : (feedback.transfer === "download" ? "Download to" : "Upload to")} ${feedback.target.label}` : labels.dragDestination(feedback.operation, feedback.target.label)}</small> : null}
      </span>
      {source.entries.length > 1 ? (
        <Badge aria-label={labels.selectionSummary(source.entries.length)}>{source.entries.length}</Badge>
      ) : null}
    </div>
  );
}
