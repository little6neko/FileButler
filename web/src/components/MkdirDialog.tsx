import { useState } from "react";
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
    <div className="modal-backdrop">
      <section className="modal single-rename-dialog" aria-label={labels.directoryNamePrompt}>
        <header className="modal-header">
          <h2>{labels.mkdir}</h2>
          <button type="button" onClick={onClose}>
            {labels.close}
          </button>
        </header>
        <label className="single-rename-field">
          {labels.directoryNamePrompt}
          <input
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
        </label>
        <footer className="modal-actions">
          <button type="button" onClick={onClose}>
            {labels.cancel}
          </button>
          <button type="button" onClick={submit} disabled={!canSubmit}>
            {labels.confirm}
          </button>
        </footer>
      </section>
    </div>
  );
}
