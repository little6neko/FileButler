import { Fragment, type ReactElement } from "react";
import {
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuPortal,
  ContextMenuPositioner,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { FileAction } from "./fileActions";

export function PaneContextMenu({
  actions,
  label,
  children,
}: {
  actions: FileAction[];
  label: string;
  children: ReactElement;
}) {
  return (
    <ContextMenuRoot>
      <ContextMenuTrigger render={children} />
      <ContextMenuPortal>
        <ContextMenuPositioner>
          <ContextMenuPopup aria-label={label}>
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <Fragment key={action.id}>
                  {action.separatorBefore ? <ContextMenuSeparator className="file-action-menu-separator" /> : null}
                  <ContextMenuItem
                    data-action-id={action.id}
                    className={action.destructive ? "file-action-menu-item text-destructive" : "file-action-menu-item"}
                    disabled={action.disabled}
                    onClick={action.run}
                  >
                    <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                    <span>{action.label}</span>
                  </ContextMenuItem>
                </Fragment>
              );
            })}
          </ContextMenuPopup>
        </ContextMenuPositioner>
      </ContextMenuPortal>
    </ContextMenuRoot>
  );
}
