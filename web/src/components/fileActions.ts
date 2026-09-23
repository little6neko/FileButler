import {
  ClipboardPaste,
  Combine,
  Copy,
  ExternalLink,
  FolderPlus,
  Link,
  Link2,
  MoveLeft,
  MoveRight,
  Pencil,
  ScanText,
  Scissors,
  Trash2,
  Unlink,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import type { LinkType, OpsRequest } from "../api/types";
import type { UIStrings } from "../i18n";

export type FileActionId =
  | "details"
  | "offline"
  | "extract"
  | "logout"
  | "copy"
  | "clipboardCopy"
  | "clipboardCut"
  | "clipboardPaste"
  | "move"
  | "symlink"
  | "hardlink"
  | "selectLinkSource"
  | "cancelLinkSource"
  | "mkdir"
  | "rename"
  | "powerRename"
  | "superRename"
  | "delete"
  | "openInNewWindow";
export type CommandOperation = Exclude<OpsRequest["type"], "mkdir">;

export type FileAction = {
  kind: "command";
  id: FileActionId;
  label: string;
  icon: LucideIcon;
  disabled: boolean;
  separatorBefore?: boolean;
  destructive?: boolean;
  run(): void;
};

export type FileSubmenuAction = {
  kind: "submenu";
  id: string;
  label: string;
  icon: LucideIcon;
  disabled: boolean;
  separatorBefore?: boolean;
  items: FileAction[];
};

export type FileContextAction = FileAction | FileSubmenuAction;

export type LinkSourceActionCommands = {
  onSelectSource(): void;
  onCancelSource(): void;
  onCreate(type: "hardlink" | "symlink"): void;
};

export type FileActionCommands = {
  onOperation(type: CommandOperation): void;
  onLink(type: LinkType): void;
  onMkdir(): void;
  onRename(): void;
  onPowerRename(): void;
  onSuperRename(): void;
};

export function createFileActions({
  destination,
  destinationDirection,
  selectedCount,
  locationReady = true,
  labels,
  commands,
}: {
  destination: string;
  destinationDirection: "left" | "right";
  selectedCount: number;
  locationReady?: boolean;
  labels: UIStrings;
  commands: FileActionCommands;
}): FileAction[] {
  const noSelection = selectedCount === 0;
  return [
    { kind: "command", id: "copy", label: labels.copyToPane(destination), icon: Copy, disabled: noSelection, run: () => commands.onOperation("copy") },
    {
      kind: "command",
      id: "move",
      label: labels.moveToPane(destination),
      icon: destinationDirection === "left" ? MoveLeft : MoveRight,
      disabled: noSelection,
      run: () => commands.onOperation("move"),
    },
    { kind: "command", id: "symlink", label: labels.symlink, icon: Link, disabled: noSelection, run: () => commands.onLink("symlink") },
    { kind: "command", id: "hardlink", label: labels.hardlink, icon: Link2, disabled: noSelection, run: () => commands.onLink("hardlink") },
    { kind: "command", id: "rename", label: labels.rename, icon: Pencil, disabled: selectedCount !== 1, separatorBefore: true, run: commands.onRename },
    { kind: "command", id: "powerRename", label: labels.powerRename, icon: ScanText, disabled: noSelection, run: commands.onPowerRename },
    { kind: "command", id: "superRename", label: labels.superRename, icon: WandSparkles, disabled: !locationReady, run: commands.onSuperRename },
    { kind: "command", id: "mkdir", label: labels.mkdir, icon: FolderPlus, disabled: false, run: commands.onMkdir },
    { kind: "command", id: "delete", label: labels.delete, icon: Trash2, disabled: noSelection, separatorBefore: true, destructive: true, run: () => commands.onOperation("delete") },
  ];
}

export function createWindowFileActions({
  selectedCount,
  locationReady,
  labels,
  commands,
}: {
  selectedCount: number;
  locationReady: boolean;
  labels: UIStrings;
  commands: FileActionCommands;
}): FileAction[] {
  const noSelection = selectedCount === 0;
  return [
    { kind: "command", id: "rename", label: labels.rename, icon: Pencil, disabled: !locationReady || selectedCount !== 1, run: commands.onRename },
    { kind: "command", id: "powerRename", label: labels.powerRename, icon: ScanText, disabled: !locationReady || noSelection, run: commands.onPowerRename },
    { kind: "command", id: "superRename", label: labels.superRename, icon: WandSparkles, disabled: !locationReady, run: commands.onSuperRename },
    { kind: "command", id: "mkdir", label: labels.mkdir, icon: FolderPlus, disabled: !locationReady, run: commands.onMkdir },
    {
      kind: "command",
      id: "delete",
      label: labels.delete,
      icon: Trash2,
      disabled: !locationReady || noSelection,
      separatorBefore: true,
      destructive: true,
      run: () => commands.onOperation("delete"),
    },
  ];
}

export function createClipboardActions({
  selectedCount,
  canPaste,
  canOpenInNewWindow,
  labels,
  commands,
}: {
  selectedCount: number;
  canPaste: boolean;
  canOpenInNewWindow: boolean;
  labels: UIStrings;
  commands: {
    onCopy(): void;
    onCut(): void;
    onPaste(): void;
    onOpenInNewWindow(): void;
  };
}): FileAction[] {
  return [
    {
      kind: "command",
      id: "openInNewWindow",
      label: labels.openInNewWindow,
      icon: ExternalLink,
      disabled: !canOpenInNewWindow,
      run: commands.onOpenInNewWindow,
    },
    { kind: "command", id: "clipboardCopy", label: labels.clipboardCopy, icon: Copy, disabled: selectedCount === 0, run: commands.onCopy },
    { kind: "command", id: "clipboardCut", label: labels.cut, icon: Scissors, disabled: selectedCount === 0, run: commands.onCut },
    { kind: "command", id: "clipboardPaste", label: labels.paste, icon: ClipboardPaste, disabled: !canPaste, run: commands.onPaste },
  ];
}

export function createLinkSourceActions({
  selectedCount,
  sourceCount,
  canSelectSource,
  canCreate,
  labels,
  commands,
}: {
  selectedCount: number;
  sourceCount: number;
  canSelectSource: boolean;
  canCreate: boolean;
  labels: UIStrings;
  commands: LinkSourceActionCommands;
}): FileContextAction[] {
  const actions: FileContextAction[] = [];
  if (canSelectSource) {
    actions.push({
      kind: "command",
      id: "selectLinkSource",
      label: labels.selectLinkSource,
      icon: Link,
      disabled: selectedCount === 0,
      separatorBefore: true,
      run: commands.onSelectSource,
    });
  }
  if (sourceCount === 0) return actions;
  actions.push({
    kind: "command",
    id: "cancelLinkSource",
    label: labels.cancelLinkSource(sourceCount),
    icon: Unlink,
    disabled: false,
    separatorBefore: actions.length === 0,
    run: commands.onCancelSource,
  });
  actions.push({
    kind: "submenu",
    id: "createLinkAs",
    label: labels.createLinkAs,
    icon: Combine,
    disabled: !canCreate,
    items: [
      {
        kind: "command",
        id: "hardlink",
        label: labels.hardlink,
        icon: Link2,
        disabled: !canCreate,
        run: () => commands.onCreate("hardlink"),
      },
      {
        kind: "command",
        id: "symlink",
        label: labels.symlink,
        icon: Link,
        disabled: !canCreate,
        run: () => commands.onCreate("symlink"),
      },
    ],
  });
  return actions;
}
