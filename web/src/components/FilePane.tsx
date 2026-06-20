import { useEffect, useMemo, useState } from "react";
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
  onVisibleOrderChange?(paths: string[]): void;
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
  onVisibleOrderChange,
  onRefresh,
  onActivate,
  labels = strings.en,
  isActive = false,
}: FilePaneProps) {
  const [pathDraft, setPathDraft] = useState(displayPath(currentPath));
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(-1);
  const [sortState, setSortState] = useState<SortState>(null);
  const [columnWidths, setColumnWidths] = useState<Record<ColumnKey, number>>(defaultColumnWidths);
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
      <div className="file-list">
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
                className={entry.type === "directory" ? "directory-row" : undefined}
                onDoubleClick={() => {
                  if (entry.type === "directory") onPathChange(entry.relativePath);
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

const defaultColumnWidths: Record<ColumnKey, number> = {
  select: 36,
  name: 220,
  type: 96,
  size: 84,
  modified: 160,
};

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
    "--file-col-select": `${widths.select}px`,
    "--file-col-name": `${widths.name}px`,
    "--file-col-type": `${widths.type}px`,
    "--file-col-size": `${widths.size}px`,
    "--file-col-modified": `${widths.modified}px`,
    "--file-table-width": `${totalWidth}px`,
    minWidth: `${totalWidth}px`,
  } as CSSProperties;
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
