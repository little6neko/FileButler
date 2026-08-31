import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { APIError, api, isLinkPreview } from "../api/client";
import type { LinkJobRequest, LinkPreview as LinkPreviewData, LinkPreviewItem, LinkRequest } from "../api/types";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";
import { confirmDialogOnEnter } from "./dialogConfirm";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  request: LinkRequest;
  onJobCreated(id: string): void;
  onClose(): void;
  labels?: UIStrings;
};

type ContentProps = {
  request: LinkRequest;
  titleId: string;
  descriptionId?: string;
  onSubmit(request: LinkJobRequest): Promise<void>;
  onClose(): void;
  labels?: UIStrings;
};

type PreviewResult = {
  requestKey: string;
  preview: LinkPreviewData | null;
  error: string | null;
};

export function LinkPreview({ request, onJobCreated, onClose, labels = strings.en }: Props) {
  const titleId = useId();
  const descriptionId = useId();

  async function submit(jobRequest: LinkJobRequest) {
    const job = await api.linkCreateJob(jobRequest);
    onJobCreated(job.id);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="flex max-h-[calc(100vh-2rem)] flex-col sm:max-w-4xl"
        showCloseButton={false}
      >
        <LinkPreviewContent
          request={request}
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

export function LinkPreviewContent({
  request,
  titleId,
  descriptionId,
  onSubmit,
  onClose,
  labels = strings.en,
}: ContentProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const generationRef = useRef(0);
  const submittingKeyRef = useRef<string | null>(null);
  const requestKey = JSON.stringify(request);
  const activeRequest = useMemo<LinkRequest>(() => JSON.parse(requestKey) as LinkRequest, [requestKey]);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [jobError, setJobError] = useState<{ requestKey: string; message: string } | null>(null);
  const [confirmationRequiredKey, setConfirmationRequiredKey] = useState<string | null>(null);
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);

  useEffect(() => {
    contentRef.current?.focus();
  }, []);

  useEffect(() => {
    const generation = ++generationRef.current;
    let disposed = false;
    api.linkPreview(activeRequest).then((preview) => {
      if (disposed || generation !== generationRef.current) return;
      setPreviewResult({ requestKey, preview, error: null });
    }).catch((error: unknown) => {
      if (disposed || generation !== generationRef.current) return;
      setPreviewResult({
        requestKey,
        preview: null,
        error: linkErrorMessage(error, labels, labels.previewFailed),
      });
    });
    return () => {
      disposed = true;
    };
  }, [activeRequest, labels, requestKey]);

  const currentResult = previewResult?.requestKey === requestKey ? previewResult : null;
  const preview = currentResult?.preview ?? null;
  const loading = currentResult === null;
  const conflictCount = preview?.items.filter((item) => item.conflict).length ?? 0;
  const submitting = submittingKey !== null;
  const jobErrorMessage = jobError?.requestKey === requestKey ? jobError.message : null;
  const confirmationRequired = confirmationRequiredKey === requestKey;
  const canConfirm = Boolean(preview) && !preview?.hasConflict && !currentResult?.error && !submitting;

  async function confirm() {
    if (!preview || !canConfirm || submittingKeyRef.current !== null) return;
    submittingKeyRef.current = requestKey;
    setSubmittingKey(requestKey);
    setJobError(null);
    setConfirmationRequiredKey(null);
    const submittingGeneration = generationRef.current;
    try {
      await onSubmit({ ...activeRequest, previewRevision: preview.previewRevision });
    } catch (error) {
      if (submittingGeneration !== generationRef.current) return;
      if (isRefreshConflict(error, activeRequest)) {
        setPreviewResult({ requestKey, preview: error.data, error: null });
        setConfirmationRequiredKey(requestKey);
      } else {
        setJobError({
          requestKey,
          message: linkErrorMessage(error, labels, labels.jobCreationFailed),
        });
      }
    } finally {
      if (submittingKeyRef.current === requestKey) {
        submittingKeyRef.current = null;
        setSubmittingKey(null);
      }
    }
  }

  return (
    <div
      ref={contentRef}
      tabIndex={-1}
      data-testid="link-preview-content"
      className="operation-preview-content flex min-h-0 min-w-0 flex-1 flex-col gap-4 outline-none"
      onKeyDown={(event) => confirmDialogOnEnter(event, canConfirm, () => void confirm())}
    >
      <header className="flex shrink-0 flex-col gap-2">
        <h2 id={titleId} className="font-heading text-base leading-none font-medium">
          {labels.linkPreviewTitle(activeRequest.type)}
        </h2>
        <p id={descriptionId} className="text-sm text-muted-foreground">
          {labels.linkPreviewDescription(activeRequest.type, activeRequest.sources.length)}
        </p>
      </header>
      <ErrorBanner message={jobErrorMessage ?? currentResult?.error ?? null} />
      {confirmationRequired ? (
        <Alert className="shrink-0">
          <CircleAlert />
          <AlertDescription>{labels.linkConfirmationRequired}</AlertDescription>
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
        <div data-testid="link-preview-scroll" className="min-h-0 min-w-0 flex-1 overflow-auto rounded-md border">
          <Table containerClassName="overflow-visible" className="min-w-max">
            <TableHeader>
              <TableRow>
                <TableHead>{labels.source}</TableHead>
                <TableHead>{labels.destination}</TableHead>
                <TableHead>{labels.type}</TableHead>
                <TableHead>{labels.linkPlannedWork}</TableHead>
                <TableHead>{labels.status}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview?.items.map((item) => (
                <TableRow key={`${item.sourcePath}-${item.destPath}`}>
                  <TableCell>{rootPath(preview.sourceRoot, item.sourcePath)}</TableCell>
                  <TableCell>{rootPath(preview.destRoot, item.destPath)}</TableCell>
                  <TableCell>{labels.linkSourceKind(item.sourceKind)}</TableCell>
                  <TableCell>{plannedWork(item, labels)}</TableCell>
                  <TableCell className={item.conflict ? "text-destructive" : "text-emerald-700"}>
                    {item.conflict ? itemError(item, labels) : labels.ready}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <footer className="-mx-4 -mb-4 flex shrink-0 flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onClose}>{labels.cancel}</Button>
        <Button onClick={() => void confirm()} disabled={!canConfirm}>
          {submitting ? <LoaderCircle className="animate-spin" /> : null}
          {labels.linkCreate(activeRequest.type, activeRequest.sources.length)}
        </Button>
      </footer>
    </div>
  );
}

function isRefreshConflict(error: unknown, request: LinkRequest): error is APIError & { data: LinkPreviewData } {
  return error instanceof APIError
    && error.status === 409
    && (error.code === "stale_preview" || error.code === "plan_conflict")
    && isLinkPreview(error.data)
    && previewMatchesRequest(error.data, request);
}

function previewMatchesRequest(preview: LinkPreviewData, request: LinkRequest) {
  return preview.type === request.type
    && preview.sourceRoot === request.sourceRoot
    && preview.destRoot === request.destRoot
    && preview.destPath === request.destPath
    && preview.items.length === request.sources.length
    && preview.items.every((item, index) => item.sourcePath === request.sources[index]);
}

function linkErrorMessage(error: unknown, labels: UIStrings, fallback: string) {
  if (error instanceof APIError) {
    return labels.linkError(error.code) || error.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function plannedWork(item: LinkPreviewItem, labels: UIStrings) {
  return labels.linkCounts(item.counts.directories, item.counts.files, item.counts.symlinks) || "—";
}

function itemError(item: LinkPreviewItem, labels: UIStrings) {
  return (item.errorCode ? labels.linkError(item.errorCode) : "") || item.errorText || labels.linkError("operation_failed");
}

function rootPath(root: string, path: string) {
  return `${root}:${path === "." || path === "" ? "/" : `/${path}`}`;
}
