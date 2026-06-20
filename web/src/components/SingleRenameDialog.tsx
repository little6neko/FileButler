import { useState } from "react";
import { api } from "../api/client";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  rootId: string;
  path: string;
  initialName: string;
  onJobCreated(id: string): void;
  onClose(): void;
  labels?: UIStrings;
};

export function SingleRenameDialog({ rootId, path, initialName, onJobCreated, onClose, labels = strings.en }: Props) {
  const [newName, setNewName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const job = await api.singleRenameCreateJob({ rootId, paths: [path], newName });
      onJobCreated(job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.renameFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal single-rename-dialog" aria-label={labels.renameDialog}>
        <header className="modal-header">
          <h2>{labels.rename}</h2>
          <button type="button" onClick={onClose}>
            {labels.close}
          </button>
        </header>
        <ErrorBanner message={error} />
        <label className="single-rename-field">
          {labels.newName}
          <input value={newName} onChange={(event) => setNewName(event.target.value)} autoFocus />
        </label>
        <footer className="modal-actions">
          <button type="button" onClick={submit} disabled={submitting || !newName.trim()}>
            {labels.rename}
          </button>
        </footer>
      </section>
    </div>
  );
}
