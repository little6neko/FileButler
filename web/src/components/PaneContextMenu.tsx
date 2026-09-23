import type { ReactElement } from "react";
import { ContextMenuRoot, ContextMenuTrigger, ContextMenuPortal, ContextMenuPositioner, ContextMenuPopup } from "./ui/context-menu";
import { FileActionMenuItems } from "./FileActionMenuItems";
import type { FileContextAction } from "./fileActions";

export function PaneContextMenu({ actions, label, children }: { actions: FileContextAction[]; label: string; children: ReactElement }) {
  return <ContextMenuRoot>
    <ContextMenuTrigger render={children} />
    <ContextMenuPortal><ContextMenuPositioner><ContextMenuPopup aria-label={label}><FileActionMenuItems actions={actions} context /></ContextMenuPopup></ContextMenuPositioner></ContextMenuPortal>
  </ContextMenuRoot>;
}
