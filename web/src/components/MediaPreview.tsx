import type { MediaKind } from "../media";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";

type Props = {
  name: string;
  url: string;
  kind: MediaKind;
  onClose(): void;
  labels?: UIStrings;
} & NavigationProps;

type NavigationProps = {
  mediaKey?: string;
  canPrevious?: boolean;
  canNext?: boolean;
  previousLabel?: string;
  nextLabel?: string;
  onPrevious?(): void;
  onNext?(): void;
};

type ContentProps = Pick<Props, "name" | "url" | "kind"> & NavigationProps;

export function MediaPreviewContent({
  name,
  url,
  kind,
  mediaKey = url,
  canPrevious = false,
  canNext = false,
  previousLabel = strings.en.previousMedia,
  nextLabel = strings.en.nextMedia,
  onPrevious,
  onNext,
}: ContentProps) {
  const showNavigation = Boolean(onPrevious && onNext);
  return (
    <div className="media-preview-content" data-testid="media-preview-content">
      {kind === "image" ? (
        <img key={mediaKey} src={url} alt={name} />
      ) : (
        <video key={mediaKey} src={url} controls aria-label={name} />
      )}
      {showNavigation ? (
        <>
          <button
            type="button"
            className="media-preview-navigation-button"
            data-direction="previous"
            aria-label={previousLabel}
            disabled={!canPrevious}
            onClick={onPrevious}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <button
            type="button"
            className="media-preview-navigation-button"
            data-direction="next"
            aria-label={nextLabel}
            disabled={!canNext}
            onClick={onNext}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </>
      ) : null}
    </div>
  );
}

export function MediaPreview({
  name,
  url,
  kind,
  onClose,
  labels = strings.en,
  mediaKey,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
}: Props) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="media-preview-dialog sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="sr-only">{labels.mediaPreview}</DialogTitle>
          <p className="text-base font-medium leading-none">{name}</p>
        </DialogHeader>
        <div className="media-preview-dialog-viewport">
          <MediaPreviewContent
            name={name}
            url={url}
            kind={kind}
            mediaKey={mediaKey}
            canPrevious={canPrevious}
            canNext={canNext}
            previousLabel={labels.previousMedia}
            nextLabel={labels.nextMedia}
            onPrevious={onPrevious}
            onNext={onNext}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
