import type { PointerEvent as ReactPointerEvent } from "react";

export function bindPointerGesture(
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
