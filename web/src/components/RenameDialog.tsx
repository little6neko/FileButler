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
  nameOnly: true,
  extensionOnly: false,
  fullName: false,
  excludeFiles: false,
  excludeFolders: false,
  excludeSubfolders: true,
  uppercase: false,
  lowercase: false,
  titlecase: false,
  capitalized: false,
  enumerateItems: false,
  randomizeItems: false,
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
          <h2>{labels.powerRename}</h2>
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
            {labels.useRegularExpressions}
          </label>
          <label>
            <input type="checkbox" checked={options.caseSensitive} onChange={(event) => update({ caseSensitive: event.target.checked })} />
            {labels.caseSensitive}
          </label>
          <label>
            <input type="checkbox" checked={options.matchAll} onChange={(event) => update({ matchAll: event.target.checked })} />
            {labels.matchAllOccurrences}
          </label>
          <fieldset>
            <legend>{labels.target}</legend>
            <label>
              <input
                type="checkbox"
                checked={options.nameOnly}
                onChange={(event) => setTargetMode("name", event.target.checked)}
              />
              {labels.nameOnly}
            </label>
            <label>
              <input
                type="checkbox"
                checked={options.extensionOnly}
                onChange={(event) => setTargetMode("extension", event.target.checked)}
              />
              {labels.extensionOnly}
            </label>
            <label>
              <input
                type="checkbox"
                checked={options.fullName}
                onChange={(event) => setTargetMode("both", event.target.checked)}
              />
              {labels.fullName}
            </label>
          </fieldset>
          <label>
            <input
              type="checkbox"
              checked={options.excludeFiles}
              onChange={(event) => update({ excludeFiles: event.target.checked, includeFiles: !event.target.checked })}
            />
            {labels.excludeFiles}
          </label>
          <label>
            <input
              type="checkbox"
              checked={options.excludeFolders}
              onChange={(event) => update({ excludeFolders: event.target.checked, includeDirs: !event.target.checked })}
            />
            {labels.excludeFolders}
          </label>
          <label>
            <input
              type="checkbox"
              checked={options.excludeSubfolders}
              onChange={(event) => update({ excludeSubfolders: event.target.checked, includeSubfolders: !event.target.checked })}
            />
            {labels.excludeSubfolders}
          </label>
          <fieldset>
            <legend>{labels.textTransform}</legend>
            <label>
              <input
                type="checkbox"
                checked={options.uppercase}
                onChange={(event) => setTransform("uppercase", event.target.checked)}
              />
              {labels.uppercase}
            </label>
            <label>
              <input
                type="checkbox"
                checked={options.lowercase}
                onChange={(event) => setTransform("lowercase", event.target.checked)}
              />
              {labels.lowercase}
            </label>
            <label>
              <input
                type="checkbox"
                checked={options.titlecase}
                onChange={(event) => setTransform("titlecase", event.target.checked)}
              />
              {labels.titlecase}
            </label>
            <label>
              <input
                type="checkbox"
                checked={options.capitalized}
                onChange={(event) => setTransform("capitalized", event.target.checked)}
              />
              {labels.capitalized}
            </label>
          </fieldset>
          <label>
            <input
              type="checkbox"
              checked={options.enumerateItems}
              onChange={(event) => update({ enumerateItems: event.target.checked, enumerate: event.target.checked })}
            />
            {labels.enumerateItems}
          </label>
          <label>
            <input type="checkbox" checked={options.randomizeItems} onChange={(event) => update({ randomizeItems: event.target.checked })} />
            {labels.randomizeItems}
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

  function setTargetMode(target: RenameOptions["target"], checked: boolean) {
    if (!checked) {
      update({ target: "name", nameOnly: true, extensionOnly: false, fullName: false });
      return;
    }
    update({
      target,
      nameOnly: target === "name",
      extensionOnly: target === "extension",
      fullName: target === "both",
    });
  }

  function setTransform(transform: "uppercase" | "lowercase" | "titlecase" | "capitalized", checked: boolean) {
    update({
      uppercase: checked && transform === "uppercase",
      lowercase: checked && transform === "lowercase",
      titlecase: checked && transform === "titlecase",
      capitalized: checked && transform === "capitalized",
    });
  }
}
