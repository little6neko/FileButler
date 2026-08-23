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

type ContentProps = Pick<Props, "name" | "url" | "kind">;

export function MediaPreviewContent({ name, url, kind }: ContentProps) {
  return (
    <div className="media-preview-content" data-testid="media-preview-content">
      {kind === "image" ? (
        <img src={url} alt={name} />
      ) : (
        <video src={url} controls aria-label={name} />
      )}
    </div>
  );
}

export function MediaPreview({ name, url, kind, onClose, labels = strings.en }: Props) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="sr-only">{labels.mediaPreview}</DialogTitle>
          <p className="text-base font-medium leading-none">{name}</p>
        </DialogHeader>
        <div className="media-preview-dialog-viewport">
          <MediaPreviewContent name={name} url={url} kind={kind} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
