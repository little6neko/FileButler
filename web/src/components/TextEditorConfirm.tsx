import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UIStrings } from "../i18n";
import { strings } from "../i18n";
import { ErrorBanner } from "./ErrorBanner";

export type TextEditorConflictAction = "reload" | "overwrite";

export function TextEditorConfirm({
  titleId,
  fileName,
  labels = strings.en,
  busy,
  error = null,
  onCancel,
  onReload,
  onOverwrite,
}: {
  titleId: string;
  fileName: string;
  labels?: UIStrings;
  busy: TextEditorConflictAction | null;
  error?: string | null;
  onCancel(): void;
  onReload(): void;
  onOverwrite(): void;
}) {
  const disabled = busy !== null;
  return (
    <div className="contents">
      <header className="flex min-w-0 flex-col gap-2">
        <h2 id={titleId} className="font-heading text-base leading-none font-medium">{labels.editorConflictTitle}</h2>
        <p className="text-sm text-muted-foreground">{labels.editorConflictDescription(fileName)}</p>
      </header>
      <ErrorBanner message={error} />
      <footer className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancel} disabled={disabled}>{labels.cancel}</Button>
        <Button variant="outline" onClick={onReload} disabled={disabled}>
          {busy === "reload" ? <LoaderCircle className="animate-spin" /> : null}
          {labels.editorReload}
        </Button>
        <Button variant="destructive" onClick={onOverwrite} disabled={disabled}>
          {busy === "overwrite" ? <LoaderCircle className="animate-spin" /> : null}
          {labels.editorOverwrite}
        </Button>
      </footer>
    </div>
  );
}
