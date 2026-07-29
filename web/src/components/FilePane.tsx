import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useDroppable } from "@dnd-kit/core";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { MenuItem, MenuPopup, MenuPortal, MenuPositioner, MenuRoot, MenuTrigger } from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import type { Entry, Root } from "../api/types";
import { paneDropId, type FileDropData, type FileDropFeedback, type PaneKey } from "../fileDrag";
import type { FileSelectionModifiers } from "../fileSelection";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";
import { buildPathSegments, displayPath, fitPathSegments, normalizeInput } from "../pathSegments";
import type { FittedPathSegments, PathSegment } from "../pathSegments";
import { ErrorBanner } from "./ErrorBanner";
import type { FileAction } from "./fileActions";
import { FileRow } from "./FileRow";
import { PaneContextMenu } from "./PaneContextMenu";
import { PaneStatusBar } from "./PaneStatusBar";

type FilePaneProps = {
  paneKey?: PaneKey;
  actions?: FileAction[];
  onContextTarget?(path: string | null): void;
  dropFeedback?: FileDropFeedback | null;
  title: string;
  roots: Root[];
  selectedRootId: string;
  currentPath: string;
  entries: Entry[];
  selectedPaths: Set<string>;
  onRootChange(rootId: string): void;
  onPathChange(path: string): void;
  onToggleSelection(path: string): void;
  onSelectEntry?(path: string, modifiers: FileSelectionModifiers): void;
  onSelectAll(checked: boolean): void;
  onSelectPaths?(paths: string[]): void;
  onVisibleOrderChange?(paths: string[]): void;
  onOpenFile?(entry: Entry): void;
  onRefresh(): void;
  onActivate(): void;
  labels?: UIStrings;
  isActive?: boolean;
  loading?: boolean;
  error?: string | null;
};

export function FilePane({
  paneKey = "left",
  actions = [],
  onContextTarget = () => undefined,
  dropFeedback = null,
  title,
  roots,
  selectedRootId,
  currentPath,
  entries,
  selectedPaths,
  onRootChange,
  onPathChange,
  onToggleSelection,
  onSelectEntry = () => undefined,
  onSelectAll,
  onSelectPaths,
  onVisibleOrderChange,
  onOpenFile,
  onRefresh,
  onActivate,
  labels = strings.en,
  isActive = false,
  loading = false,
  error = null,
}: FilePaneProps) {
  const [pathDraft, setPathDraft] = useState(displayPath(currentPath));
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(-1);
  const [sortState, setSortState] = useState<SortState>({ column: "name", direction: "asc" });
  const [columnWidths, setColumnWidths] = useState<Record<ColumnKey, number>>(defaultColumnWidths);
  const [dragBox, setDragBox] = useState<DragBox | null>(null);
  const [fittedPath, setFittedPath] = useState<FittedPathSegments>(() => ({
    visible: buildPathSegments(currentPath),
    hidden: [],
  }));
  const fileListRef = useRef<HTMLDivElement>(null);
  const dragSelectionCleanupRef = useRef<((clearVisual?: boolean) => void) | null>(null);
  const pathSegmentsContentRef = useRef<HTMLDivElement>(null);
  const pathSegmentsMeasureRef = useRef<HTMLDivElement>(null);
  const columnsResizedRef = useRef(false);
  const visibleEntries = useMemo(() => sortEntries(entries, sortState), [entries, sortState]);
  const selectedEntries = visibleEntries.filter((entry) => selectedPaths.has(entry.relativePath));
  const selectedBytes = selectedEntries.reduce((total, entry) => total + entry.size, 0);
  const allVisibleSelected = visibleEntries.length > 0 && visibleEntries.every((entry) => selectedPaths.has(entry.relativePath));
  const suggestions = useMemo(
    () =>
      entries
        .filter((entry) => entry.type === "directory")
        .filter((entry) => entry.relativePath.toLowerCase().startsWith(normalizeInput(pathDraft).toLowerCase()))
        .slice(0, 8),
    [entries, pathDraft],
  );

  const pathSegments = useMemo(() => buildPathSegments(currentPath), [currentPath]);
  const singleRoot = roots.length <= 1;
  const paneTarget: FileDropData = {
    id: paneDropId(paneKey),
    kind: "current-directory",
    pane: paneKey,
    rootId: selectedRootId,
    path: currentPath,
    label: labels.currentDirectory,
  };
  const paneDrop = useDroppable({
    id: paneTarget.id,
    data: paneTarget,
    disabled: loading || Boolean(error),
  });
  const setPaneDropNodeRef = paneDrop.setNodeRef;
  const setFileListNode = useCallback((node: HTMLDivElement | null) => {
    fileListRef.current = node;
    setPaneDropNodeRef(node);
  }, [setPaneDropNodeRef]);
  const paneFeedback = dropFeedback?.target.id === paneTarget.id ? dropFeedback : null;
  const paneDropState = paneFeedback ? (paneFeedback.valid ? "valid" : "invalid") : undefined;

  useEffect(() => {
    setPathDraft(displayPath(currentPath));
    setHighlightedSuggestion(-1);
  }, [currentPath]);

  useLayoutEffect(() => {
    const content = pathSegmentsContentRef.current;
    const measureRow = pathSegmentsMeasureRef.current;
    let disposed = false;

    function naturalWidth(element: HTMLElement, fallback: number) {
      return element.getBoundingClientRect().width || element.scrollWidth || element.offsetWidth || fallback;
    }

    function measurePath() {
      if (disposed) return;
      if (!content || !measureRow || content.clientWidth <= 0) {
        setFittedPath((current) => (samePathFit(current, pathSegments) ? current : { visible: pathSegments, hidden: [] }));
        return;
      }

      const measuredSegments = new Map(
        Array.from(measureRow.querySelectorAll<HTMLElement>('[data-path-measure="segment"]')).map((element) => [
          element.dataset.path ?? "",
          naturalWidth(element, Math.max(8, (element.textContent?.length ?? 1) * 8)),
        ]),
      );
      const widths = pathSegments.map((segment) => measuredSegments.get(segment.path) ?? Math.max(8, segment.label.length * 8));
      const separator = measureRow.querySelector<HTMLElement>('[data-path-measure="separator"]');
      const ellipsis = measureRow.querySelector<HTMLElement>('[data-path-measure="ellipsis"]');
      const separatorWidth = separator ? naturalWidth(separator, 8) : 8;
      const ellipsisWidth = ellipsis ? naturalWidth(ellipsis, 24) : 24;
      const next = fitPathSegments(pathSegments, widths, separatorWidth, ellipsisWidth, content.clientWidth);
      setFittedPath((current) => (samePathFit(current, next.visible, next.hidden) ? current : next));
    }

    setFittedPath({ visible: pathSegments, hidden: [] });
    measurePath();

    if (content && typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measurePath);
      observer.observe(content);
      return () => {
        disposed = true;
        observer.disconnect();
      };
    }

    return () => {
      disposed = true;
    };
  }, [pathSegments]);

  useEffect(() => {
    onVisibleOrderChange?.(visibleEntries.map((entry) => entry.relativePath));
  }, [onVisibleOrderChange, visibleEntries]);

  useEffect(() => {
    dragSelectionCleanupRef.current?.();
  }, [currentPath, selectedRootId]);

  useEffect(() => () => dragSelectionCleanupRef.current?.(false), []);

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
    <section
      className="file-pane"
      aria-label={title}
      aria-current={isActive ? "true" : undefined}
      data-active={isActive ? "true" : "false"}
      onClick={onActivate}
    >
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
          <Input
            aria-label={labels.pathLabel(title)}
            className="h-7 min-w-0 text-xs"
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
        <Button type="button" variant="outline" size="icon-sm" aria-label={labels.refreshLabel(title)} onClick={onRefresh}>
          <RefreshCw />
        </Button>
      </div>
      <nav className="path-segments" aria-label={`${title} segments`}>
        <div className="path-segments-content" ref={pathSegmentsContentRef}>
          {fittedPath.visible[0] ? renderPathButton(fittedPath.visible[0], 0) : null}
          {fittedPath.visible[1] ? (
            <>
              <span className="path-separator" aria-hidden="true">
                /
              </span>
              {renderPathButton(fittedPath.visible[1], 1)}
            </>
          ) : null}
          {fittedPath.hidden.length > 0 ? (
            <>
              <span className="path-separator" aria-hidden="true">
                /
              </span>
              <MenuRoot>
                <MenuTrigger
                  type="button"
                  className="path-segment-button path-overflow-trigger"
                  aria-label={labels.hiddenPathSegments(fittedPath.hidden.length)}
                >
                  …
                </MenuTrigger>
                <MenuPortal>
                  <MenuPositioner side="bottom" align="start">
                    <MenuPopup>
                      {fittedPath.hidden.map((segment) => (
                        <MenuItem key={segment.path} onClick={() => onPathChange(segment.path)}>
                          {segment.label}
                        </MenuItem>
                      ))}
                    </MenuPopup>
                  </MenuPositioner>
                </MenuPortal>
              </MenuRoot>
            </>
          ) : null}
          {fittedPath.visible.slice(2).map((segment, index) => (
            <span className="path-segment-pair" key={segment.path}>
              <span className="path-separator" aria-hidden="true">
                /
              </span>
              {renderPathButton(segment, index + 2)}
            </span>
          ))}
        </div>
        <div className="path-segments-measure" ref={pathSegmentsMeasureRef} aria-hidden="true">
          {pathSegments.map((segment) => (
            <span key={segment.path} data-path-measure="segment" data-path={segment.path}>
              {segment.label}
            </span>
          ))}
          <span data-path-measure="separator">/</span>
          <span data-path-measure="ellipsis">…</span>
        </div>
      </nav>
      <PaneContextMenu actions={actions} label={labels.fileActions}>
        <div className="file-list-frame" data-drop-state={paneDropState}>
          <div
            className="file-list"
            data-testid={`file-list-${paneKey}`}
            ref={setFileListNode}
            onMouseDown={startDragSelection}
            onContextMenuCapture={(event) => {
              onActivate();
              const element = event.target instanceof Element ? event.target : null;
              const row = element?.closest<HTMLTableRowElement>("tbody tr[data-entry-path]");
              onContextTarget(row?.dataset.entryPath ?? null);
            }}
          >
        {loading ? (
          <div data-testid="pane-loading" className="grid gap-1 p-2">
            {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-7" />)}
          </div>
        ) : error ? (
          <div className="p-3"><ErrorBanner message={error} /></div>
        ) : visibleEntries.length === 0 ? (
          <div className="grid h-full place-items-center text-xs text-slate-500">{labels.emptyDirectory}</div>
        ) : (
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
                  <Checkbox
                    aria-label={labels.selectAllVisible}
                    checked={allVisibleSelected}
                    onCheckedChange={(checked) => onSelectAll(checked === true)}
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
              <FileRow
                key={entry.relativePath}
                paneKey={paneKey}
                rootId={selectedRootId}
                entry={entry}
                selected={selectedPaths.has(entry.relativePath)}
                dragData={{
                  kind: "file-entry",
                  pane: paneKey,
                  rootId: selectedRootId,
                  parentPath: currentPath,
                  entry,
                  selectedPaths: Array.from(selectedPaths),
                  visibleEntries,
                }}
                dropFeedback={dropFeedback}
                labels={labels}
                onToggleSelection={onToggleSelection}
                onSelect={onSelectEntry}
                onOpen={(item) => {
                  if (item.type === "directory") onPathChange(item.relativePath);
                  else onOpenFile?.(item);
                }}
              />
            ))}
          </tbody>
          </table>
        )}
          {dragBox ? <div className="drag-selection-box" style={dragBox} /> : null}
          </div>
          {paneFeedback ? (
            <div
              className="file-list-drop-feedback"
              data-drop-state={paneDropState}
              aria-hidden="true"
            />
          ) : null}
        </div>
      </PaneContextMenu>
      <PaneStatusBar
        selectedCount={selectedEntries.length}
        selectedBytes={selectedBytes}
        visibleCount={visibleEntries.length}
        labels={labels}
      />
    </section>
  );

  function SortableHeader({ column, label }: { column: SortKey; label: string }) {
    const active = sortState?.column === column;
    const direction = active ? sortState.direction : undefined;
    return (
      <th aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" className="file-sort-button" onClick={() => toggleSort(column)}>
          <span>{label}</span>
          {active ? direction === "asc" ? <ChevronUp aria-hidden="true" className="size-3" /> : <ChevronDown aria-hidden="true" className="size-3" /> : null}
        </button>
        <ResizeHandle label={`Resize ${label} column`} onMouseDown={(event) => startResize(event, column)} />
      </th>
    );
  }

  function renderPathButton(segment: PathSegment, index: number) {
    return (
      <button
        key={`${segment.path}-${index}`}
        type="button"
        className="path-segment-button"
        onClick={() => onPathChange(segment.path)}
      >
        {segment.label}
      </button>
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

    dragSelectionCleanupRef.current?.();

    const startX = event.clientX;
    const startY = event.clientY;
    const startPoint = listContentPoint(listElement, startX, startY);
    const targetElement = event.target instanceof Element ? event.target : null;
    const clickedPath = targetElement?.closest<HTMLTableRowElement>("tbody tr[data-entry-path]")?.dataset.entryPath;
    let lastX = startX;
    let lastY = startY;
    let moved = false;
    let active = true;
    let animationFrame: number | null = null;
    let lastSelectedPaths: string[] | null = null;

    function updateSelection() {
      const currentPoint = listContentPoint(listElement, lastX, lastY);
      const left = Math.min(startPoint.x, currentPoint.x);
      const top = Math.min(startPoint.y, currentPoint.y);
      const right = Math.max(startPoint.x, currentPoint.x);
      const bottom = Math.max(startPoint.y, currentPoint.y);
      setDragBox({
        left,
        top,
        width: right - left,
        height: bottom - top,
      });

      const paths = pathsInsideSelection(listElement, startPoint.x, startPoint.y, currentPoint.x, currentPoint.y);
      if (!samePathList(lastSelectedPaths, paths)) {
        lastSelectedPaths = paths;
        onSelectPaths?.(paths);
      }
    }

    function cancelAutoScroll() {
      if (animationFrame === null) return;
      window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }

    function scheduleAutoScroll() {
      const velocity = marqueeScrollVelocity(lastY, listElement.getBoundingClientRect());
      const maxScrollTop = Math.max(0, listElement.scrollHeight - listElement.clientHeight);
      const canScroll = velocity < 0 ? listElement.scrollTop > 0 : velocity > 0 && listElement.scrollTop < maxScrollTop;
      if (!active || !moved || velocity === 0 || !canScroll) {
        cancelAutoScroll();
        return;
      }
      if (animationFrame === null) animationFrame = window.requestAnimationFrame(runAutoScroll);
    }

    function runAutoScroll() {
      animationFrame = null;
      if (!active || !moved) return;

      const velocity = marqueeScrollVelocity(lastY, listElement.getBoundingClientRect());
      const maxScrollTop = Math.max(0, listElement.scrollHeight - listElement.clientHeight);
      const previousScrollTop = listElement.scrollTop;
      const nextScrollTop = clamp(previousScrollTop + velocity, 0, maxScrollTop);
      if (nextScrollTop === previousScrollTop) return;

      listElement.scrollTop = nextScrollTop;
      updateSelection();
      scheduleAutoScroll();
    }

    function onMouseMove(moveEvent: MouseEvent) {
      lastX = moveEvent.clientX;
      lastY = moveEvent.clientY;
      const distance = Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY);
      if (distance < 4) return;
      moved = true;
      updateSelection();
      scheduleAutoScroll();
    }

    function onMouseUp(upEvent: MouseEvent) {
      const wasMoved = moved;
      cleanup();
      if (!wasMoved) {
        if (clickedPath) {
          onSelectEntry(clickedPath, { ctrlKey: upEvent.ctrlKey, shiftKey: upEvent.shiftKey });
        }
        return;
      }
    }

    function cleanup(clearVisual = true) {
      if (!active) return;
      active = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("blur", onWindowBlur);
      cancelAutoScroll();
      if (clearVisual) setDragBox(null);
      if (dragSelectionCleanupRef.current === cleanup) dragSelectionCleanupRef.current = null;
    }

    function onWindowBlur() {
      cleanup();
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    window.addEventListener("blur", onWindowBlur);
    dragSelectionCleanupRef.current = cleanup;
  }

  function pathsInsideSelection(listElement: HTMLDivElement, startX: number, startY: number, endX: number, endY: number) {
    const selectionRect = normalizeRect(startX, startY, endX, endY);
    const listRect = listElement.getBoundingClientRect();
    const rows = listElement.querySelectorAll<HTMLTableRowElement>("tbody tr[data-entry-path]");
    return Array.from(rows)
      .filter((row) => {
        const rowRect = row.getBoundingClientRect();
        return rectsIntersect(selectionRect, {
          left: listElement.scrollLeft,
          top: rowRect.top - listRect.top + listElement.scrollTop,
          right: listElement.scrollLeft + listRect.width,
          bottom: rowRect.bottom - listRect.top + listElement.scrollTop,
        });
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
const marqueeEdgeSize = 32;
const marqueeMaxScrollSpeed = 18;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function sortEntries(entries: Entry[], sortState: SortState) {
  if (!sortState) return entries;
  const direction = sortState.direction === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    const groupOrder = compareEntryGroups(a, b, sortState);
    return groupOrder || compareEntries(a, b, sortState.column) * direction;
  });
}

function compareEntryGroups(a: Entry, b: Entry, sortState: NonNullable<SortState>) {
  const aIsDirectory = a.type === "directory";
  const bIsDirectory = b.type === "directory";
  if (aIsDirectory === bIsDirectory) return 0;

  const nonDirectoriesFirst = sortState.column === "name" && sortState.direction === "desc";
  if (nonDirectoriesFirst) return aIsDirectory ? 1 : -1;
  return aIsDirectory ? -1 : 1;
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
  return target instanceof Element && Boolean(
    target.closest("button, input, select, textarea, a, thead, [data-file-drag-handle], [role='checkbox'], [role='separator']"),
  );
}

function normalizeRect(startX: number, startY: number, endX: number, endY: number) {
  return {
    left: Math.min(startX, endX),
    top: Math.min(startY, endY),
    right: Math.max(startX, endX),
    bottom: Math.max(startY, endY),
  };
}

function listContentPoint(list: HTMLDivElement, clientX: number, clientY: number) {
  const rect = list.getBoundingClientRect();
  return {
    x: clientX - rect.left + list.scrollLeft,
    y: clientY - rect.top + list.scrollTop,
  };
}

function marqueeScrollVelocity(pointerY: number, listRect: DOMRect) {
  const topDistance = listRect.top + marqueeEdgeSize - pointerY;
  if (topDistance > 0) {
    return -Math.ceil(marqueeMaxScrollSpeed * clamp(topDistance / marqueeEdgeSize, 0, 1));
  }

  const bottomDistance = pointerY - (listRect.bottom - marqueeEdgeSize);
  if (bottomDistance > 0) {
    return Math.ceil(marqueeMaxScrollSpeed * clamp(bottomDistance / marqueeEdgeSize, 0, 1));
  }
  return 0;
}

function samePathList(left: string[] | null, right: string[]) {
  return left !== null && left.length === right.length && left.every((path, index) => path === right[index]);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function rectsIntersect(
  left: { left: number; top: number; right: number; bottom: number },
  right: { left: number; top: number; right: number; bottom: number },
) {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

function samePathFit(current: FittedPathSegments, visible: PathSegment[], hidden: PathSegment[] = []) {
  return (
    current.visible.length === visible.length &&
    current.hidden.length === hidden.length &&
    current.visible.every((segment, index) => segment.path === visible[index]?.path) &&
    current.hidden.every((segment, index) => segment.path === hidden[index]?.path)
  );
}
