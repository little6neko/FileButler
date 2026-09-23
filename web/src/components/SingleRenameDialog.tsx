import { useId, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "../api/client";
import type { Entry } from "../api/types";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";
import { confirmDialogOnEnter } from "./dialogConfirm";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  rootId: string;
  path: string;
  initialName: string;
  entryType: Entry["type"];
  onJobCreated(id: string): void;
  onClose(): void;
  labels?: UIStrings;
};

export function SingleRenameDialog({ rootId, path, initialName, entryType, onJobCreated, onClose, labels = strings.en }: Props) {
  const titleId = useId();

  async function submit(newName: string) {
    const job = await api.singleRenameCreateJob({ rootId, paths: [path], newName });
    onJobCreated(job.id);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent aria-label={labels.renameDialog} className="sm:max-w-md" showCloseButton={false}>
        <SingleRenameContent
          titleId={titleId}
          initialName={initialName}
          entryType={entryType}
          onSubmit={submit}
          onClose={onClose}
          labels={labels}
        />
      </DialogContent>
    </Dialog>
  );
}

export function SingleRenameContent({
  titleId,
  initialName,
  entryType,
  onSubmit,
  onClose,
  labels = strings.en,
}: {
  titleId: string;
  initialName: string;
  entryType: Entry["type"];
  onSubmit(newName: string): Promise<void>;
  onClose(): void;
  labels?: UIStrings;
}) {
  const [newName, setNewName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const initialSelectionApplied = useRef(false);
  const inputId = useId();
  const canSubmit = !submitting && newName.trim().length > 0;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(newName);
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.renameFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="contents" onKeyDown={(event) => confirmDialogOnEnter(event, canSubmit, () => void submit())}>
      <header className="flex flex-col gap-2">
        <h2 id={titleId} className="text-base font-medium leading-none">{labels.rename}</h2>
      </header>
      <ErrorBanner message={error} />
      <div className="grid min-w-0 gap-2">
        <Label htmlFor={inputId}>{labels.newName}</Label>
        <Input
          id={inputId}
          className="min-w-0"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onFocus={(event) => {
            if (initialSelectionApplied.current) return;
            initialSelectionApplied.current = true;
            event.currentTarget.setSelectionRange(0, initialSelectionEnd(initialName, entryType));
          }}
          autoFocus
          disabled={submitting}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={submitting}>{labels.cancel}</Button>
        <Button onClick={submit} disabled={!canSubmit}>
          {submitting ? <LoaderCircle className="animate-spin" /> : null}
          {labels.rename}
        </Button>
      </DialogFooter>
    </div>
  );
}

function initialSelectionEnd(name: string, entryType: Entry["type"]) {
  if (entryType === "directory") return name.length;
  const extensionSeparator = name.lastIndexOf(".");
  return extensionSeparator > 0 && extensionSeparator < name.length - 1
    ? extensionSeparator
    : name.length;
}
