import type { MediaKind } from "../media";
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
    <div className="modal-backdrop">
      <section className="modal media-preview" aria-label={labels.mediaPreview}>
        <header className="modal-header">
          <h2>{name}</h2>
          <button type="button" onClick={onClose}>
            {labels.close}
          </button>
        </header>
        <div className="media-preview-content">
          {kind === "image" ? (
            <img src={url} alt={name} />
          ) : (
            <video src={url} controls aria-label={name} />
          )}
        </div>
      </section>
    </div>
  );
}
