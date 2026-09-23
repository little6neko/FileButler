import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  labelledBy: string;
  describedBy?: string;
  size?: "compact" | "operation";
  panelClassName?: string;
  onClose(): void;
  children: ReactNode;
};

export function WindowDialogLayer({
  labelledBy,
  describedBy,
  size = "compact",
  panelClassName,
  onClose,
  children,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || panel.contains(document.activeElement)) return;
    panel.focus();
  }, []);

  function handleBackdropPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = focusableElements(panel);
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && activeIndex <= 0) {
      event.preventDefault();
      focusable[focusable.length - 1].focus();
    } else if (!event.shiftKey && (activeIndex < 0 || activeIndex === focusable.length - 1)) {
      event.preventDefault();
      focusable[0].focus();
    }
  }

  return (
    <div className="window-dialog-layer" data-window-local-dialog="true" onPointerDown={handleBackdropPointerDown}>
      <div
        ref={panelRef}
        role="dialog"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={cn("window-dialog-panel", panelClassName)}
        data-window-dialog-size={size}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </div>
  );
}

function focusableElements(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLElement>([
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(","))).filter((element) => element.getAttribute("aria-hidden") !== "true");
}
