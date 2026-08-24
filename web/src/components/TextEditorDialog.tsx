import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CodeMirrorLoader } from "../codeMirrorLoader";
import type { UIStrings } from "../i18n";
import { strings } from "../i18n";
import type { TextEditorSession } from "../textEditorSession";
import { TextEditor } from "./TextEditor";

export function TextEditorDialog({
  session,
  labels = strings.en,
  loader,
  onSave,
  onClose,
}: {
  session: TextEditorSession;
  labels?: UIStrings;
  loader?: CodeMirrorLoader;
  onSave?(): void;
  onClose(): void;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="text-editor-dialog" aria-label={labels.textEditor}>
        <DialogHeader>
          <DialogTitle>{session.fileName}</DialogTitle>
        </DialogHeader>
        <div className="text-editor-dialog-body">
          <TextEditor session={session} labels={labels} loader={loader} onSave={onSave} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
