export function applicationWindowCoversPoint(
  x: number,
  y: number,
  elementsFromPoint = document.elementsFromPoint?.bind(document),
) {
  if (!elementsFromPoint) return false;
  for (const element of elementsFromPoint(x, y)) {
    const desktopWindow = element.closest<HTMLElement>(".desktop-window");
    if (desktopWindow) return desktopWindow.dataset.windowKind !== "file";
  }
  return false;
}
