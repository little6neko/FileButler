import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";
import { confirmDialogOnEnter } from "./dialogConfirm";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  labels?: UIStrings;
  onClose(): void;
  onSubmit(name: string): Promise<void>;
};

export function MkdirDialog({ labels = strings.en, onClose, onSubmit }: Props) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = !submitting && name.trim().length > 0;

  async function submit() {
    const nextName = name.trim();
    if (!nextName || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(nextName);
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.jobCreationFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        onKeyDown={(event) => confirmDialogOnEnter(event, canSubmit, () => void submit())}
      >
        <DialogHeader>
          <DialogTitle>{labels.directoryNamePrompt}</DialogTitle>
        </DialogHeader>
        <ErrorBanner message={error} />
        <div className="grid gap-2">
          <Label htmlFor="mkdir-name">{labels.directoryNamePrompt}</Label>
          <Input
            id="mkdir-name"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            disabled={submitting}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>{labels.cancel}</Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting ? <LoaderCircle className="animate-spin" /> : null}
            {labels.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
