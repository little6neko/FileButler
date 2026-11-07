import { Fragment, useLayoutEffect, useRef } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import type { FileAction, FileContextAction } from "./fileActions";

/** Presentation only: permissions and commands come from the desktop action model. */
export function MobileActionSheet({ open, title, actions, onClose, onRun }: {
  open: boolean;
  title: string;
  actions: FileContextAction[];
  onClose(): void;
  onRun?(action: FileAction): void;
}) {
  const trigger = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);
  function restoreFocus() {
    if (!trigger.current?.isConnected || trigger.current.closest("[hidden]")) return false;
    return trigger.current;
  }
  function command(action: FileAction) {
    if (action.disabled) return;
    if (onRun) onRun(action);
    else { onClose(); action.run(); }
  }
  return <Sheet open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <SheetContent side="bottom" className="mobile-action-sheet" finalFocus={restoreFocus} onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
      <SheetHeader><SheetTitle>{title}</SheetTitle></SheetHeader>
      <div className="mobile-action-sheet-items">
        {actions.map(action => <Fragment key={action.id}>
          {action.separatorBefore ? <hr /> : null}
          {action.kind === "submenu" ? <details>
            <summary aria-disabled={action.disabled} onClick={event => { if (action.disabled) event.preventDefault(); }}><action.icon />{action.label}</summary>
            {!action.disabled ? action.items.map(item => <button key={item.id} disabled={item.disabled} onClick={() => command(item)}><item.icon />{item.label}</button>) : null}
          </details> : <button type="button" disabled={action.disabled} className={action.destructive ? "text-destructive" : undefined} onClick={() => command(action)}><action.icon />{action.label}</button>}
        </Fragment>)}
      </div>
    </SheetContent>
  </Sheet>;
}
