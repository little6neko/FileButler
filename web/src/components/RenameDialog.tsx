import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { PlanItem, RenameOptions } from "../api/types";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  rootId: string;
  paths: string[];
  onJobCreated(id: string): void;
  onClose(): void;
  labels?: UIStrings;
};

const defaultOptions: RenameOptions = {
  search: "",
  replace: "",
  useRegex: false,
  caseSensitive: false,
  matchAll: true,
  target: "name",
  includeFiles: true,
  includeDirs: true,
  includeSubfolders: false,
  enumerate: false,
};

export function RenameDialog({ rootId, paths, onJobCreated, onClose, labels = strings.en }: Props) {
  const [options, setOptions] = useState<RenameOptions>(defaultOptions);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [hasConflict, setHasConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .renamePreview({ rootId, paths, options })
      .then((plan) => {
        if (!active) return;
        setItems(plan.items);
        setHasConflict(plan.hasConflict);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : labels.previewFailed));
    return () => {
      active = false;
    };
  }, [rootId, paths, options]);

  async function run() {
    try {
      const job = await api.renameCreateJob({ rootId, paths, options });
      onJobCreated(job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.renameFailed);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal rename-dialog" aria-label={labels.renameDialog}>
        <header className="modal-header">
          <h2>{labels.batchRename}</h2>
          <button type="button" onClick={onClose}>
            {labels.close}
          </button>
        </header>
        <ErrorBanner message={error} />
        <div className="rename-controls">
          <label>
            {labels.search}
            <input value={options.search} onChange={(event) => update({ search: event.target.value })} />
          </label>
          <label>
            {labels.replace}
            <input value={options.replace} onChange={(event) => update({ replace: event.target.value })} />
          </label>
          <label>
            <input type="checkbox" checked={options.useRegex} onChange={(event) => update({ useRegex: event.target.checked })} />
            {labels.regex}
          </label>
          <label>
            <input type="checkbox" checked={options.caseSensitive} onChange={(event) => update({ caseSensitive: event.target.checked })} />
            {labels.caseSensitive}
          </label>
          <label>
            <input type="checkbox" checked={options.matchAll} onChange={(event) => update({ matchAll: event.target.checked })} />
            {labels.matchAll}
          </label>
          <fieldset>
            <legend>{labels.target}</legend>
            {(["name", "extension", "both"] as const).map((target) => (
              <label key={target}>
                <input type="radio" name="target" checked={options.target === target} onChange={() => update({ target })} />
                {targetLabel(target, labels)}
              </label>
            ))}
          </fieldset>
          <label>
            <input type="checkbox" checked={options.includeFiles} onChange={(event) => update({ includeFiles: event.target.checked })} />
            {labels.includeFiles}
          </label>
          <label>
            <input type="checkbox" checked={options.includeDirs} onChange={(event) => update({ includeDirs: event.target.checked })} />
            {labels.includeFolders}
          </label>
          <label>
            <input type="checkbox" checked={options.includeSubfolders} onChange={(event) => update({ includeSubfolders: event.target.checked })} />
            {labels.includeSubfolders}
          </label>
          <label>
            <input type="checkbox" checked={options.enumerate} onChange={(event) => update({ enumerate: event.target.checked })} />
            {labels.enumerate}
          </label>
        </div>
        <table className="preview-table">
          <thead>
            <tr>
              <th>{labels.source}</th>
              <th>{labels.old}</th>
              <th>{labels.new}</th>
              <th>{labels.status}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.sourcePath}>
                <td>{item.sourcePath}</td>
                <td>{item.oldName}</td>
                <td>{item.newName}</td>
                <td>{item.conflict ? item.errorText || item.errorCode : labels.ready}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <footer className="modal-actions">
          <button type="button" onClick={run} disabled={hasConflict}>
            {labels.runRename}
          </button>
        </footer>
      </section>
    </div>
  );

  function update(partial: Partial<RenameOptions>) {
    setOptions((current) => ({ ...current, ...partial }));
  }
}

function targetLabel(target: RenameOptions["target"], labels: UIStrings) {
  if (target === "name") return labels.targetName;
  if (target === "extension") return labels.targetExtension;
  return labels.targetBoth;
}
