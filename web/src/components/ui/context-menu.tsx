import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

function ContextMenuRoot(props: ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root {...props} />;
}

function ContextMenuTrigger({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" className={cn(className)} {...props} />;
}

function ContextMenuPortal(props: ComponentProps<typeof ContextMenuPrimitive.Portal>) {
  return <ContextMenuPrimitive.Portal {...props} />;
}

function ContextMenuPositioner({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.Positioner>) {
  return <ContextMenuPrimitive.Positioner className={cn(className)} {...props} />;
}

function ContextMenuPopup({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.Popup>) {
  return <ContextMenuPrimitive.Popup data-slot="menu-popup" className={cn(className)} {...props} />;
}

function ContextMenuItem({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return <ContextMenuPrimitive.Item data-slot="menu-item" className={cn(className)} {...props} />;
}

function ContextMenuSeparator({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return <ContextMenuPrimitive.Separator data-slot="menu-separator" className={cn(className)} {...props} />;
}

function ContextMenuSubmenuRoot(props: ComponentProps<typeof ContextMenuPrimitive.SubmenuRoot>) {
  return <ContextMenuPrimitive.SubmenuRoot {...props} />;
}

function ContextMenuSubmenuTrigger({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.SubmenuTrigger>) {
  return <ContextMenuPrimitive.SubmenuTrigger data-slot="menu-item" data-submenu-trigger="" className={cn(className)} {...props} />;
}

export {
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuPortal,
  ContextMenuPositioner,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuSubmenuRoot,
  ContextMenuSubmenuTrigger,
  ContextMenuTrigger,
};
