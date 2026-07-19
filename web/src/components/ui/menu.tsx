import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

function MenuRoot(props: ComponentProps<typeof MenuPrimitive.Root>) {
  return <MenuPrimitive.Root {...props} />;
}

function MenuTrigger({ className, ...props }: ComponentProps<typeof MenuPrimitive.Trigger>) {
  return <MenuPrimitive.Trigger data-slot="menu-trigger" className={cn(className)} {...props} />;
}

function MenuPortal(props: ComponentProps<typeof MenuPrimitive.Portal>) {
  return <MenuPrimitive.Portal {...props} />;
}

function MenuPositioner({ className, ...props }: ComponentProps<typeof MenuPrimitive.Positioner>) {
  return <MenuPrimitive.Positioner className={cn(className)} {...props} />;
}

function MenuPopup({ className, ...props }: ComponentProps<typeof MenuPrimitive.Popup>) {
  return <MenuPrimitive.Popup data-slot="menu-popup" className={cn(className)} {...props} />;
}

function MenuItem({ className, ...props }: ComponentProps<typeof MenuPrimitive.Item>) {
  return <MenuPrimitive.Item data-slot="menu-item" className={cn(className)} {...props} />;
}

export { MenuItem, MenuPopup, MenuPortal, MenuPositioner, MenuRoot, MenuTrigger };
