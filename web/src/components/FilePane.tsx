import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { MenuItem, MenuPopup, MenuPortal, MenuPositioner, MenuRoot, MenuTrigger } from "@/components/ui/menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { Entry, Root } from "../api/types";
import { entryTypeLabel, type EntryTypeLabels } from "../entryType";
import { paneDropId, type FileDropData, type FileDropFeedback, type PaneKey } from "../fileDrag";
import type { FileSelectionModifiers } from "../fileSelection";
import { createFileSelectionStore, type FileSelectionStore } from "../fileSelectionStore";
import {
  defaultFilePaneColumnWidths,
  type FilePaneColumnKey,
  type FilePaneSortKey,
  type FilePaneSortState,
  type FilePaneViewState,
} from "../filePaneViewState";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";
import { pathsInsideMarquee, type MarqueeGeometry } from "../marqueeSelection";
import { buildPathSegments, displayPath, fitPathSegments, normalizeInput } from "../pathSegments";
import type { FittedPathSegments, PathSegment } from "../pathSegments";
import { ErrorBanner } from "./ErrorBanner";
import type { FileContextAction } from "./fileActions";
import { FileRow } from "./FileRow";
import { PaneContextMenu } from "./PaneContextMenu";
import { PaneStatusBar } from "./PaneStatusBar";

type FilePaneProps = {
  accountId?: string;
  ancestorIds?: string[];
  provider?: "cloud115";
  directoryId?: string;
  dragData?(entry: Entry): Record<string, unknown>;
  onOpenDirectory?(entry: Entry): void;
  paneKey?: PaneKey;
  dropLayer?: number;
  dropWindowId?: string;
  dropDisabled?: boolean;
  actions?: FileContextAction[];
  actionsForSelection?(selectedCount: number): FileContextAction[];
  onContextTarget?(path: string | null): void;
  dropFeedback?: FileDropFeedback | null;
  title: string;
  roots: Root[];
  selectedRootId: string;
  currentPath: string;
  entries: Entry[];
  cutPaths?: ReadonlySet<string>;
  isLinkSource?(entry: Entry): boolean;
  initialViewState?: FilePaneViewState;
  onViewStateChange?(state: FilePaneViewState): void;
  showRootSelector?: boolean;
  pathRootLabel?: string;
  rootCatalogLabel?: string;
  onOpenRootCatalog?(): void;
  navigation?: FilePaneNavigation;
  selectedPaths?: ReadonlySet<string>;
  selectionStore?: FileSelectionStore;
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

type FilePaneNavigation = {
  backTarget: string | null;
  forwardTarget: string | null;
  upTarget: string | null;
  onBack(): void;
  onForward(): void;
  onUp(): void;
};

export function FilePane({
  accountId,
  ancestorIds,
  provider,
  directoryId,
  dragData,
  onOpenDirectory,
  paneKey = "left",
  dropLayer = 0,
  dropWindowId,
  dropDisabled = false,
  actions = [],
  actionsForSelection,
  onContextTarget = () => undefined,
  dropFeedback = null,
  title,
  roots,
  selectedRootId,
  currentPath,
  entries,
  cutPaths,
  isLinkSource = () => false,
  initialViewState,
  onViewStateChange,
  showRootSelector = true,
  pathRootLabel,
  rootCatalogLabel,
  onOpenRootCatalog,
  navigation,
  selectedPaths,
  selectionStore,
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
  const [sortState, setSortState] = useState<FilePaneSortState>(() => initialViewState?.sortState ?? { column: "name", direction: "asc" });
  const [columnWidths, setColumnWidths] = useState<Record<FilePaneColumnKey, number>>(() => ({
    ...(initialViewState?.columnWidths ?? defaultFilePaneColumnWidths),
  }));
  const [, refreshContextActions] = useState(0);
  const [fittedPath, setFittedPath] = useState<FittedPathSegments>(() => ({
    visible: buildPathSegments(currentPath),
    hidden: [],
  }));
  const paneRef = useRef<HTMLElement>(null);
  const fileListRef = useRef<HTMLDivElement>(null);
  const fallbackSelectionStoreRef = useRef<FileSelectionStore | null>(null);
  if (fallbackSelectionStoreRef.current === null) {
    fallbackSelectionStoreRef.current = createFileSelectionStore(entries, selectedPaths ?? []);
  }
  const selection = selectionStore ?? fallbackSelectionStoreRef.current;
  const dragSelectionCleanupRef = useRef<((clearVisual?: boolean) => void) | null>(null);
  const dragSelectionBoxRef = useRef<DragSelectionBoxHandle>(null);
  const pathSegmentsContentRef = useRef<HTMLDivElement>(null);
  const pathSegmentsMeasureRef = useRef<HTMLDivElement>(null);
  const columnsResizedRef = useRef(initialViewState?.columnsResized ?? false);
  const onViewStateChangeRef = useRef(onViewStateChange);
  const rowCallbacksRef = useRef({ onToggleSelection, onSelectEntry, onSelectAll, onPathChange, onOpenFile, onOpenDirectory });
  const visibleOrderCallbackRef = useRef(onVisibleOrderChange);
  const visibleEntries = useMemo(() => sortEntries(entries, sortState, labels), [entries, labels, sortState]);
  const contextActions = actionsForSelection?.(selection.getSummary().selectedCount) ?? actions;
  const suggestions = useMemo(
    () =>
      entries
        .filter((entry) => entry.type === "directory")
        .filter((entry) => (entry.navigationPath ?? entry.relativePath).toLowerCase().startsWith(normalizeInput(pathDraft).toLowerCase()))
        .slice(0, 8),
    [entries, pathDraft],
  );

  const pathSegments = useMemo(() => {
    const segments = buildPathSegments(currentPath).map((segment, index) =>
      index === 0 && pathRootLabel ? { ...segment, label: pathRootLabel } : segment,
    );
    return rootCatalogLabel && onOpenRootCatalog
      ? [{ label: rootCatalogLabel, path: virtualRootSegmentPath }, ...segments]
      : segments;
  }, [currentPath, onOpenRootCatalog, pathRootLabel, rootCatalogLabel]);
  const singleRoot = roots.length <= 1;
  const paneTarget: FileDropData = {
    accountId,
    ancestorIds,
    provider,
    id: paneDropId(paneKey),
    kind: "current-directory",
    pane: paneKey,
    rootId: selectedRootId,
    path: directoryId ?? currentPath,
    label: labels.currentDirectory,
    layer: dropLayer,
    windowId: dropWindowId,
  };
  const paneDrop = useDroppable({
    id: paneTarget.id,
    data: paneTarget,
    disabled: loading || Boolean(error) || dropDisabled,
  });
  const setPaneDropNodeRef = paneDrop.setNodeRef;
  const setFileListNode = useCallback((node: HTMLDivElement | null) => {
    fileListRef.current = node;
    setPaneDropNodeRef(node);
  }, [setPaneDropNodeRef]);
  const paneFeedback = dropFeedback?.target.id === paneTarget.id ? dropFeedback : null;
  const paneDropState = paneFeedback ? (paneFeedback.valid ? "valid" : "invalid") : undefined;

  useLayoutEffect(() => {
    rowCallbacksRef.current = { onToggleSelection, onSelectEntry, onSelectAll, onPathChange, onOpenFile, onOpenDirectory };
    visibleOrderCallbackRef.current = onVisibleOrderChange;
    onViewStateChangeRef.current = onViewStateChange;
  }, [onOpenDirectory, onOpenFile, onPathChange, onSelectAll, onSelectEntry, onToggleSelection, onViewStateChange, onVisibleOrderChange]);

  useEffect(() => {
    onViewStateChangeRef.current?.({ sortState, columnWidths, columnsResized: columnsResizedRef.current });
  }, [columnWidths, sortState]);

  useLayoutEffect(() => {
    selection.setEntries(entries);
    if (!selectionStore) selection.replace(selectedPaths ?? []);
  }, [entries, selectedPaths, selection, selectionStore]);

  const handleRowToggle = useCallback((path: string) => {
    rowCallbacksRef.current.onToggleSelection(path);
  }, []);
  const handleRowSelect = useCallback((path: string, modifiers: FileSelectionModifiers) => {
    rowCallbacksRef.current.onSelectEntry(path, modifiers);
  }, []);
  const handleSelectAll = useCallback((checked: boolean) => {
    rowCallbacksRef.current.onSelectAll(checked);
  }, []);
  const handleRowOpen = useCallback((entry: Entry) => {
    if (entry.type === "directory") {
      if (rowCallbacksRef.current.onOpenDirectory) rowCallbacksRef.current.onOpenDirectory(entry);
      else rowCallbacksRef.current.onPathChange(entry.relativePath);
    }
    else rowCallbacksRef.current.onOpenFile?.(entry);
  }, []);

  useEffect(() => {
    setPathDraft(displayPath(currentPath));
    setHighlightedSuggestion(-1);
  }, [currentPath]);

  useLayoutEffect(() => {
    if (fileListRef.current) fileListRef.current.scrollTop = 0;
  }, [currentPath, selectedRootId]);

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
    const paths = visibleEntries.map((entry) => entry.relativePath);
    selection.setVisibleOrder(paths);
    visibleOrderCallbackRef.current?.(paths);
  }, [selection, visibleEntries]);

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
      ref={paneRef}
      className="file-pane"
      data-provider={provider}
      data-pane-key={paneKey}
      data-root-id={selectedRootId}
      data-directory-path={directoryId ?? currentPath}
      tabIndex={-1}
      data-drop-window-id={dropWindowId}
      data-drop-disabled={dropDisabled ? "true" : undefined}
      aria-label={title}
      aria-current={isActive ? "true" : undefined}
      data-active={isActive ? "true" : "false"}
      onPointerDownCapture={(event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        onActivate();
        if (!preservesNativeFocus(event.target)) paneRef.current?.focus({ preventScroll: true });
      }}
      onClick={onActivate}
    >
      <div className="pane-header" data-root-selector={showRootSelector ? "visible" : "hidden"}>
        <strong>{title}</strong>
        <div className="pane-navigation">
          <PaneNavigationButton
            label={navigation?.backTarget ? labels.backToFolder(navigation.backTarget) : labels.back}
            enabled={Boolean(navigation?.backTarget)}
            onClick={() => navigation?.onBack()}
            icon={<ArrowLeft />}
          />
          <PaneNavigationButton
            label={navigation?.forwardTarget ? labels.forwardToFolder(navigation.forwardTarget) : labels.forward}
            enabled={Boolean(navigation?.forwardTarget)}
            onClick={() => navigation?.onForward()}
            icon={<ArrowRight />}
          />
          <PaneNavigationButton
            label={navigation?.upTarget ? labels.upToFolder(navigation.upTarget) : labels.up}
            enabled={Boolean(navigation?.upTarget)}
            onClick={() => navigation?.onUp()}
            icon={<ArrowUp />}
          />
        </div>
        {!showRootSelector ? (
          <span className="root-marker" aria-label={labels.rootLabel(title)} title={pathRootLabel}>
            {pathRootLabel ?? "/"}
          </span>
        ) : singleRoot ? (
          <span className="root-marker" aria-label={labels.rootLabel(title)}>
            /
          </span>
        ) : (
          <Select
            items={roots.map((root) => ({ value: root.id, label: root.name }))}
            value={selectedRootId}
            onValueChange={(next) => {
              if (next !== null && next !== selectedRootId) onRootChange(next);
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={labels.rootLabel(title)}
              className="pane-root-select-trigger"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              align="start"
              alignItemWithTrigger={false}
              className="pane-root-select-menu"
            >
              {roots.map((root) => (
                <SelectItem key={root.id} value={root.id}>{root.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
                    if (onOpenDirectory) onOpenDirectory(entry);
                    else onPathChange(entry.relativePath);
                  }}
                >
                  {entry.navigationPath ?? entry.relativePath}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={labels.refreshLabel(title)}
          title={labels.refresh}
          onClick={onRefresh}
        >
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
      <PaneContextMenu actions={contextActions} label={labels.fileActions}>
        <div className="file-list-frame" data-drop-state={paneDropState}>
          <div
            className="file-list"
            data-testid={`file-list-${paneKey}`}
            ref={setFileListNode}
            aria-busy={loading}
            onMouseDown={startDragSelection}
            onContextMenuCapture={(event) => {
              onActivate();
              const element = event.target instanceof Element ? event.target : null;
              const row = element?.closest<HTMLTableRowElement>("tbody tr[data-entry-path]");
              onContextTarget(row?.dataset.entryPath ?? null);
              refreshContextActions((version) => version + 1);
            }}
          >
        {loading && entries.length === 0 ? (
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
                  <SelectAllCheckbox
                    label={labels.selectAllVisible}
                    selectionStore={selection}
                    onChange={handleSelectAll}
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
                provider={provider}
                accountId={accountId}
                ancestorIds={ancestorIds}
                dragData={dragData?.(entry)}
                paneKey={paneKey}
                dropLayer={dropLayer}
                dropWindowId={dropWindowId}
                dropDisabled={dropDisabled || loading || Boolean(error)}
                rootId={selectedRootId}
                parentPath={currentPath}
                entry={entry}
                isCut={cutPaths?.has(entry.relativePath)}
                isLinkSource={isLinkSource(entry)}
                selectionStore={selection}
                dropFeedback={dropFeedback}
                labels={labels}
                onToggleSelection={handleRowToggle}
                onSelect={handleRowSelect}
                onOpen={handleRowOpen}
              />
            ))}
          </tbody>
          </table>
        )}
          <DragSelectionBox ref={dragSelectionBoxRef} />
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
      <SelectionPaneStatusBar
        selectionStore={selection}
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
    const opensRootCatalog = segment.path === virtualRootSegmentPath && Boolean(onOpenRootCatalog);
    return (
      <button
        key={`${segment.path}-${index}`}
        type="button"
        className="path-segment-button"
        onClick={() => opensRootCatalog ? onOpenRootCatalog?.() : onPathChange(segment.path)}
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
    let geometry: MeasuredMarqueeGeometry | null = null;
    let pointerDirty = false;
    let lastSelectedPaths: string[] | null = null;

    function updateSelection() {
      if (!geometry) return;
      const currentPoint = listContentPointFromGeometry(listElement, geometry, lastX, lastY);
      const left = Math.min(startPoint.x, currentPoint.x);
      const top = Math.min(startPoint.y, currentPoint.y);
      const right = Math.max(startPoint.x, currentPoint.x);
      const bottom = Math.max(startPoint.y, currentPoint.y);
      dragSelectionBoxRef.current?.update({
        left,
        top,
        width: right - left,
        height: bottom - top,
      });

      const paths = pathsInsideMarquee(geometry, startPoint.x, startPoint.y, currentPoint.x, currentPoint.y);
      if (!samePathList(lastSelectedPaths, paths)) {
        lastSelectedPaths = paths;
        onSelectPaths?.(paths);
      }
    }

    function cancelScheduledFrame() {
      if (animationFrame === null) return;
      window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }

    function canAutoScroll() {
      if (!geometry) return false;
      const velocity = marqueeScrollVelocity(lastY, geometry.listRect);
      return velocity < 0 ? listElement.scrollTop > 0 : velocity > 0 && listElement.scrollTop < geometry.maxScrollTop;
    }

    function scheduleFrame() {
      if (animationFrame === null) animationFrame = window.requestAnimationFrame(runFrame);
    }

    function runFrame() {
      animationFrame = null;
      if (!active || !moved || !geometry) return;

      const shouldUpdate = pointerDirty;
      pointerDirty = false;
      const velocity = marqueeScrollVelocity(lastY, geometry.listRect);
      const previousScrollTop = listElement.scrollTop;
      const nextScrollTop = clamp(previousScrollTop + velocity, 0, geometry.maxScrollTop);
      const didScroll = nextScrollTop !== previousScrollTop;

      if (didScroll) listElement.scrollTop = nextScrollTop;
      if (shouldUpdate || didScroll) updateSelection();
      if (active && moved && (pointerDirty || canAutoScroll())) scheduleFrame();
    }

    function onMouseMove(moveEvent: MouseEvent) {
      lastX = moveEvent.clientX;
      lastY = moveEvent.clientY;
      const distance = Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY);
      if (distance < 4) return;
      if (!moved) {
        moved = true;
        geometry = measureMarqueeGeometry(listElement);
      }
      pointerDirty = true;
      scheduleFrame();
    }

    function onMouseUp(upEvent: MouseEvent) {
      const wasMoved = moved;
      if (wasMoved && pointerDirty) {
        cancelScheduledFrame();
        pointerDirty = false;
        updateSelection();
      }
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
      cancelScheduledFrame();
      geometry = null;
      pointerDirty = false;
      if (clearVisual) dragSelectionBoxRef.current?.clear();
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
      if (selectedSuggestion && onOpenDirectory) onOpenDirectory(selectedSuggestion);
      else onPathChange(selectedSuggestion?.relativePath ?? normalizeInput(pathDraft));
    }
  }
}

type SortKey = FilePaneSortKey;
type ColumnKey = FilePaneColumnKey;
type SortState = FilePaneSortState;
type DragBox = { left: number; top: number; width: number; height: number };
type DragSelectionBoxHandle = { update(box: DragBox): void; clear(): void };
type MeasuredMarqueeGeometry = MarqueeGeometry & {
  listRect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  maxScrollTop: number;
};

const defaultColumnWidths = defaultFilePaneColumnWidths;
const virtualRootSegmentPath = "filebutler://virtual-root";
const defaultTableWidth = Object.values(defaultColumnWidths).reduce((sum, width) => sum + width, 0);
const rightSelectionGutter = 24;
const marqueeEdgeSize = 32;
const marqueeMaxScrollSpeed = 18;

function PaneNavigationButton({
  label,
  enabled,
  onClick,
  icon,
}: {
  label: string;
  enabled: boolean;
  onClick(): void;
  icon: ReactNode;
}) {
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={enabled ? label : undefined}
      disabled={!enabled}
      onClick={onClick}
    >
      {icon}
    </Button>
  );
  return button;
}

const SelectAllCheckbox = memo(function SelectAllCheckbox({
  label,
  selectionStore,
  onChange,
}: {
  label: string;
  selectionStore: FileSelectionStore;
  onChange(checked: boolean): void;
}) {
  const allVisibleSelected = useSyncExternalStore(
    selectionStore.subscribeSummary,
    () => selectionStore.getSummary().allVisibleSelected,
    () => selectionStore.getSummary().allVisibleSelected,
  );
  return (
    <Checkbox
      aria-label={label}
      checked={allVisibleSelected}
      onCheckedChange={(next) => onChange(next === true)}
    />
  );
});

const SelectionPaneStatusBar = memo(function SelectionPaneStatusBar({
  selectionStore,
  visibleCount,
  labels,
}: {
  selectionStore: FileSelectionStore;
  visibleCount: number;
  labels: UIStrings;
}) {
  const summary = useSelectionSummary(selectionStore);
  return (
    <PaneStatusBar
      selectedCount={summary.selectedCount}
      selectedBytes={summary.selectedBytes}
      visibleCount={visibleCount}
      labels={labels}
    />
  );
});

function useSelectionSummary(selectionStore: FileSelectionStore) {
  return useSyncExternalStore(
    selectionStore.subscribeSummary,
    selectionStore.getSummary,
    selectionStore.getSummary,
  );
}

const DragSelectionBox = memo(forwardRef<DragSelectionBoxHandle>(function DragSelectionBox(_, ref) {
  const [visible, setVisible] = useState(false);
  const elementRef = useRef<HTMLDivElement>(null);
  const pendingBoxRef = useRef<DragBox | null>(null);

  useImperativeHandle(ref, () => ({
    update(box) {
      pendingBoxRef.current = box;
      if (elementRef.current) applyDragBoxStyle(elementRef.current, box);
      else setVisible(true);
    },
    clear() {
      pendingBoxRef.current = null;
      setVisible(false);
    },
  }), []);

  useLayoutEffect(() => {
    if (elementRef.current && pendingBoxRef.current) {
      applyDragBoxStyle(elementRef.current, pendingBoxRef.current);
    }
  }, [visible]);

  return visible ? <div ref={elementRef} className="drag-selection-box" /> : null;
}));

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function sortEntries(entries: Entry[], sortState: SortState, labels: EntryTypeLabels) {
  if (!sortState) return entries;
  const direction = sortState.direction === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    const groupOrder = compareEntryGroups(a, b, sortState);
    return groupOrder || compareEntries(a, b, sortState.column, labels) * direction;
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

function compareEntries(a: Entry, b: Entry, column: SortKey, labels: EntryTypeLabels) {
  switch (column) {
    case "name":
      return collator.compare(a.name, b.name);
    case "type":
      return collator.compare(entryTypeLabel(a, labels), entryTypeLabel(b, labels)) || collator.compare(a.name, b.name);
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

function preservesNativeFocus(target: EventTarget) {
  return target instanceof Element && Boolean(target.closest(
    "button, input, select, textarea, a[href], [contenteditable='true'], [contenteditable='plaintext-only']",
  ));
}

function listContentPoint(list: HTMLDivElement, clientX: number, clientY: number) {
  const rect = list.getBoundingClientRect();
  return {
    x: clientX - rect.left + list.scrollLeft,
    y: clientY - rect.top + list.scrollTop,
  };
}

function measureMarqueeGeometry(list: HTMLDivElement): MeasuredMarqueeGeometry {
  const measuredListRect = list.getBoundingClientRect();
  const listRect = {
    left: measuredListRect.left,
    top: measuredListRect.top,
    right: measuredListRect.right,
    bottom: measuredListRect.bottom,
    width: measuredListRect.width,
    height: measuredListRect.height,
  };
  const rows = Array.from(list.querySelectorAll<HTMLTableRowElement>("tbody tr[data-entry-path]")).flatMap((row) => {
    const path = row.dataset.entryPath;
    if (!path) return [];
    const rowRect = row.getBoundingClientRect();
    return [{
      path,
      top: rowRect.top - listRect.top + list.scrollTop,
      bottom: rowRect.bottom - listRect.top + list.scrollTop,
    }];
  });

  return {
    listRect,
    contentLeft: list.scrollLeft,
    contentRight: list.scrollLeft + listRect.width,
    maxScrollTop: Math.max(0, list.scrollHeight - list.clientHeight),
    rows,
  };
}

function listContentPointFromGeometry(
  list: HTMLDivElement,
  geometry: MeasuredMarqueeGeometry,
  clientX: number,
  clientY: number,
) {
  return {
    x: clientX - geometry.listRect.left + list.scrollLeft,
    y: clientY - geometry.listRect.top + list.scrollTop,
  };
}

function applyDragBoxStyle(element: HTMLDivElement, box: DragBox) {
  element.style.transform = `translate3d(${box.left}px, ${box.top}px, 0)`;
  element.style.width = `${box.width}px`;
  element.style.height = `${box.height}px`;
}

function marqueeScrollVelocity(pointerY: number, listRect: Pick<DOMRect, "top" | "bottom">) {
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

function samePathFit(current: FittedPathSegments, visible: PathSegment[], hidden: PathSegment[] = []) {
  return (
    current.visible.length === visible.length &&
    current.hidden.length === hidden.length &&
    current.visible.every((segment, index) => segment.path === visible[index]?.path) &&
    current.hidden.every((segment, index) => segment.path === hidden[index]?.path)
  );
}
