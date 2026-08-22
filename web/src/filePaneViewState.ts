export type FilePaneSortKey = "name" | "type" | "size" | "modified";
export type FilePaneColumnKey = "select" | FilePaneSortKey;
export type FilePaneSortState = { column: FilePaneSortKey; direction: "asc" | "desc" } | null;

export type FilePaneViewState = {
  sortState: FilePaneSortState;
  columnWidths: Record<FilePaneColumnKey, number>;
  columnsResized: boolean;
};

export const defaultFilePaneColumnWidths: Record<FilePaneColumnKey, number> = {
  select: 36,
  name: 220,
  type: 96,
  size: 84,
  modified: 140,
};

export function createDefaultFilePaneViewState(): FilePaneViewState {
  return {
    sortState: { column: "name", direction: "asc" },
    columnWidths: { ...defaultFilePaneColumnWidths },
    columnsResized: false,
  };
}
