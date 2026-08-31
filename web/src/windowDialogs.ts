import type { Entry, LinkRequest, OpsRequest } from "./api/types";
import type { DragOperation } from "./fileDrag";

type WindowDialogBase = {
  dialogId: string;
  windowId: string;
};

export type MkdirWindowDialog = WindowDialogBase & {
  kind: "mkdir";
  rootId: string;
  directoryPath: string;
};

export type SingleRenameWindowDialog = WindowDialogBase & {
  kind: "singleRename";
  rootId: string;
  path: string;
  initialName: string;
  entryType: Entry["type"];
};

export type OperationWindowDialog = WindowDialogBase & {
  kind: "operation";
  request: OpsRequest;
  operationChoices?: readonly DragOperation[];
  clearMoveClipboard?: boolean;
};

export type LinkWindowDialog = WindowDialogBase & {
  kind: "link";
  request: LinkRequest;
  sourceCreatedAt: number;
  consumeLinkSource: boolean;
};

export type WindowDialogState =
  | MkdirWindowDialog
  | SingleRenameWindowDialog
  | OperationWindowDialog
  | LinkWindowDialog;

export type WindowDialogs = Partial<Record<string, WindowDialogState>>;

export function openWindowDialog(current: WindowDialogs, dialog: WindowDialogState): WindowDialogs {
  if (current[dialog.windowId]) return current;
  return { ...current, [dialog.windowId]: dialog };
}

export function closeWindowDialog(
  current: WindowDialogs,
  windowId: string,
  dialogId: string,
): WindowDialogs {
  const dialog = current[windowId];
  if (!dialog || dialog.dialogId !== dialogId) return current;
  return omitWindow(current, windowId);
}

export function clearWindowDialog(current: WindowDialogs, windowId: string): WindowDialogs {
  return current[windowId] ? omitWindow(current, windowId) : current;
}

export function clearAllWindowDialogs(current: WindowDialogs): WindowDialogs {
  return Object.keys(current).length === 0 ? current : {};
}

function omitWindow(current: WindowDialogs, windowId: string): WindowDialogs {
  const next = { ...current };
  delete next[windowId];
  return next;
}
