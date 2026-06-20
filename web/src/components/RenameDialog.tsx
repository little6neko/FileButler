import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { PlanItem, RenameOptions } from "../api/types";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  rootId: string;
  paths: string[];
  onJobCreated(id: string): void;
  onClose(): void;
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

export function RenameDialog({ rootId, paths, onJobCreated, onClose }: Props) {
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
      .catch((err) => setError(err instanceof Error ? err.message : "Preview failed"));
    return () => {
      active = false;
    };
  }, [rootId, paths, options]);

  async function run() {
    try {
      const job = await api.renameCreateJob({ rootId, paths, options });
      onJobCreated(job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed");
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal rename-dialog" aria-label="Rename dialog">
        <header className="modal-header">
          <h2>Batch rename</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <ErrorBanner message={error} />
        <div className="rename-controls">
          <label>
            Search
            <input value={options.search} onChange={(event) => update({ search: event.target.value })} />
          </label>
          <label>
            Replace
            <input value={options.replace} onChange={(event) => update({ replace: event.target.value })} />
          </label>
          <label>
            <input type="checkbox" checked={options.useRegex} onChange={(event) => update({ useRegex: event.target.checked })} />
            Regex
          </label>
          <label>
            <input type="checkbox" checked={options.caseSensitive} onChange={(event) => update({ caseSensitive: event.target.checked })} />
            Case-sensitive
          </label>
          <label>
            <input type="checkbox" checked={options.matchAll} onChange={(event) => update({ matchAll: event.target.checked })} />
            Match all
          </label>
          <fieldset>
            <legend>Target</legend>
            {(["name", "extension", "both"] as const).map((target) => (
              <label key={target}>
                <input type="radio" name="target" checked={options.target === target} onChange={() => update({ target })} />
                {target}
              </label>
            ))}
          </fieldset>
          <label>
            <input type="checkbox" checked={options.includeFiles} onChange={(event) => update({ includeFiles: event.target.checked })} />
            Include files
          </label>
          <label>
            <input type="checkbox" checked={options.includeDirs} onChange={(event) => update({ includeDirs: event.target.checked })} />
            Include folders
          </label>
          <label>
            <input type="checkbox" checked={options.includeSubfolders} onChange={(event) => update({ includeSubfolders: event.target.checked })} />
            Include subfolders
          </label>
          <label>
            <input type="checkbox" checked={options.enumerate} onChange={(event) => update({ enumerate: event.target.checked })} />
            Enumerate
          </label>
        </div>
        <table className="preview-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Old</th>
              <th>New</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.sourcePath}>
                <td>{item.sourcePath}</td>
                <td>{item.oldName}</td>
                <td>{item.newName}</td>
                <td>{item.conflict ? item.errorText || item.errorCode : "Ready"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <footer className="modal-actions">
          <button type="button" onClick={run} disabled={hasConflict}>
            Run rename
          </button>
        </footer>
      </section>
    </div>
  );

  function update(partial: Partial<RenameOptions>) {
    setOptions((current) => ({ ...current, ...partial }));
  }
}
