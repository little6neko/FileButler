import { Fragment } from "react";
import { ChevronRight } from "lucide-react";
import * as Context from "./ui/context-menu";
import * as Menu from "./ui/menu";
import type { FileContextAction } from "./fileActions";

export function FileActionMenuItems({ actions, context = false }: { actions: FileContextAction[]; context?: boolean }) {
  const Item = context ? Context.ContextMenuItem : Menu.MenuItem;
  const Separator = context ? Context.ContextMenuSeparator : Menu.MenuSeparator;
  const Submenu = context ? Context.ContextMenuSubmenuRoot : Menu.MenuSubmenuRoot;
  const Trigger = context ? Context.ContextMenuSubmenuTrigger : Menu.MenuSubmenuTrigger;
  const Portal = context ? Context.ContextMenuPortal : Menu.MenuPortal;
  const Positioner = context ? Context.ContextMenuPositioner : Menu.MenuPositioner;
  const Popup = context ? Context.ContextMenuPopup : Menu.MenuPopup;
  return actions.map((action, index) => {
    const Icon = action.icon;
    const content = <><Icon aria-hidden="true" className="size-3.5 shrink-0" /><span>{action.label}</span></>;
    return <Fragment key={action.id}>
      {index > 0 && action.separatorBefore ? <Separator className="file-action-menu-separator" /> : null}
      {action.kind === "submenu" ? <Submenu>
        <Trigger data-slot="menu-item" data-action-id={action.id} className="file-action-menu-item" disabled={action.disabled} openOnHover delay={0}>{content}<ChevronRight aria-hidden="true" className="file-action-submenu-arrow" /></Trigger>
        <Portal><Positioner alignOffset={-4} sideOffset={-4}><Popup aria-label={action.label}><FileActionMenuItems actions={action.items} context={context} /></Popup></Positioner></Portal>
      </Submenu> : <Item data-action-id={action.id} className={`file-action-menu-item${action.destructive ? " text-destructive" : ""}`} disabled={action.disabled} onClick={(event) => { event.stopPropagation(); action.run(); }}>{content}</Item>}
    </Fragment>;
  });
}
