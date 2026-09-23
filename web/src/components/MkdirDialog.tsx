import { useId, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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

type ContentProps = Props & {
  titleId: string;
  onSubmittingChange?(submitting: boolean): void;
};

export function MkdirDialog({ labels = strings.en, onClose, onSubmit }: Props) {
  const titleId = useId();
  const [submitting, setSubmitting] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DialogContent
        aria-labelledby={titleId}
        className="sm:max-w-md"
        showCloseButton={false}
      >
        <MkdirContent
          titleId={titleId}
          labels={labels}
          onClose={onClose}
          onSubmit={onSubmit}
          onSubmittingChange={setSubmitting}
        />
      </DialogContent>
    </Dialog>
  );
}

export function MkdirContent({
  titleId,
  labels = strings.en,
  onClose,
  onSubmit,
  onSubmittingChange,
}: ContentProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputId = useId();
  const canSubmit = !submitting && name.trim().length > 0;

  async function submit() {
    const nextName = name.trim();
    if (!nextName || submitting) return;
    setSubmitting(true);
    onSubmittingChange?.(true);
    setError(null);
    try {
      await onSubmit(nextName);
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.jobCreationFailed);
    } finally {
      setSubmitting(false);
      onSubmittingChange?.(false);
    }
  }

  return (
    <div className="contents" onKeyDown={(event) => confirmDialogOnEnter(event, canSubmit, () => void submit())}>
      <header className="flex flex-col gap-2">
        <h2 id={titleId} className="font-heading text-base leading-none font-medium">{labels.mkdir}</h2>
      </header>
      <ErrorBanner message={error} />
      <div className="grid min-w-0 gap-2">
        <Label htmlFor={inputId}>{labels.directoryNamePrompt}</Label>
        <Input
          id={inputId}
          className="min-w-0"
          value={name}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          disabled={submitting}
        />
      </div>
      <footer className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onClose} disabled={submitting}>{labels.cancel}</Button>
        <Button onClick={submit} disabled={!canSubmit}>
          {submitting ? <LoaderCircle className="animate-spin" /> : null}
          {labels.confirm}
        </Button>
      </footer>
    </div>
  );
}
