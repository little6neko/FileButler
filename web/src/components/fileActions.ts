import {
  Copy,
  FolderPlus,
  Link,
  Link2,
  MoveRight,
  Pencil,
  ScanText,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { OpsRequest } from "../api/types";
import type { UIStrings } from "../i18n";

export type FileActionId = "copy" | "move" | "symlink" | "hardlink" | "mkdir" | "rename" | "powerRename" | "delete";
export type CommandOperation = Exclude<OpsRequest["type"], "mkdir">;

export type FileAction = {
  id: FileActionId;
  label: string;
  icon: LucideIcon;
  disabled: boolean;
  separatorBefore?: boolean;
  destructive?: boolean;
  run(): void;
};

export type FileActionCommands = {
  onOperation(type: CommandOperation): void;
  onMkdir(): void;
  onRename(): void;
  onPowerRename(): void;
};

export function createFileActions({
  destination,
  selectedCount,
  labels,
  commands,
}: {
  destination: string;
  selectedCount: number;
  labels: UIStrings;
  commands: FileActionCommands;
}): FileAction[] {
  const noSelection = selectedCount === 0;
  return [
    { id: "copy", label: labels.copyToPane(destination), icon: Copy, disabled: noSelection, run: () => commands.onOperation("copy") },
    { id: "move", label: labels.moveToPane(destination), icon: MoveRight, disabled: noSelection, run: () => commands.onOperation("move") },
    { id: "symlink", label: labels.symlink, icon: Link, disabled: noSelection, run: () => commands.onOperation("symlink") },
    { id: "hardlink", label: labels.hardlink, icon: Link2, disabled: noSelection, run: () => commands.onOperation("hardlink") },
    { id: "mkdir", label: labels.mkdir, icon: FolderPlus, disabled: false, separatorBefore: true, run: commands.onMkdir },
    { id: "rename", label: labels.rename, icon: Pencil, disabled: selectedCount !== 1, run: commands.onRename },
    { id: "powerRename", label: labels.powerRename, icon: ScanText, disabled: noSelection, run: commands.onPowerRename },
    { id: "delete", label: labels.delete, icon: Trash2, disabled: noSelection, separatorBefore: true, destructive: true, run: () => commands.onOperation("delete") },
  ];
}
