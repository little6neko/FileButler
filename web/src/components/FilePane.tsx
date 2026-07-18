import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { Entry, Root } from "../api/types";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";

type FilePaneProps = {
  title: string;
  roots: Root[];
  selectedRootId: string;
  currentPath: string;
  entries: Entry[];
  selectedPaths: Set<string>;
  onRootChange(rootId: string): void;
  onPathChange(path: string): void;
  onToggleSelection(path: string): void;
  onSelectAll(checked: boolean): void;
  onSelectPaths?(paths: string[]): void;
  onVisibleOrderChange?(paths: string[]): void;
  onOpenFile?(entry: Entry): void;
  onRefresh(): void;
  onActivate(): void;
  labels?: UIStrings;
  isActive?: boolean;
};

export function FilePane({
  title,
  roots,
  selectedRootId,
  currentPath,
  entries,
  selectedPaths,
  onRootChange,
  onPathChange,
  onToggleSelection,
  onSelectAll,
  onSelectPaths,
  onVisibleOrderChange,
  onOpenFile,
  onRefresh,
  onActivate,
  labels = strings.en,
  isActive = false,
}: FilePaneProps) {
  const [pathDraft, setPathDraft] = useState(displayPath(currentPath));
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(-1);
  const [sortState, setSortState] = useState<SortState>({ column: "name", direction: "asc" });
  const [columnWidths, setColumnWidths] = useState<Record<ColumnKey, number>>(defaultColumnWidths);
  const [dragBox, setDragBox] = useState<DragBox | null>(null);
  const fileListRef = useRef<HTMLDivElement>(null);
  const columnsResizedRef = useRef(false);
  const visibleEntries = useMemo(() => sortEntries(entries, sortState), [entries, sortState]);
  const allVisibleSelected = visibleEntries.length > 0 && visibleEntries.every((entry) => selectedPaths.has(entry.relativePath));
  const suggestions = useMemo(
    () =>
      entries
        .filter((entry) => entry.type === "directory")
        .filter((entry) => entry.relativePath.toLowerCase().startsWith(normalizeInput(pathDraft).toLowerCase()))
        .slice(0, 8),
    [entries, pathDraft],
  );

  const pathSegments = buildPathSegments(currentPath);
  const singleRoot = roots.length <= 1;

  useEffect(() => {
    setPathDraft(displayPath(currentPath));
    setHighlightedSuggestion(-1);
  }, [currentPath]);

  useEffect(() => {
    onVisibleOrderChange?.(visibleEntries.map((entry) => entry.relativePath));
  }, [onVisibleOrderChange, visibleEntries]);

  useEffect(() => {
    function fitDefaultNameColumn() {
      if (columnsResizedRef.current) return;
      const listWidth = fileListRef.current?.clientWidth ?? 0;
      if (listWidth <= 0) return;

      setColumnWidths((current) => {
        const fixedWidth = current.select + current.type + current.size + current.modified;
        const targetWidth = Math.max(defaultTableWidth, listWidth - rightSelectionGutter);
        const nextNameWidth = Math.max(defaultColumnWidths.name, targetWidth - fixedWidth);
        if (current.name === nextNameWidth) return current;
        return { ...current, name: nextNameWidth };
      });
    }

    fitDefaultNameColumn();

    const fileList = fileListRef.current;
    if (!fileList || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(fitDefaultNameColumn);
    observer.observe(fileList);
    return () => observer.disconnect();
  }, []);

  return (
    <section className={`file-pane${isActive ? " is-active" : ""}`} aria-label={title} onClick={onActivate}>
      <div className="pane-header">
        <strong>{title}</strong>
        {singleRoot ? (
          <span className="root-marker" aria-label={labels.rootLabel(title)}>
            /
          </span>
        ) : (
          <select
            aria-label={labels.rootLabel(title)}
            value={selectedRootId}
            onChange={(event) => onRootChange(event.target.value)}
          >
            {roots.map((root) => (
              <option key={root.id} value={root.id}>
                {root.name}
              </option>
            ))}
          </select>
        )}
        <div className="path-combobox">
          <input
            aria-label={labels.pathLabel(title)}
            value={pathDraft}
            onChange={(event) => {
              setPathDraft(event.target.value);
              setHighlightedSuggestion(-1);
            }}
            onKeyDown={handlePathKeyDown}
            onFocus={() => setHighlightedSuggestion(-1)}
          />
          {suggestions.length > 0 && pathDraft !== displayPath(currentPath) ? (
            <div className="path-suggestions" role="listbox">
              {suggestions.map((entry, index) => (
                <button
                  key={entry.relativePath}
                  type="button"
                  role="option"
                  aria-selected={index === highlightedSuggestion}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onPathChange(entry.relativePath);
                  }}
                >
                  {entry.relativePath}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button type="button" aria-label={labels.refreshLabel(title)} onClick={onRefresh}>
          {labels.refresh}
        </button>
      </div>
      <nav className="path-segments" aria-label={`${title} segments`}>
        {pathSegments.map((segment, index) => (
          <button key={`${segment.path}-${index}`} type="button" onClick={() => onPathChange(segment.path)}>
            {segment.label}
          </button>
        ))}
      </nav>
      <div className="file-list" ref={fileListRef} onMouseDown={startDragSelection}>
        <table className="file-table" style={columnStyle(columnWidths)}>
          <colgroup>
            <col style={{ width: "var(--file-col-select)" }} />
            <col style={{ width: "var(--file-col-name)" }} />
            <col style={{ width: "var(--file-col-type)" }} />
            <col style={{ width: "var(--file-col-size)" }} />
            <col style={{ width: "var(--file-col-modified)" }} />
          </colgroup>
          <thead>
            <tr>
              <th className="select-cell">
                <div className="file-header-cell">
                  <input
                    aria-label={labels.selectAllVisible}
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(event) => onSelectAll(event.target.checked)}
                  />
                </div>
              </th>
              <SortableHeader column="name" label={labels.name} />
              <SortableHeader column="type" label={labels.type} />
              <SortableHeader column="size" label={labels.size} />
              <SortableHeader column="modified" label={labels.modified} />
            </tr>
          </thead>
          <tbody>
            {visibleEntries.map((entry) => (
              <tr
                key={entry.relativePath}
                data-entry-path={entry.relativePath}
                className={entry.type === "directory" ? "directory-row" : undefined}
                onDoubleClick={() => {
                  if (entry.type === "directory") onPathChange(entry.relativePath);
                  else onOpenFile?.(entry);
                }}
              >
                <td className="select-cell">
                  <input
                    aria-label={labels.selectEntry(entry.name)}
                    type="checkbox"
                    checked={selectedPaths.has(entry.relativePath)}
                    onChange={() => onToggleSelection(entry.relativePath)}
                  />
                </td>
                <td>
                  <span>{entry.name}</span>
                  {entry.isSymlink && entry.symlinkTarget ? (
                    <small className="symlink-target">{" -> "}{entry.symlinkTarget}</small>
                  ) : null}
                </td>
                <td>{entry.type}</td>
                <td>{formatSize(entry.size)}</td>
                <td>{entry.modifiedUnix ? new Date(entry.modifiedUnix * 1000).toLocaleString() : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {dragBox ? <div className="drag-selection-box" style={dragBox} /> : null}
      </div>
    </section>
  );

  function SortableHeader({ column, label }: { column: SortKey; label: string }) {
    const active = sortState?.column === column;
    const direction = active ? sortState.direction : undefined;
    return (
      <th aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" className="file-sort-button" onClick={() => toggleSort(column)}>
          <span>{label}</span>
          {active ? <span aria-hidden="true">{direction === "asc" ? "▲" : "▼"}</span> : null}
        </button>
        <ResizeHandle label={`Resize ${label} column`} onMouseDown={(event) => startResize(event, column)} />
      </th>
    );
  }

  function ResizeHandle({ label, onMouseDown }: { label: string; onMouseDown(event: ReactMouseEvent<HTMLSpanElement>): void }) {
    return <span role="separator" aria-label={label} className="column-resize-handle" onMouseDown={onMouseDown} />;
  }

  function toggleSort(column: SortKey) {
    setSortState((current) => {
      if (current?.column === column) {
        return { column, direction: current.direction === "asc" ? "desc" : "asc" };
      }
      return { column, direction: "asc" };
    });
  }

  function startResize(event: ReactMouseEvent<HTMLSpanElement>, column: ColumnKey) {
    event.preventDefault();
    event.stopPropagation();
    columnsResizedRef.current = true;
    const startX = event.clientX;
    const headerRight = event.currentTarget.parentElement?.getBoundingClientRect().right ?? startX;
    const boundaryX = headerRight > 0 ? headerRight : startX;
    const startWidth = columnWidths[column];
    function onMouseMove(moveEvent: MouseEvent) {
      const next = Math.max(56, startWidth + moveEvent.clientX - boundaryX);
      setColumnWidths((current) => ({ ...current, [column]: next }));
    }
    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function startDragSelection(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || isDragBlockedTarget(event.target)) return;
    event.preventDefault();
    onActivate();

    const fileListElement = fileListRef.current;
    if (!fileListElement) return;
    const listElement: HTMLDivElement = fileListElement;

    const startX = event.clientX;
    const startY = event.clientY;
    let lastX = startX;
    let lastY = startY;
    let moved = false;

    function updateBox(clientX: number, clientY: number) {
      const listRect = listElement.getBoundingClientRect();
      const left = Math.min(startX, clientX);
      const top = Math.min(startY, clientY);
      const right = Math.max(startX, clientX);
      const bottom = Math.max(startY, clientY);
      setDragBox({
        left: left - listRect.left + listElement.scrollLeft,
        top: top - listRect.top + listElement.scrollTop,
        width: right - left,
        height: bottom - top,
      });
    }

    function onMouseMove(moveEvent: MouseEvent) {
      const distance = Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY);
      if (distance < 4) return;
      moved = true;
      lastX = moveEvent.clientX;
      lastY = moveEvent.clientY;
      updateBox(moveEvent.clientX, moveEvent.clientY);
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      setDragBox(null);
      if (!moved) return;
      onSelectPaths?.(pathsInsideSelection(startX, startY, lastX, lastY));
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function pathsInsideSelection(startX: number, startY: number, endX: number, endY: number) {
    const selectionRect = normalizeRect(startX, startY, endX, endY);
    const listRect = fileListRef.current?.getBoundingClientRect();
    const rows = fileListRef.current?.querySelectorAll<HTMLTableRowElement>("tbody tr[data-entry-path]") ?? [];
    return Array.from(rows)
      .filter((row) => {
        const rowRect = row.getBoundingClientRect();
        return rectsIntersect(selectionRect, listRect ? { ...rowRect, left: listRect.left, right: listRect.right } : rowRect);
      })
      .map((row) => row.dataset.entryPath)
      .filter((path): path is string => Boolean(path));
  }

  function handlePathKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedSuggestion((current) => Math.min(current + 1, suggestions.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedSuggestion((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const selectedSuggestion = highlightedSuggestion >= 0 ? suggestions[highlightedSuggestion] : undefined;
      onPathChange(selectedSuggestion?.relativePath ?? normalizeInput(pathDraft));
    }
  }
}

type SortKey = "name" | "type" | "size" | "modified";
type ColumnKey = "select" | SortKey;
type SortState = { column: SortKey; direction: "asc" | "desc" } | null;
type DragBox = Pick<CSSProperties, "left" | "top" | "width" | "height">;

const defaultColumnWidths: Record<ColumnKey, number> = {
  select: 36,
  name: 220,
  type: 96,
  size: 84,
  modified: 140,
};
const defaultTableWidth = Object.values(defaultColumnWidths).reduce((sum, width) => sum + width, 0);
const rightSelectionGutter = 24;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function sortEntries(entries: Entry[], sortState: SortState) {
  if (!sortState) return entries;
  const direction = sortState.direction === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => compareEntries(a, b, sortState.column) * direction);
}

function compareEntries(a: Entry, b: Entry, column: SortKey) {
  switch (column) {
    case "name":
      return collator.compare(a.name, b.name);
    case "type":
      return collator.compare(a.type, b.type) || collator.compare(a.name, b.name);
    case "size":
      return a.size - b.size || collator.compare(a.name, b.name);
    case "modified":
      return a.modifiedUnix - b.modifiedUnix || collator.compare(a.name, b.name);
  }
}

function columnStyle(widths: Record<ColumnKey, number>) {
  const totalWidth = Object.values(widths).reduce((sum, width) => sum + width, 0);
  return {
    width: "var(--file-table-width)",
    "--file-col-select": `${widths.select}px`,
    "--file-col-name": `${widths.name}px`,
    "--file-col-type": `${widths.type}px`,
    "--file-col-size": `${widths.size}px`,
    "--file-col-modified": `${widths.modified}px`,
    "--file-table-width": `${totalWidth}px`,
    minWidth: `${totalWidth}px`,
  } as CSSProperties;
}

function isDragBlockedTarget(target: EventTarget) {
  return target instanceof Element && Boolean(target.closest("button, input, select, textarea, a, thead, [role='separator']"));
}

function normalizeRect(startX: number, startY: number, endX: number, endY: number) {
  return {
    left: Math.min(startX, endX),
    top: Math.min(startY, endY),
    right: Math.max(startX, endX),
    bottom: Math.max(startY, endY),
  };
}

function rectsIntersect(
  left: { left: number; top: number; right: number; bottom: number },
  right: { left: number; top: number; right: number; bottom: number },
) {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

function formatSize(size: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unitIndex = 0;
  while (Math.abs(value) >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = unitIndex === 0 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
  return `${formatted} ${units[unitIndex]}`;
}

function displayPath(path: string) {
  return path && path !== "." ? `/${path.replace(/^\/+/, "")}` : "/";
}

function normalizeInput(path: string) {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") return ".";
  return trimmed.replace(/^\/+/, "").replace(/\/+$/, "") || ".";
}

function buildPathSegments(path: string) {
  const normalized = normalizeInput(path);
  const segments = [{ label: "/", path: "." }];
  if (normalized === ".") return segments;
  const parts = normalized.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    segments.push({ label: part, path: current });
  }
  return segments;
}
