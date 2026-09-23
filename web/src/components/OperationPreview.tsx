import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CircleAlert, LoaderCircle, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { operationClient, transferWarning } from "../operationClient";
import type { OpsRequest, PlanItem } from "../api/types";
import type { DragOperation } from "../fileDrag";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";
import { confirmDialogOnEnter } from "./dialogConfirm";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  request: OpsRequest;
  operationChoices?: readonly DragOperation[];
  onJobCreated(id: string, request: OpsRequest): void;
  onClose(): void;
  labels?: UIStrings;
};

type ContentProps = {
  request: OpsRequest;
  operationChoices?: readonly DragOperation[];
  titleId: string;
  descriptionId?: string;
  onSubmit(request: OpsRequest, previewToken?: string): Promise<void>;
  onClose(): void;
  labels?: UIStrings;
};

type PreviewResult = {
  previewToken?: string;
  request: OpsRequest;
  items: PlanItem[];
  hasConflict: boolean;
  error: string | null;
};

export function OperationPreview({ request, operationChoices, onJobCreated, onClose, labels = strings.en }: Props) {
  const titleId = useId();
  const descriptionId = useId();

  async function submit(activeRequest: OpsRequest, previewToken?: string) {
    const job = await operationClient.create(activeRequest, previewToken);
    onJobCreated(job.id, activeRequest);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="flex max-h-[calc(100vh-2rem)] flex-col sm:max-w-3xl"
        showCloseButton={false}
      >
        <OperationPreviewContent
          request={request}
          operationChoices={operationChoices}
          titleId={titleId}
          descriptionId={descriptionId}
          labels={labels}
          onSubmit={submit}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

export function OperationPreviewContent({
  request,
  operationChoices,
  titleId,
  descriptionId,
  onSubmit,
  onClose,
  labels = strings.en,
}: ContentProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [selectedType, setSelectedType] = useState<OpsRequest["type"]>(request.type);
  const activeRequest = useMemo(
    () => (selectedType === request.type ? request : { ...request, type: selectedType }),
    [request, selectedType],
  );
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    contentRef.current?.focus();
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    operationClient
      .preview(activeRequest, controller.signal)
      .then((plan) => {
        if (!active) return;
        setPreviewResult({
          request: activeRequest,
          previewToken: plan.previewToken,
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
      controller.abort();
    };
  }, [activeRequest, labels.previewFailed]);

  async function confirm() {
    if (submitting) return;
    setSubmitting(true);
    setJobError(null);
    try {
      await onSubmit(activeRequest, previewResult?.previewToken);
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
    <div
      ref={contentRef}
      tabIndex={-1}
      data-testid="operation-preview-content"
      className="operation-preview-content flex min-h-0 min-w-0 flex-1 flex-col gap-4 outline-none"
      onKeyDown={(event) => confirmDialogOnEnter(event, canConfirm, () => void confirm())}
    >
      <header className="flex shrink-0 flex-col gap-2">
        <h2 id={titleId} className="font-heading text-base leading-none font-medium">{labels.operationPreview(activeRequest.type)}</h2>
        <p id={descriptionId} className="text-sm text-muted-foreground">{labels.operationDescription(activeRequest.type, itemCount)}</p>
      </header>
      {operationChoices?.length ? (
        <div className="operation-type-switch shrink-0" role="radiogroup" aria-label={labels.operationMode}>
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
      {transferWarning(activeRequest) ? <Alert variant="destructive" className="shrink-0"><TriangleAlert /><AlertDescription>{transferWarning(activeRequest)}</AlertDescription></Alert> : null}
      {destructive ? (
        <Alert variant="destructive" className="shrink-0">
          <TriangleAlert />
          <AlertDescription>{labels.deleteWarning}</AlertDescription>
        </Alert>
      ) : null}
      {conflictCount ? (
        <Alert className="shrink-0">
          <CircleAlert />
          <AlertDescription>{labels.conflictsFound(conflictCount)}</AlertDescription>
        </Alert>
      ) : null}
      {loading ? (
        <div className="grid min-h-0 flex-1 gap-2 overflow-hidden">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-7" />)}
        </div>
      ) : (
        <div data-testid="operation-preview-scroll" className="min-h-0 min-w-0 flex-1 overflow-auto rounded-md border">
          <Table containerClassName="overflow-visible" className="min-w-max">
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
      <footer className="-mx-4 -mb-4 flex shrink-0 flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onClose}>{labels.cancel}</Button>
        <Button
          variant={destructive ? "destructive" : "default"}
          onClick={confirm}
          disabled={!canConfirm}
        >
          {submitting ? <LoaderCircle className="animate-spin" /> : null}
          {labels.confirmOperation(activeRequest.type, itemCount)}
        </Button>
      </footer>
    </div>
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
