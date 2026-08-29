import {
  ChevronDown,
  ChevronRight,
  FileQuestion,
  Folder,
  FolderOpen,
  FolderTree,
  Image,
  Link,
  LoaderCircle,
  PencilLine,
  TriangleAlert,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { UIStrings } from "../i18n";
import type {
  SuperRenameDirectoryNode,
} from "../superRenameManager";
import type {
  SuperRenameProjectedGroup,
  SuperRenameProjectedItem,
  SuperRenameProjection,
} from "../superRename";

type SuperRenameTreeProps = {
  projection: SuperRenameProjection;
  directoryNodes: Readonly<Record<string, SuperRenameDirectoryNode>>;
  rootGroupPaths: readonly string[];
  expandedGroups: ReadonlySet<string>;
  submittingGroups?: ReadonlySet<string>;
  disabled?: boolean;
  labels: UIStrings;
  onItemSelected(sourcePath: string, selected: boolean): void;
  onGroupSelected(groupPath: string, selected: boolean): void;
  onGroupExpanded(groupPath: string, expanded: boolean): void;
  onGroupSubmit(groupPath: string): void;
};

const emptySubmittingGroups: ReadonlySet<string> = new Set();

export function SuperRenameTree({
  projection,
  directoryNodes,
  rootGroupPaths,
  expandedGroups,
  submittingGroups = emptySubmittingGroups,
  disabled = false,
  labels,
  onItemSelected,
  onGroupSelected,
  onGroupExpanded,
  onGroupSubmit,
}: SuperRenameTreeProps) {
  const groupsByPath = new Map(projection.groups.map((group) => [group.path, group]));
  return (
    <div data-testid="super-rename-tree-scroll" className="min-h-0 min-w-0 flex-1 overflow-auto rounded-lg border">
      <Table containerClassName="overflow-visible" className="min-w-[980px]" aria-label={labels.superRename}>
        <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-background [&_th:last-child]:z-30">
          <TableRow>
            <TableHead className="w-[45%]">{labels.superRenameCurrentItem}</TableHead>
            <TableHead className="w-[35%]">{labels.superRenamePlannedResult}</TableHead>
            <TableHead>{labels.status}</TableHead>
            <TableHead className="right-0 w-36 min-w-36 border-l text-left shadow-[-6px_0_10px_-8px_rgba(15,23,42,0.45)]">
              {labels.superRenameGroupAction}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rootGroupPaths.map((groupPath) => (
            <DirectoryRows
              key={groupPath}
              groupPath={groupPath}
              groupsByPath={groupsByPath}
              directoryNodes={directoryNodes}
              expandedGroups={expandedGroups}
              submittingGroups={submittingGroups}
              disabled={disabled}
              labels={labels}
              onItemSelected={onItemSelected}
              onGroupSelected={onGroupSelected}
              onGroupExpanded={onGroupExpanded}
              onGroupSubmit={onGroupSubmit}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type DirectoryRowsProps = {
  groupPath: string;
  groupsByPath: ReadonlyMap<string, SuperRenameProjectedGroup>;
  directoryNodes: Readonly<Record<string, SuperRenameDirectoryNode>>;
  expandedGroups: ReadonlySet<string>;
  submittingGroups: ReadonlySet<string>;
  disabled: boolean;
  labels: UIStrings;
  onItemSelected(sourcePath: string, selected: boolean): void;
  onGroupSelected(groupPath: string, selected: boolean): void;
  onGroupExpanded(groupPath: string, expanded: boolean): void;
  onGroupSubmit(groupPath: string): void;
};

function DirectoryRows(props: DirectoryRowsProps) {
  const {
    groupPath,
    groupsByPath,
    directoryNodes,
    expandedGroups,
    submittingGroups,
    disabled,
    labels,
    onItemSelected,
    onGroupSelected,
    onGroupExpanded,
    onGroupSubmit,
  } = props;
  const node = directoryNodes[groupPath];
  if (!node || node.hidden) return null;
  const group = groupsByPath.get(groupPath);
  const expanded = expandedGroups.has(groupPath);
  const submitting = submittingGroups.has(groupPath);
  const visibleChildPaths = node.childPaths.filter((path) => directoryNodes[path] && !directoryNodes[path].hidden);
  const visibleUnmatched = group?.unmatched.filter((item) => (
    item.path !== group.videoDirectory.path || group.videoDirectory.status !== "blocking-entry"
  )) ?? [];
  const hasOwnRows = Boolean(group) && (
    group!.matchedCount > 0
    || visibleUnmatched.length > 0
    || group!.videoDirectory.status !== "missing"
  );
  const canExpand = node.loadState !== "loaded" || hasOwnRows || visibleChildPaths.length > 0;
  const conflictCount = group
    ? [...group.images, ...group.videos].filter((item) => item.conflict).length
    : 0;
  const groupDisabled = disabled || submitting || node.loadState === "loading" || node.ownLayerCompleted;
  const checkboxDisabled = groupDisabled
    || (node.loadState === "loaded" && (!group || group.matchedCount === 0));
  const selectedVideos = group?.videos.filter((item) => item.selected).length ?? 0;
  const showVideoDirectory = Boolean(group) && (
    selectedVideos > 0 || group!.videoDirectory.status !== "missing"
  );
  const tones = directoryTones(node, group);

  return (
    <>
      <TableRow className={tones.row} data-testid={`super-rename-group-${node.path}`}>
        <TableCell className="py-2 font-medium" style={{ paddingLeft: directoryIndent(node.depth) }}>
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              className="grid size-6 shrink-0 place-items-center rounded hover:bg-black/5 disabled:opacity-30"
              aria-label={expanded ? labels.superRenameCollapseGroup(node.name) : labels.superRenameExpandGroup(node.name)}
              aria-expanded={expanded}
              disabled={!canExpand}
              onClick={() => onGroupExpanded(node.path, !expanded)}
            >
              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
            <Checkbox
              nativeButton
              render={<button type="button" />}
              aria-label={labels.superRenameSelectGroup(node.name)}
              checked={group?.selectionState === "all"}
              indeterminate={group?.selectionState === "some"}
              disabled={checkboxDisabled}
              onCheckedChange={(checked) => onGroupSelected(node.path, checked === true)}
            />
            {node.depth > 0 ? <span aria-hidden="true" className="text-xs text-border">└</span> : null}
            {node.loadState === "loading"
              ? <LoaderCircle className="size-4 shrink-0 animate-spin text-blue-600" />
              : <Folder className="size-4 shrink-0 text-blue-600" />}
            <span className="truncate" title={node.path}>{node.name}</span>
          </div>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {group && group.matchedCount > 0 ? `${group.selectedCount} / ${group.matchedCount}` : "—"}
        </TableCell>
        <TableCell
          className={directoryStatusTone(node, group)}
          title={node.error ?? undefined}
        >
          {directoryStatus(node, group, conflictCount, labels)}
        </TableCell>
        <TableCell className={`sticky right-0 z-20 w-36 min-w-36 border-l px-2 py-1.5 text-right shadow-[-6px_0_10px_-8px_rgba(15,23,42,0.45)] ${tones.action}`}>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full bg-background"
            aria-label={labels.superRenameGroupSubmit(node.name)}
            disabled={groupDisabled || node.loadState !== "loaded" || !group || group.selectedCount === 0 || group.hasConflict}
            onClick={() => onGroupSubmit(node.path)}
          >
            {submitting ? <LoaderCircle className="animate-spin" /> : <PencilLine />}
            {labels.rename}
          </Button>
        </TableCell>
      </TableRow>

      {expanded && group && !node.ownLayerCompleted ? group.images.map((item) => (
        <CandidateRow
          key={item.sourcePath}
          item={item}
          icon={<Image className="size-4 text-sky-600" />}
          depth={node.depth}
          disabled={groupDisabled}
          labels={labels}
          onSelected={onItemSelected}
        />
      )) : null}
      {expanded && group && !node.ownLayerCompleted && showVideoDirectory ? (
        <TableRow className={group.videoDirectory.status === "blocking-entry" ? "bg-red-50/60 dark:bg-red-950/20" : "bg-emerald-50/40 dark:bg-emerald-950/15"}>
          <TableCell className="py-1.5" style={{ paddingLeft: candidateIndent(node.depth) }}>
            <div className="flex items-center gap-2">
              <span className="size-4" />
              <FolderOpen className="size-4 text-violet-600" />
              <span>{group.videoDirectory.path.slice(group.path.length + 1)}/</span>
            </div>
          </TableCell>
          <TableCell className="py-1.5 text-xs text-muted-foreground">{group.videoDirectory.path}/</TableCell>
          <TableCell className={group.videoDirectory.status === "blocking-entry" ? "py-1.5 text-xs font-medium text-destructive" : "py-1.5 text-xs text-emerald-700"}>
            {videoDirectoryResult(group, labels)}
          </TableCell>
          <StickyActionSpacer className={group.videoDirectory.status === "blocking-entry" ? "bg-red-50 dark:bg-red-950" : "bg-emerald-50 dark:bg-emerald-950"} />
        </TableRow>
      ) : null}
      {expanded && group && !node.ownLayerCompleted ? group.videos.map((item) => (
        <CandidateRow
          key={item.sourcePath}
          item={item}
          icon={<Video className="size-4 text-violet-600" />}
          depth={node.depth + 1}
          disabled={groupDisabled}
          labels={labels}
          onSelected={onItemSelected}
        />
      )) : null}
      {expanded && group && !node.ownLayerCompleted ? visibleUnmatched.map((item) => {
        const recovery = group.recoveryResidues.includes(item.path);
        return (
          <TableRow key={item.path} className={recovery ? "bg-red-50/60 dark:bg-red-950/20" : "bg-amber-50/60 dark:bg-amber-950/20"}>
            <TableCell className="py-1.5" style={{ paddingLeft: candidateIndent(node.depth) }}>
              <div className="flex min-w-0 items-center gap-2">
                <Checkbox
                  nativeButton
                  render={<button type="button" />}
                  aria-label={labels.superRenameSelectItem(item.name)}
                  checked={false}
                  disabled
                />
                {unmatchedIcon(item.kind)}
                <span className="truncate" title={item.path}>{item.name}</span>
              </div>
            </TableCell>
            <TableCell className="py-1.5 text-xs text-muted-foreground">—</TableCell>
            <TableCell className={recovery ? "py-1.5 text-xs font-medium text-destructive" : "py-1.5 text-xs font-medium text-amber-700"}>
              {recovery ? labels.superRenameRecoveryRequired : unmatchedStatus(item.reason, labels)}
            </TableCell>
            <StickyActionSpacer className={recovery ? "bg-red-50 dark:bg-red-950" : "bg-amber-50 dark:bg-amber-950"} />
          </TableRow>
        );
      }) : null}
      {expanded ? visibleChildPaths.map((childPath) => (
        <DirectoryRows key={childPath} {...props} groupPath={childPath} />
      )) : null}
    </>
  );
}

function CandidateRow({
  item,
  icon,
  depth,
  disabled,
  labels,
  onSelected,
}: {
  item: SuperRenameProjectedItem;
  icon: React.ReactNode;
  depth: number;
  disabled: boolean;
  labels: UIStrings;
  onSelected(sourcePath: string, selected: boolean): void;
}) {
  const rowTone = item.conflict
    ? "bg-red-50/60 dark:bg-red-950/20"
    : !item.selected
      ? "text-muted-foreground"
      : "bg-emerald-50/30 dark:bg-emerald-950/10";
  return (
    <TableRow className={rowTone} data-testid={`super-rename-item-${item.sourcePath}`}>
      <TableCell className="py-1.5" style={{ paddingLeft: candidateIndent(depth) }}>
        <div className="flex min-w-0 items-center gap-2">
          <Checkbox
            nativeButton
            render={<button type="button" />}
            aria-label={labels.superRenameSelectItem(item.name)}
            checked={item.selected}
            disabled={disabled}
            onCheckedChange={(checked) => onSelected(item.sourcePath, checked === true)}
          />
          {icon}
          <span className="truncate" title={item.sourcePath}>{item.name}</span>
        </div>
      </TableCell>
      <TableCell className={item.selected && item.changed ? "py-1.5 text-xs font-medium text-blue-700" : "py-1.5 text-xs text-muted-foreground"}>
        {item.selected ? item.targetPath : "—"}
      </TableCell>
      <TableCell className={item.conflict ? "py-1.5 text-xs font-medium text-destructive" : item.selected ? "py-1.5 text-xs text-emerald-700" : "py-1.5 text-xs text-muted-foreground"}>
        {candidateStatus(item, labels)}
      </TableCell>
      <StickyActionSpacer className={item.conflict ? "bg-red-50 dark:bg-red-950" : item.selected ? "bg-emerald-50 dark:bg-emerald-950" : "bg-background"} />
    </TableRow>
  );
}

function StickyActionSpacer({ className }: { className: string }) {
  return (
    <TableCell
      aria-hidden="true"
      className={`sticky right-0 z-10 w-36 min-w-36 border-l p-0 shadow-[-6px_0_10px_-8px_rgba(15,23,42,0.45)] ${className}`}
    />
  );
}

function directoryStatus(
  node: SuperRenameDirectoryNode,
  group: SuperRenameProjectedGroup | undefined,
  conflictCount: number,
  labels: UIStrings,
): string {
  if (node.ownLayerCompleted) return labels.superRenameGroupCompleted;
  if (node.loadState === "unloaded") return labels.superRenameNotLoaded;
  if (node.loadState === "loading") return labels.superRenameLoadingGroup;
  if (node.loadState === "failed") return labels.superRenameGroupLoadFailed;
  if (!group) return labels.superRenameLoadedNotSelected;
  if (group.recoveryResidues.length > 0) return labels.superRenameRecoveryRequired;
  if (conflictCount > 0) return labels.conflictsFound(conflictCount);
  if (group.matchedCount === 0) return labels.superRenameNoMatches;
  if (group.selectedCount === 0) return labels.superRenameLoadedNotSelected;
  return labels.ready;
}

function directoryStatusTone(
  node: SuperRenameDirectoryNode,
  group: SuperRenameProjectedGroup | undefined,
): string {
  if (node.loadState === "failed" || group?.hasConflict || (group?.recoveryResidues.length ?? 0) > 0) {
    return "text-xs font-medium text-destructive";
  }
  if (node.ownLayerCompleted || (group && group.selectedCount > 0)) return "text-xs text-emerald-700";
  return "text-xs font-medium text-amber-700";
}

function directoryTones(
  node: SuperRenameDirectoryNode,
  group: SuperRenameProjectedGroup | undefined,
): { row: string; action: string } {
  if (node.loadState === "failed" || group?.hasConflict || (group?.recoveryResidues.length ?? 0) > 0) {
    return { row: "bg-red-50/70 dark:bg-red-950/20", action: "bg-red-50 dark:bg-red-950" };
  }
  if (node.ownLayerCompleted) {
    return { row: "bg-emerald-50/50 dark:bg-emerald-950/15", action: "bg-emerald-50 dark:bg-emerald-950" };
  }
  if (node.loadState !== "loaded" || !group || group.matchedCount === 0) {
    return { row: "bg-amber-50/70 dark:bg-amber-950/20", action: "bg-amber-50 dark:bg-amber-950" };
  }
  return { row: "bg-blue-50/50 dark:bg-blue-950/20", action: "bg-blue-50 dark:bg-blue-950" };
}

function candidateStatus(item: SuperRenameProjectedItem, labels: UIStrings): string {
  if (item.conflict) return labels.superRenameConflict(item.errorCode ?? "");
  if (!item.selected) return labels.superRenameCanceled;
  if (!item.changed) return labels.superRenameUnchanged;
  return labels.ready;
}

function videoDirectoryResult(group: SuperRenameProjectedGroup, labels: UIStrings): string {
  if (group.videoDirectory.status === "blocking-entry") return labels.superRenameVideoBlocked;
  if (group.videoDirectory.status === "directory") return labels.superRenameVideoWillReuse;
  return labels.superRenameVideoWillCreate;
}

function unmatchedStatus(reason: string, labels: UIStrings): string {
  switch (reason) {
    case "nested-directory": return labels.superRenameNotRecursive;
    case "symlink": return labels.superRenameSymlink;
    case "special": return labels.superRenameSpecial;
    default: return labels.superRenameUnsupported;
  }
}

function unmatchedIcon(kind: string): React.ReactNode {
  switch (kind) {
    case "directory": return <FolderTree className="size-4 text-amber-700" />;
    case "symlink": return <Link className="size-4 text-amber-700" />;
    case "other": return <TriangleAlert className="size-4 text-amber-700" />;
    default: return <FileQuestion className="size-4 text-amber-700" />;
  }
}

function directoryIndent(depth: number): number {
  return 8 + depth * 20;
}

function candidateIndent(depth: number): number {
  return 40 + depth * 20;
}
