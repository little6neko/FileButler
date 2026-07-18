import { useEffect, useState } from "react";
import { CircleAlert, LoaderCircle, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "../api/client";
import type { OpsRequest, PlanItem } from "../api/types";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  request: OpsRequest;
  onJobCreated(id: string): void;
  onClose(): void;
  labels?: UIStrings;
};

export function OperationPreview({ request, onJobCreated, onClose, labels = strings.en }: Props) {
  const [items, setItems] = useState<PlanItem[]>([]);
  const [hasConflict, setHasConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [previewedRequest, setPreviewedRequest] = useState<OpsRequest | null>(null);

  useEffect(() => {
    let active = true;
    api
      .opsDryRun(request)
      .then((plan) => {
        if (!active) return;
        setItems(plan.items);
        setHasConflict(plan.hasConflict);
        setError(null);
        setPreviewedRequest(request);
      })
      .catch((err) => {
        if (!active) return;
        setPreviewedRequest(null);
        setError(err instanceof Error ? err.message : labels.previewFailed);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [labels.previewFailed, request]);

  async function confirm() {
    setSubmitting(true);
    setError(null);
    try {
      const job = await api.opsCreateJob(request);
      onJobCreated(job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.jobCreationFailed);
    } finally {
      setSubmitting(false);
    }
  }

  const conflictCount = items.filter((item) => item.conflict).length;
  const itemCount = request.type === "mkdir" ? 1 : request.sources.length;
  const destructive = request.type === "delete";

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="sm:max-w-3xl"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{labels.operationPreview(request.type)}</DialogTitle>
          <DialogDescription>{labels.operationDescription(request.type, itemCount)}</DialogDescription>
        </DialogHeader>
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
                  <TableHead>{labels.source}</TableHead>
                  <TableHead>{labels.destination}</TableHead>
                  <TableHead>{labels.status}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={`${item.sourcePath}-${item.destPath ?? item.targetPath ?? ""}`}>
                    <TableCell>{displaySource(item, request)}</TableCell>
                    <TableCell>{displayDestination(item, request)}</TableCell>
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
            disabled={previewedRequest !== request || hasConflict || loading || submitting}
          >
            {submitting ? <LoaderCircle className="animate-spin" /> : null}
            {labels.confirmOperation(request.type, itemCount)}
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
