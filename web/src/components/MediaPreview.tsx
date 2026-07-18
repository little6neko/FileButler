import type { MediaKind } from "../media";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";

type Props = {
  name: string;
  url: string;
  kind: MediaKind;
  onClose(): void;
  labels?: UIStrings;
};

export function MediaPreview({ name, url, kind, onClose, labels = strings.en }: Props) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="sr-only">{labels.mediaPreview}</DialogTitle>
          <p className="text-base font-medium leading-none">{name}</p>
        </DialogHeader>
        <div className="grid max-h-[78vh] place-items-center overflow-auto rounded-md bg-slate-950/5 p-2">
          {kind === "image" ? (
            <img src={url} alt={name} className="max-h-[74vh] max-w-full object-contain" />
          ) : (
            <video src={url} controls aria-label={name} className="max-h-[74vh] max-w-full" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
