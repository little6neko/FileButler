import type { OpsRequest } from "./api/types";
import type { ProgressAnchor } from "./jobEvents";

// Resolve the actual destination pane, preferring the initiating window when
// several windows display the same directory. Child-folder drops use its window.
export function progressAnchor(request?: OpsRequest, windowId?: string, paneKey?: string): ProgressAnchor | undefined {
  const windows = [...document.querySelectorAll<HTMLElement>(".desktop-window")];
  const origin = windows.find((element) => element.dataset.windowId === windowId);
  const panes = [...document.querySelectorAll<HTMLElement>(".file-pane")].filter((pane) => pane.getBoundingClientRect().width > 0);
  const candidates = request?.destRoot ? panes.filter((pane) => pane.dataset.rootId === request.destRoot && pane.dataset.directoryPath === request.destPath) : [];
  const target = panes.find((pane) => pane.dataset.paneKey === paneKey && paneKey !== undefined)
    ?? candidates.find((pane) => origin?.contains(pane)) ?? candidates[0];
  const element = target?.closest<HTMLElement>(".desktop-window") ?? target ?? origin
    ?? document.querySelector<HTMLElement>('.desktop-window[data-active="true"], .file-pane[data-active="true"]');
  const rect = element?.getBoundingClientRect();
  return rect && rect.width > 0 && rect.height > 0 ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : undefined;
}
