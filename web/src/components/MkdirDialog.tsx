import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";

type Props = {
  labels?: UIStrings;
  onClose(): void;
  onSubmit(name: string): void;
};

export function MkdirDialog({ labels = strings.en, onClose, onSubmit }: Props) {
  const [name, setName] = useState("");
  const canSubmit = name.trim().length > 0;

  function submit() {
    const nextName = name.trim();
    if (!nextName) return;
    onSubmit(nextName);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{labels.directoryNamePrompt}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="mkdir-name">{labels.directoryNamePrompt}</Label>
          <Input
            id="mkdir-name"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{labels.cancel}</Button>
          <Button onClick={submit} disabled={!canSubmit}>{labels.confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
