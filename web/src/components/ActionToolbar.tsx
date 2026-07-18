import { Copy, FolderPlus, Link, Link2, MoveRight, Pencil, ScanText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { OpsRequest } from "../api/types";
import type { UIStrings } from "../i18n";

export type PaneSide = "left" | "right";

type Props = {
  activePane: PaneSide;
  selectedCount: number;
  labels: UIStrings;
  onOperation(type: OpsRequest["type"]): void;
  onMkdir(): void;
  onRename(): void;
  onPowerRename(): void;
};

export function ActionToolbar({ activePane, selectedCount, labels, onOperation, onMkdir, onRename, onPowerRename }: Props) {
  const destination = activePane === "left" ? labels.rightPane : labels.leftPane;
  const hasSelection = selectedCount > 0;

  return (
    <nav aria-label="File actions" className="flex h-[42px] items-center gap-1.5 border-b bg-slate-50 px-3">
      <Button size="sm" aria-label={labels.copyToPane(destination)} onClick={() => onOperation("copy")} disabled={!hasSelection}>
        <Copy /><span className="action-label">{labels.copyToPane(destination)}</span>
      </Button>
      <Button size="sm" variant="outline" aria-label={labels.moveToPane(destination)} onClick={() => onOperation("move")} disabled={!hasSelection}>
        <MoveRight /><span className="action-label">{labels.moveToPane(destination)}</span>
      </Button>
      <Button size="sm" variant="outline" aria-label={labels.symlink} onClick={() => onOperation("symlink")} disabled={!hasSelection}>
        <Link /><span className="action-label">{labels.symlink}</span>
      </Button>
      <Button size="sm" variant="outline" aria-label={labels.hardlink} onClick={() => onOperation("hardlink")} disabled={!hasSelection}>
        <Link2 /><span className="action-label">{labels.hardlink}</span>
      </Button>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Button size="sm" variant="outline" aria-label={labels.mkdir} onClick={onMkdir}>
        <FolderPlus /><span className="action-label">{labels.mkdir}</span>
      </Button>
      <Button size="sm" variant="outline" aria-label={labels.rename} onClick={onRename} disabled={selectedCount !== 1}>
        <Pencil /><span className="action-label">{labels.rename}</span>
      </Button>
      <Button size="sm" variant="outline" aria-label={labels.powerRename} onClick={onPowerRename} disabled={!hasSelection}>
        <ScanText /><span className="action-label">{labels.powerRename}</span>
      </Button>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Button size="sm" variant="ghost" aria-label={labels.delete} className="text-destructive hover:text-destructive" onClick={() => onOperation("delete")} disabled={!hasSelection}>
        <Trash2 /><span className="action-label">{labels.delete}</span>
      </Button>
      <span className="ml-auto text-xs text-slate-500">{labels.selectionSummary(selectedCount)}</span>
    </nav>
  );
}
