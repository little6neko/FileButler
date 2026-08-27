import {
  ChevronDown,
  ChevronRight,
  FileQuestion,
  Folder,
  FolderOpen,
  FolderTree,
  Image,
  Link,
  TriangleAlert,
  Video,
} from "lucide-react";
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
  SuperRenameProjectedGroup,
  SuperRenameProjectedItem,
  SuperRenameProjection,
} from "../superRename";

type SuperRenameTreeProps = {
  projection: SuperRenameProjection;
  expandedGroups: ReadonlySet<string>;
  disabled?: boolean;
  labels: UIStrings;
  onItemSelected(sourcePath: string, selected: boolean): void;
  onGroupSelected(groupPath: string, selected: boolean): void;
  onGroupExpanded(groupPath: string, expanded: boolean): void;
};

export function SuperRenameTree({
  projection,
  expandedGroups,
  disabled = false,
  labels,
  onItemSelected,
  onGroupSelected,
  onGroupExpanded,
}: SuperRenameTreeProps) {
  return (
    <div data-testid="super-rename-tree-scroll" className="min-h-0 min-w-0 flex-1 overflow-auto rounded-lg border">
      <Table containerClassName="overflow-visible" className="min-w-[860px]" aria-label={labels.superRename}>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead className="w-[45%]">{labels.superRenameCurrentItem}</TableHead>
            <TableHead className="w-[35%]">{labels.superRenamePlannedResult}</TableHead>
            <TableHead>{labels.status}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projection.groups.map((group) => (
            <GroupRows
              key={group.path}
              group={group}
              expanded={expandedGroups.has(group.path)}
              disabled={disabled}
              labels={labels}
              onItemSelected={onItemSelected}
              onGroupSelected={onGroupSelected}
              onGroupExpanded={onGroupExpanded}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function GroupRows({
  group,
  expanded,
  disabled,
  labels,
  onItemSelected,
  onGroupSelected,
  onGroupExpanded,
}: {
  group: SuperRenameProjectedGroup;
  expanded: boolean;
  disabled: boolean;
  labels: UIStrings;
  onItemSelected(sourcePath: string, selected: boolean): void;
  onGroupSelected(groupPath: string, selected: boolean): void;
  onGroupExpanded(groupPath: string, expanded: boolean): void;
}) {
  const visibleUnmatched = group.unmatched.filter((item) => (
    item.path !== group.videoDirectory.path || group.videoDirectory.status !== "blocking-entry"
  ));
  const hasChildren = group.matchedCount > 0 || visibleUnmatched.length > 0 || group.videoDirectory.status !== "missing";
  const conflictCount = [...group.images, ...group.videos].filter((item) => item.conflict).length;
  const groupTone = group.recoveryResidues.length > 0 || group.hasConflict
    ? "bg-red-50/70 dark:bg-red-950/20"
    : group.matchedCount === 0
      ? "bg-amber-50/70 dark:bg-amber-950/20"
      : "bg-blue-50/50 dark:bg-blue-950/20";
  const selectedVideos = group.videos.filter((item) => item.selected).length;
  const showVideoDirectory = selectedVideos > 0 || group.videoDirectory.status !== "missing";

  return (
    <>
      <TableRow className={groupTone} data-testid={`super-rename-group-${group.path}`}>
        <TableCell className="py-2 font-medium">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              className="grid size-6 shrink-0 place-items-center rounded hover:bg-black/5 disabled:opacity-30"
              aria-label={expanded ? labels.superRenameCollapseGroup(group.name) : labels.superRenameExpandGroup(group.name)}
              aria-expanded={expanded}
              disabled={!hasChildren}
              onClick={() => onGroupExpanded(group.path, !expanded)}
            >
              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
            <Checkbox
              nativeButton
              render={<button type="button" />}
              aria-label={labels.superRenameSelectGroup(group.name)}
              checked={group.selectionState === "all"}
              indeterminate={group.selectionState === "some"}
              disabled={disabled || group.matchedCount === 0}
              onCheckedChange={(checked) => onGroupSelected(group.path, checked === true)}
            />
            <Folder className="size-4 shrink-0 text-blue-600" />
            <span className="truncate" title={group.path}>{group.name}</span>
          </div>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {group.matchedCount > 0 ? `${group.selectedCount} / ${group.matchedCount}` : "—"}
        </TableCell>
        <TableCell className={group.hasConflict ? "text-xs font-medium text-destructive" : group.matchedCount === 0 ? "text-xs font-medium text-amber-700" : "text-xs text-emerald-700"}>
          {groupStatus(group, conflictCount, labels)}
        </TableCell>
      </TableRow>
      {expanded ? group.images.map((item) => (
        <CandidateRow
          key={item.sourcePath}
          item={item}
          icon={<Image className="size-4 text-sky-600" />}
          depth="pl-10"
          disabled={disabled}
          labels={labels}
          onSelected={onItemSelected}
        />
      )) : null}
      {expanded && showVideoDirectory ? (
        <TableRow className={group.videoDirectory.status === "blocking-entry" ? "bg-red-50/60 dark:bg-red-950/20" : "bg-emerald-50/40 dark:bg-emerald-950/15"}>
          <TableCell className="py-1.5 pl-10">
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
        </TableRow>
      ) : null}
      {expanded ? group.videos.map((item) => (
        <CandidateRow
          key={item.sourcePath}
          item={item}
          icon={<Video className="size-4 text-violet-600" />}
          depth="pl-16"
          disabled={disabled}
          labels={labels}
          onSelected={onItemSelected}
        />
      )) : null}
      {expanded ? visibleUnmatched.map((item) => {
        const recovery = group.recoveryResidues.includes(item.path);
        return (
          <TableRow key={item.path} className={recovery ? "bg-red-50/60 dark:bg-red-950/20" : "bg-amber-50/60 dark:bg-amber-950/20"}>
            <TableCell className="py-1.5 pl-10">
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
          </TableRow>
        );
      }) : null}
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
  depth: string;
  disabled: boolean;
  labels: UIStrings;
  onSelected(sourcePath: string, selected: boolean): void;
}) {
  const rowTone = item.conflict
    ? "bg-red-50/60 dark:bg-red-950/20"
    : !item.selected
      ? "text-muted-foreground opacity-70"
      : "bg-emerald-50/30 dark:bg-emerald-950/10";
  return (
    <TableRow className={rowTone} data-testid={`super-rename-item-${item.sourcePath}`}>
      <TableCell className={`py-1.5 ${depth}`}>
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
    </TableRow>
  );
}

function groupStatus(group: SuperRenameProjectedGroup, conflictCount: number, labels: UIStrings): string {
  if (group.recoveryResidues.length > 0) return labels.superRenameRecoveryRequired;
  if (conflictCount > 0) return labels.conflictsFound(conflictCount);
  if (group.matchedCount === 0) return labels.superRenameNoMatches;
  if (group.selectedCount === 0) return labels.superRenameCanceled;
  return labels.ready;
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
