export function applicationWindowCoversPoint(
  x: number,
  y: number,
  elementsFromPoint = document.elementsFromPoint?.bind(document),
) {
  if (!elementsFromPoint) return false;
  for (const element of elementsFromPoint(x, y)) {
    if (element.closest("[data-no-file-drop]")) return true;
    const desktopWindow = element.closest<HTMLElement>(".desktop-window");
    if (desktopWindow) return !["file", "cloud115"].includes(desktopWindow.dataset.windowKind ?? "");
  }
  return false;
}
