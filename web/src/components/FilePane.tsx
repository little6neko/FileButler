import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Entry, Root } from "../api/types";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";

type FilePaneProps = {
  title: string;
  roots: Root[];
  selectedRootId: string;
  currentPath: string;
  entries: Entry[];
  selectedPaths: Set<string>;
  onRootChange(rootId: string): void;
  onPathChange(path: string): void;
  onToggleSelection(path: string): void;
  onClearSelection(): void;
  onSelectAll(checked: boolean): void;
  onRefresh(): void;
  onActivate(): void;
  labels?: UIStrings;
};

export function FilePane({
  title,
  roots,
  selectedRootId,
  currentPath,
  entries,
  selectedPaths,
  onRootChange,
  onPathChange,
  onToggleSelection,
  onClearSelection,
  onSelectAll,
  onRefresh,
  onActivate,
  labels = strings.en,
}: FilePaneProps) {
  const [pathDraft, setPathDraft] = useState(displayPath(currentPath));
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(-1);
  const allVisibleSelected = entries.length > 0 && entries.every((entry) => selectedPaths.has(entry.relativePath));
  const suggestions = useMemo(
    () =>
      entries
        .filter((entry) => entry.type === "directory")
        .filter((entry) => entry.relativePath.toLowerCase().startsWith(normalizeInput(pathDraft).toLowerCase()))
        .slice(0, 8),
    [entries, pathDraft],
  );

  useEffect(() => {
    setPathDraft(displayPath(currentPath));
    setHighlightedSuggestion(-1);
  }, [currentPath]);

  return (
    <section className="file-pane" aria-label={title} onClick={onActivate}>
      <div className="pane-header">
        <strong>{title}</strong>
        <select
          aria-label={labels.rootLabel(title)}
          value={selectedRootId}
          onChange={(event) => onRootChange(event.target.value)}
        >
          {roots.map((root) => (
            <option key={root.id} value={root.id}>
              {root.name}
            </option>
          ))}
        </select>
        <div className="path-combobox">
          <input
            aria-label={labels.pathLabel(title)}
            value={pathDraft}
            onChange={(event) => {
              setPathDraft(event.target.value);
              setHighlightedSuggestion(-1);
            }}
            onKeyDown={handlePathKeyDown}
            onFocus={() => setHighlightedSuggestion(-1)}
          />
          {suggestions.length > 0 && pathDraft !== displayPath(currentPath) ? (
            <div className="path-suggestions" role="listbox">
              {suggestions.map((entry, index) => (
                <button
                  key={entry.relativePath}
                  type="button"
                  role="option"
                  aria-selected={index === highlightedSuggestion}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onPathChange(entry.relativePath);
                  }}
                >
                  {entry.relativePath}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button type="button" aria-label={labels.refreshLabel(title)} onClick={onRefresh}>
          {labels.refresh}
        </button>
      </div>
      <div className="file-list">
        <table className="file-table">
          <thead>
            <tr>
              <th>
                <input
                  aria-label={labels.selectAllVisible}
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(event) => onSelectAll(event.target.checked)}
                />
                <button type="button" onClick={onClearSelection}>
                  {labels.clear}
                </button>
              </th>
              <th>{labels.name}</th>
              <th>{labels.type}</th>
              <th>{labels.size}</th>
              <th>{labels.modified}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.relativePath}
                onDoubleClick={() => {
                  if (entry.type === "directory") onPathChange(entry.relativePath);
                }}
              >
                <td>
                  <input
                    aria-label={labels.selectEntry(entry.name)}
                    type="checkbox"
                    checked={selectedPaths.has(entry.relativePath)}
                    onChange={() => onToggleSelection(entry.relativePath)}
                  />
                </td>
                <td>
                  <span>{entry.name}</span>
                  {entry.isSymlink && entry.symlinkTarget ? (
                    <small className="symlink-target">{" -> "}{entry.symlinkTarget}</small>
                  ) : null}
                </td>
                <td>{entry.type}</td>
                <td>{entry.size}</td>
                <td>{entry.modifiedUnix ? new Date(entry.modifiedUnix * 1000).toLocaleString() : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );

  function handlePathKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedSuggestion((current) => Math.min(current + 1, suggestions.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedSuggestion((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const selectedSuggestion = highlightedSuggestion >= 0 ? suggestions[highlightedSuggestion] : undefined;
      onPathChange(selectedSuggestion?.relativePath ?? normalizeInput(pathDraft));
    }
  }
}

function displayPath(path: string) {
  return path && path !== "." ? path : "/";
}

function normalizeInput(path: string) {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") return ".";
  return trimmed.replace(/^\/+/, "").replace(/\/+$/, "") || ".";
}
