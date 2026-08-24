import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { ReactNode } from "react";
import type { UIStrings } from "../i18n";
import { strings } from "../i18n";
import { ErrorBanner } from "./ErrorBanner";

export type TextEditorConflictAction = "reload" | "overwrite";

type CommonProps = {
  titleId: string;
  fileName: string;
  labels?: UIStrings;
  error?: string | null;
  onCancel(): void;
};

type ConflictProps = CommonProps & {
  kind: "conflict";
  busy: TextEditorConflictAction | null;
  onReload(): void;
  onOverwrite(): void;
};

type UnsavedProps = CommonProps & {
  kind: "unsaved";
  busy: boolean;
  onSave(): void;
  onDiscard(): void;
};

export function TextEditorConfirm(props: ConflictProps | UnsavedProps) {
  const labels = props.labels ?? strings.en;
  if (props.kind === "unsaved") {
    return (
      <div className="contents">
        <header className="flex min-w-0 flex-col gap-2">
          <h2 id={props.titleId} className="font-heading text-base leading-none font-medium">{labels.editorUnsavedTitle}</h2>
          <p className="text-sm text-muted-foreground">{labels.editorUnsavedDescription(props.fileName)}</p>
        </header>
        <ErrorBanner message={props.error ?? null} />
        <footer className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={props.onCancel} disabled={props.busy}>{labels.cancel}</Button>
          <Button variant="outline" onClick={props.onDiscard} disabled={props.busy}>{labels.discardChanges}</Button>
          <Button onClick={props.onSave} disabled={props.busy}>
            {props.busy ? <LoaderCircle className="animate-spin" /> : null}
            {labels.save}
          </Button>
        </footer>
      </div>
    );
  }

  const disabled = props.busy !== null;
  return (
    <div className="contents">
      <header className="flex min-w-0 flex-col gap-2">
        <h2 id={props.titleId} className="font-heading text-base leading-none font-medium">{labels.editorConflictTitle}</h2>
        <p className="text-sm text-muted-foreground">{labels.editorConflictDescription(props.fileName)}</p>
      </header>
      <ErrorBanner message={props.error ?? null} />
      <footer className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={props.onCancel} disabled={disabled}>{labels.cancel}</Button>
        <Button variant="outline" onClick={props.onReload} disabled={disabled}>
          {props.busy === "reload" ? <LoaderCircle className="animate-spin" /> : null}
          {labels.editorReload}
        </Button>
        <Button variant="destructive" onClick={props.onOverwrite} disabled={disabled}>
          {props.busy === "overwrite" ? <LoaderCircle className="animate-spin" /> : null}
          {labels.editorOverwrite}
        </Button>
      </footer>
    </div>
  );
}

export function TextEditorPageConfirm({
  titleId,
  busy,
  onClose,
  children,
}: {
  titleId: string;
  busy: boolean;
  onClose(): void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent aria-labelledby={titleId} className="sm:max-w-md" showCloseButton={false}>
        {children}
      </DialogContent>
    </Dialog>
  );
}
