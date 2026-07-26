import { useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, LoaderCircle, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "../api/client";
import type { OpsRequest, PlanItem } from "../api/types";
import type { DragOperation } from "../fileDrag";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";
import { confirmDialogOnEnter } from "./dialogConfirm";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  request: OpsRequest;
  operationChoices?: readonly DragOperation[];
  onJobCreated(id: string): void;
  onClose(): void;
  labels?: UIStrings;
};

type PreviewResult = {
  request: OpsRequest;
  items: PlanItem[];
  hasConflict: boolean;
  error: string | null;
};

export function OperationPreview({ request, operationChoices, onJobCreated, onClose, labels = strings.en }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [selectedType, setSelectedType] = useState<OpsRequest["type"]>(request.type);
  const activeRequest = useMemo(
    () => (selectedType === request.type ? request : { ...request, type: selectedType }),
    [request, selectedType],
  );
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .opsDryRun(activeRequest)
      .then((plan) => {
        if (!active) return;
        setPreviewResult({
          request: activeRequest,
          items: plan.items,
          hasConflict: plan.hasConflict,
          error: null,
        });
      })
      .catch((err) => {
        if (!active) return;
        setPreviewResult({
          request: activeRequest,
          items: [],
          hasConflict: false,
          error: err instanceof Error ? err.message : labels.previewFailed,
        });
      });
    return () => {
      active = false;
    };
  }, [activeRequest, labels.previewFailed]);

  async function confirm() {
    setSubmitting(true);
    setJobError(null);
    try {
      const job = await api.opsCreateJob(activeRequest);
      onJobCreated(job.id);
    } catch (err) {
      setJobError(err instanceof Error ? err.message : labels.jobCreationFailed);
    } finally {
      setSubmitting(false);
    }
  }

  const currentPreview = previewResult?.request === activeRequest ? previewResult : null;
  const items = currentPreview?.items ?? [];
  const hasConflict = currentPreview?.hasConflict ?? false;
  const loading = currentPreview === null;
  const error = jobError ?? currentPreview?.error ?? null;
  const canConfirm = Boolean(currentPreview) && !currentPreview?.error && !hasConflict && !submitting;
  const conflictCount = items.filter((item) => item.conflict).length;
  const itemCount = activeRequest.type === "mkdir" ? 1 : activeRequest.sources.length;
  const destructive = activeRequest.type === "delete";
  const showSourceColumn = activeRequest.type !== "mkdir";
  const showDestinationColumn = activeRequest.type !== "delete";

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        ref={dialogRef}
        initialFocus={dialogRef}
        className="sm:max-w-3xl"
        showCloseButton={false}
        onKeyDown={(event) => confirmDialogOnEnter(event, canConfirm, () => void confirm())}
      >
        <DialogHeader>
          <DialogTitle>{labels.operationPreview(activeRequest.type)}</DialogTitle>
          <DialogDescription>{labels.operationDescription(activeRequest.type, itemCount)}</DialogDescription>
        </DialogHeader>
        {operationChoices?.length ? (
          <div className="operation-type-switch" role="radiogroup" aria-label={labels.operationMode}>
            {operationChoices.map((type) => (
              <Button
                key={type}
                type="button"
                size="sm"
                variant="ghost"
                role="radio"
                aria-checked={activeRequest.type === type}
                data-active={activeRequest.type === type ? "true" : "false"}
                onClick={() => {
                  setJobError(null);
                  setSelectedType(type);
                }}
                disabled={submitting}
              >
                {labels.operationType(type)}
              </Button>
            ))}
          </div>
        ) : null}
        <ErrorBanner message={error} />
        {destructive ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>{labels.deleteWarning}</AlertDescription>
          </Alert>
        ) : null}
        {conflictCount ? (
          <Alert>
            <CircleAlert />
            <AlertDescription>{labels.conflictsFound(conflictCount)}</AlertDescription>
          </Alert>
        ) : null}
        {loading ? (
          <div className="grid gap-2">
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-7" />)}
          </div>
        ) : (
          <div className="max-h-[420px] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {showSourceColumn ? <TableHead>{labels.source}</TableHead> : null}
                  {showDestinationColumn ? <TableHead>{labels.destination}</TableHead> : null}
                  <TableHead>{labels.status}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={`${item.sourcePath}-${item.destPath ?? item.targetPath ?? ""}`}>
                    {showSourceColumn ? <TableCell>{displaySource(item, activeRequest)}</TableCell> : null}
                    {showDestinationColumn ? <TableCell>{displayDestination(item, activeRequest)}</TableCell> : null}
                    <TableCell className={item.conflict ? "text-destructive" : "text-emerald-700"}>
                      {item.conflict ? item.errorText || item.errorCode : labels.ready}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{labels.cancel}</Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={confirm}
            disabled={!canConfirm}
          >
            {submitting ? <LoaderCircle className="animate-spin" /> : null}
            {labels.confirmOperation(activeRequest.type, itemCount)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function displaySource(item: PlanItem, request: OpsRequest) {
  if (!item.sourcePath) return "";
  const root = item.sourceRoot ?? request.sourceRoot;
  return root ? `${root}:${displayPath(item.sourcePath)}` : item.sourcePath;
}

function displayDestination(item: PlanItem, request: OpsRequest) {
  const path = item.destPath ?? item.targetPath;
  if (!path) return "";
  const root = item.destRoot ?? request.destRoot;
  if (!root) return path;
  return `${root}:${displayPath(path)}`;
}

function displayPath(path: string) {
  if (path === "." || path === "") return "/";
  return path.startsWith("/") ? path : `/${path}`;
}
