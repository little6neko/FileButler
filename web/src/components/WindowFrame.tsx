import { useEffect, useRef } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { Files, Maximize2, Minus, Shrink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UIStrings } from "../i18n";
import {
  renderedWindowRect,
  resizeWindowRect,
  type DesktopBounds,
  type DesktopWindowRecord,
  type ResizeDirection,
  type WindowRect,
  windowMinimum,
} from "../windowManager";

const resizeDirections: ResizeDirection[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

export function WindowFrame({
  window,
  bounds,
  title,
  icon,
  active,
  labels,
  onFocus,
  onRectChange,
  onMinimize,
  onToggleMaximize,
  onClose,
  closeDisabled = false,
  children,
}: {
  window: DesktopWindowRecord;
  bounds: DesktopBounds;
  title: string;
  icon?: ReactNode;
  active: boolean;
  labels: UIStrings;
  onFocus(): void;
  onRectChange(rect: WindowRect): void;
  onMinimize(): void;
  onToggleMaximize(): void;
  onClose(): void;
  closeDisabled?: boolean;
  children: ReactNode;
}) {
  const gestureCleanupRef = useRef<(() => void) | null>(null);
  const rect = renderedWindowRect(window, bounds);
  const style = {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    zIndex: window.zOrder,
  } as CSSProperties;

  function beginMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || window.status !== "normal") return;
    if (event.target instanceof Element && event.target.closest("button")) return;
    event.preventDefault();
    onFocus();
    gestureCleanupRef.current?.();
    gestureCleanupRef.current = bindPointerGesture(event, (deltaX, deltaY) => {
      onRectChange({ ...window.rect, x: window.rect.x + deltaX, y: window.rect.y + deltaY });
    });
  }

  function beginResize(direction: ResizeDirection, event: ReactPointerEvent<HTMLSpanElement>) {
    if (event.button !== 0 || window.status !== "normal") return;
    event.preventDefault();
    event.stopPropagation();
    onFocus();
    gestureCleanupRef.current?.();
    gestureCleanupRef.current = bindPointerGesture(event, (deltaX, deltaY) => {
      onRectChange(resizeWindowRect(window.rect, direction, deltaX, deltaY, bounds, windowMinimum(window)));
    });
  }

  useEffect(() => () => gestureCleanupRef.current?.(), []);

  return (
    <section
      className="desktop-window"
      style={style}
      aria-label={title}
      aria-current={active ? "true" : undefined}
      data-active={active ? "true" : "false"}
      data-window-kind={window.kind}
      data-window-status={window.status}
      data-window-id={window.id}
      onPointerDown={onFocus}
    >
      <div className="desktop-window-titlebar" onPointerDown={beginMove} onDoubleClick={onToggleMaximize}>
        {icon ?? <Files aria-hidden="true" />}
        <strong title={title}>{title}</strong>
        <div className="desktop-window-controls">
          <Button size="icon-sm" variant="ghost" aria-label={labels.minimizeWindow} title={labels.minimizeWindow} onClick={onMinimize}>
            <Minus />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={window.status === "maximized" ? labels.restoreWindow : labels.maximizeWindow}
            title={window.status === "maximized" ? labels.restoreWindow : labels.maximizeWindow}
            onClick={onToggleMaximize}
          >
            {window.status === "maximized" ? <Shrink /> : <Maximize2 />}
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={labels.closeWindow} title={labels.closeWindow} onClick={onClose} disabled={closeDisabled}>
            <X />
          </Button>
        </div>
      </div>
      <div className="desktop-window-content">{children}</div>
      {window.status === "normal" ? resizeDirections.map((direction) => (
        <span
          key={direction}
          className="desktop-window-resize-handle"
          data-resize-direction={direction}
          aria-hidden="true"
          onPointerDown={(event) => beginResize(direction, event)}
        />
      )) : null}
    </section>
  );
}

function bindPointerGesture(
  event: ReactPointerEvent<HTMLElement>,
  onMove: (deltaX: number, deltaY: number) => void,
): () => void {
  const element = event.currentTarget;
  const pointerID = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  element.setPointerCapture?.(pointerID);

  function handleMove(moveEvent: PointerEvent) {
    if (moveEvent.pointerId !== pointerID) return;
    onMove(moveEvent.clientX - startX, moveEvent.clientY - startY);
  }

  let active = true;

  function finish(endEvent?: PointerEvent) {
    if (!active || (endEvent && endEvent.pointerId !== pointerID)) return;
    active = false;
    element.removeEventListener("pointermove", handleMove);
    element.removeEventListener("pointerup", finish);
    element.removeEventListener("pointercancel", finish);
    window.removeEventListener("blur", cancel);
    if (element.hasPointerCapture?.(pointerID)) element.releasePointerCapture(pointerID);
  }

  function cancel() {
    finish();
  }

  element.addEventListener("pointermove", handleMove);
  element.addEventListener("pointerup", finish);
  element.addEventListener("pointercancel", finish);
  window.addEventListener("blur", cancel);
  return cancel;
}
