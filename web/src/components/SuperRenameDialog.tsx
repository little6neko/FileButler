import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { strings, type UIStrings } from "../i18n";
import { SuperRenameManager } from "../superRenameManager";
import { SuperRenameContent } from "./SuperRenameContent";

type SuperRenameDialogProps = {
  rootId: string;
  directoryPath: string;
  onJobCreated(id: string): void;
  onGroupJobCreated(id: string): void;
  onClose(): void;
  labels?: UIStrings;
};

export function SuperRenameDialog({
  rootId,
  directoryPath,
  onJobCreated,
  onGroupJobCreated,
  onClose,
  labels = strings.en,
}: SuperRenameDialogProps) {
  const [manager] = useState(() => new SuperRenameManager(rootId, directoryPath));
  const snapshot = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);

  useEffect(() => () => manager.destroy(), [manager]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !snapshot.submitting && snapshot.submittingGroups.size === 0) onClose();
      }}
    >
      <DialogContent
        className="flex h-[min(860px,92vh)] flex-col sm:max-w-[min(1400px,96vw)]"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{labels.superRename}</DialogTitle>
          <DialogDescription>{labels.superRenameDescription}</DialogDescription>
        </DialogHeader>
        <SuperRenameContent
          manager={manager}
          labels={labels}
          onClose={onClose}
          onJobCreated={onJobCreated}
          onGroupJobCreated={onGroupJobCreated}
        />
      </DialogContent>
    </Dialog>
  );
}
