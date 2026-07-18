import type { UIStrings } from "../i18n";
import { formatBytes } from "../format";

export function PaneStatusBar({
  selectedCount,
  selectedBytes,
  visibleCount,
  labels,
}: {
  selectedCount: number;
  selectedBytes: number;
  visibleCount: number;
  labels: UIStrings;
}) {
  return (
    <footer className="flex h-7 items-center gap-3 border-t bg-slate-50 px-2 text-[11px] text-slate-500">
      <span className="font-medium text-slate-700">{selectedCount ? labels.selectedItems(selectedCount) : labels.noSelection}</span>
      {selectedCount ? <span>{formatBytes(selectedBytes)}</span> : null}
      <span className="ml-auto">{labels.visibleItems(visibleCount)}</span>
    </footer>
  );
}
