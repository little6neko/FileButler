import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "../api/client";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  rootId: string;
  path: string;
  initialName: string;
  onJobCreated(id: string): void;
  onClose(): void;
  labels?: UIStrings;
};

export function SingleRenameDialog({ rootId, path, initialName, onJobCreated, onClose, labels = strings.en }: Props) {
  const [newName, setNewName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const job = await api.singleRenameCreateJob({ rootId, paths: [path], newName });
      onJobCreated(job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.renameFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="sr-only">{labels.renameDialog}</DialogTitle>
          <p className="text-base font-medium leading-none">{labels.rename}</p>
        </DialogHeader>
        <ErrorBanner message={error} />
        <div className="grid gap-2">
          <Label htmlFor="single-rename-name">{labels.newName}</Label>
          <Input
            id="single-rename-name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{labels.cancel}</Button>
          <Button onClick={submit} disabled={submitting || !newName.trim()}>
            {submitting ? <LoaderCircle className="animate-spin" /> : null}
            {labels.rename}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
