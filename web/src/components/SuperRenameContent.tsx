import { useEffect, useSyncExternalStore } from "react";
import { CircleAlert, LoaderCircle, RefreshCw, WandSparkles } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { strings, type UIStrings } from "../i18n";
import { terminalJobStatuses } from "../jobEvents";
import { useOptionalJobEventsStore } from "../jobEventsContext";
import { SuperRenameManager } from "../superRenameManager";
import { confirmDialogOnEnter } from "./dialogConfirm";
import { ErrorBanner } from "./ErrorBanner";
import { SuperRenameTree } from "./SuperRenameTree";

type SuperRenameContentProps = {
  manager: SuperRenameManager;
  onJobCreated(id: string): void;
  onGroupJobCreated(id: string): void;
  onClose(): void;
  labels?: UIStrings;
};

export function SuperRenameContent({
  manager,
  onJobCreated,
  onGroupJobCreated,
  onClose,
  labels = strings.en,
}: SuperRenameContentProps) {
  const snapshot = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
  const jobEvents = useOptionalJobEventsStore();
  const projection = snapshot.projection;
  const directoryLoading = Object.values(snapshot.directoryNodes).some((node) => node.loadState === "loading");
  const canSubmit = Boolean(projection)
    && projection!.summary.selectedCount > 0
    && !projection!.hasConflict
    && !snapshot.loading
    && !snapshot.refreshing
    && !snapshot.submitting
    && snapshot.submittingGroups.size === 0
    && !directoryLoading;

  useEffect(() => {
    if (!snapshot.inventory && !snapshot.loading && !snapshot.error) {
      void manager.load();
    }
  }, [manager, snapshot.error, snapshot.inventory, snapshot.loading]);

  useEffect(() => {
    if (!jobEvents) return;
    return jobEvents.subscribeTerminal((jobs) => {
      void manager.handleTerminalJobs(jobs);
    });
  }, [jobEvents, manager]);

  async function submit() {
    if (!canSubmit) return;
    const jobID = await manager.submit();
    if (jobID) onJobCreated(jobID);
  }

  async function submitGroup(groupPath: string) {
    const jobID = await manager.submitGroup(groupPath);
    if (!jobID) return;
    onGroupJobCreated(jobID);
    const terminalJob = jobEvents?.getSnapshot().jobs.find((job) => (
      job.id === jobID && terminalJobStatuses.has(job.status)
    ));
    if (terminalJob) await manager.handleTerminalJobs([terminalJob]);
  }

  return (
    <div
      data-testid="super-rename-content"
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-3"
      onKeyDown={(event) => confirmDialogOnEnter(event, canSubmit, () => void submit())}
    >
      <header className="flex shrink-0 items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <WandSparkles className="size-5 shrink-0 text-violet-600" />
            <h2 className="font-heading truncate text-base leading-none font-medium">{labels.superRename}</h2>
          </div>
          <p className="truncate text-xs text-muted-foreground" title={snapshot.directoryPath}>{snapshot.directoryPath}</p>
          <p className="text-sm text-muted-foreground">{labels.superRenameDescription}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={labels.refresh}
          disabled={snapshot.loading || snapshot.refreshing || snapshot.submitting || snapshot.submittingGroups.size > 0 || directoryLoading}
          onClick={() => void manager.refresh()}
        >
          <RefreshCw className={snapshot.refreshing ? "animate-spin" : undefined} />
          {labels.refresh}
        </Button>
      </header>

      {projection ? (
        <p className="shrink-0 text-xs text-muted-foreground">
          {labels.superRenameSummary(
            projection.summary.groupCount,
            projection.summary.selectedCount,
            projection.summary.unmatchedCount,
            projection.summary.conflictCount,
          )}
        </p>
      ) : null}
      <ErrorBanner message={snapshot.error} />
      {snapshot.confirmationRequired ? (
        <Alert className="shrink-0 border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/20">
          <CircleAlert />
          <AlertDescription>{labels.superRenameConfirmationRequired}</AlertDescription>
        </Alert>
      ) : null}

      {snapshot.loading ? (
        <div data-testid="super-rename-loading" className="grid min-h-0 flex-1 content-start gap-2 overflow-hidden rounded-lg border p-3">
          {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-8" />)}
        </div>
      ) : projection ? (
        projection.summary.groupCount > 0 ? (
          <SuperRenameTree
            projection={projection}
            directoryNodes={snapshot.directoryNodes}
            rootGroupPaths={snapshot.rootGroupPaths}
            expandedGroups={snapshot.expandedGroups}
            submittingGroups={snapshot.submittingGroups}
            disabled={snapshot.submitting || snapshot.refreshing}
            labels={labels}
            onItemSelected={(sourcePath, selected) => manager.setItemSelected(sourcePath, selected)}
            onGroupSelected={(groupPath, selected) => void manager.setGroupSelected(groupPath, selected)}
            onGroupExpanded={(groupPath, expanded) => void manager.setGroupExpanded(groupPath, expanded)}
            onGroupSubmit={(groupPath) => void submitGroup(groupPath)}
          />
        ) : (
          <div className="grid min-h-0 flex-1 place-items-center rounded-lg border text-sm text-muted-foreground">
            {labels.superRenameNoMatches}
          </div>
        )
      ) : (
        <div className="min-h-0 flex-1" />
      )}

      <footer className="flex shrink-0 justify-end gap-2 border-t pt-3">
        <Button
          type="button"
          variant="outline"
          disabled={snapshot.submitting || snapshot.submittingGroups.size > 0}
          onClick={onClose}
        >
          {labels.cancel}
        </Button>
        <Button type="button" disabled={!canSubmit} onClick={() => void submit()}>
          {snapshot.submitting ? <LoaderCircle className="animate-spin" /> : <WandSparkles />}
          {labels.superRenameExecute(projection?.summary.selectedCount ?? 0)}
        </Button>
      </footer>
    </div>
  );
}
