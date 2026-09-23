import { useRef, type ReactElement } from "react";
import { ContextMenuRoot, ContextMenuTrigger, ContextMenuPortal, ContextMenuPositioner, ContextMenuPopup } from "./ui/context-menu";
import { FileActionMenuItems } from "./FileActionMenuItems";
import type { FileContextAction } from "./fileActions";

export function PaneContextMenu({ actions, label, children }: { actions: FileContextAction[]; label: string; children: ReactElement }) {
  const trigger = useRef<HTMLDivElement>(null);
  function returnFocus() {
    // A menu action may have opened a dialog or a different desktop window.
    if (document.activeElement?.closest("[role='dialog']")) return false;
    const activeWindow = document.querySelector(".desktop-window[data-active='true']");
    if (activeWindow) return activeWindow.querySelector<HTMLElement>(".file-pane") ?? false;
    return trigger.current?.closest<HTMLElement>(".file-pane") ?? false;
  }
  return <ContextMenuRoot>
    <ContextMenuTrigger ref={trigger} render={children} />
    <ContextMenuPortal><ContextMenuPositioner><ContextMenuPopup aria-label={label} finalFocus={returnFocus}><FileActionMenuItems actions={actions} context /></ContextMenuPopup></ContextMenuPositioner></ContextMenuPortal>
  </ContextMenuRoot>;
}
