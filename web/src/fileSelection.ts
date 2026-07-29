export type FileSelectionMode = "single" | "toggle" | "range";

export type FileSelectionResult = {
  selected: Set<string>;
  anchor: string | null;
};

export function applyFileSelection(
  currentSelected: ReadonlySet<string>,
  currentAnchor: string | null,
  visibleOrder: readonly string[],
  target: string,
  mode: FileSelectionMode,
): FileSelectionResult {
  if (mode === "single") return singleSelection(target);

  if (mode === "toggle") {
    const selected = new Set(currentSelected);
    if (selected.has(target)) selected.delete(target);
    else selected.add(target);
    return { selected, anchor: target };
  }

  const anchorIndex = currentAnchor === null ? -1 : visibleOrder.indexOf(currentAnchor);
  const targetIndex = visibleOrder.indexOf(target);
  if (anchorIndex < 0 || targetIndex < 0) return singleSelection(target);

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return {
    selected: new Set(visibleOrder.slice(start, end + 1)),
    anchor: currentAnchor,
  };
}

function singleSelection(target: string): FileSelectionResult {
  return { selected: new Set([target]), anchor: target };
}
