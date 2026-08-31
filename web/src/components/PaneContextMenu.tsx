import { Fragment, type ReactElement } from "react";
import { ChevronRight } from "lucide-react";
import {
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuPortal,
  ContextMenuPositioner,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuSubmenuRoot,
  ContextMenuSubmenuTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { FileAction, FileContextAction, FileSubmenuAction } from "./fileActions";

export function PaneContextMenu({
  actions,
  label,
  children,
}: {
  actions: FileContextAction[];
  label: string;
  children: ReactElement;
}) {
  return (
    <ContextMenuRoot>
      <ContextMenuTrigger render={children} />
      <ContextMenuPortal>
        <ContextMenuPositioner>
          <ContextMenuPopup aria-label={label}>
            {actions.map(renderContextAction)}
          </ContextMenuPopup>
        </ContextMenuPositioner>
      </ContextMenuPortal>
    </ContextMenuRoot>
  );
}

function renderContextAction(action: FileContextAction) {
  return (
    <Fragment key={action.id}>
      {action.separatorBefore ? <ContextMenuSeparator className="file-action-menu-separator" /> : null}
      {action.kind === "submenu" ? renderSubmenu(action) : renderCommand(action)}
    </Fragment>
  );
}

function renderCommand(action: FileAction) {
  const Icon = action.icon;
  return (
    <ContextMenuItem
      data-action-id={action.id}
      className={action.destructive ? "file-action-menu-item text-destructive" : "file-action-menu-item"}
      disabled={action.disabled}
      onClick={(event) => {
        event.stopPropagation();
        action.run();
      }}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span>{action.label}</span>
    </ContextMenuItem>
  );
}

function renderSubmenu(action: FileSubmenuAction) {
  const Icon = action.icon;
  return (
    <ContextMenuSubmenuRoot>
      <ContextMenuSubmenuTrigger
        data-action-id={action.id}
        className="file-action-menu-item"
        disabled={action.disabled}
        openOnHover
        delay={0}
      >
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        <span>{action.label}</span>
        <ChevronRight aria-hidden="true" className="file-action-submenu-arrow" />
      </ContextMenuSubmenuTrigger>
      <ContextMenuPortal>
        <ContextMenuPositioner alignOffset={-4} sideOffset={-4}>
          <ContextMenuPopup aria-label={action.label}>
            {action.items.map(renderContextAction)}
          </ContextMenuPopup>
        </ContextMenuPositioner>
      </ContextMenuPortal>
    </ContextMenuSubmenuRoot>
  );
}
