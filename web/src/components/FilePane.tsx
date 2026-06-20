import type { Entry, Root } from "../api/types";

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
  onRefresh(): void;
  onActivate(): void;
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
  onRefresh,
  onActivate,
}: FilePaneProps) {
  const crumbs = buildCrumbs(currentPath);
  return (
    <section className="file-pane" aria-label={title} onClick={onActivate}>
      <div className="pane-header">
        <strong>{title}</strong>
        <select
          aria-label={`${title} root`}
          value={selectedRootId}
          onChange={(event) => onRootChange(event.target.value)}
        >
          {roots.map((root) => (
            <option key={root.id} value={root.id}>
              {root.name}
            </option>
          ))}
        </select>
        <button type="button" aria-label={`${title} refresh`} onClick={onRefresh}>
          Refresh
        </button>
      </div>
      <div className="breadcrumbs" aria-label={`${title} path`}>
        {crumbs.map((crumb) => (
          <button key={crumb.path} type="button" onClick={() => onPathChange(crumb.path)}>
            {crumb.label}
          </button>
        ))}
      </div>
      <table className="file-table">
        <thead>
          <tr>
            <th>
              <button type="button" onClick={onClearSelection}>
                Clear
              </button>
            </th>
            <th>Name</th>
            <th>Type</th>
            <th>Size</th>
            <th>Modified</th>
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
                  aria-label={`Select ${entry.name}`}
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
    </section>
  );
}

function buildCrumbs(path: string) {
  const normalized = path && path !== "." ? path : ".";
  const crumbs = [{ label: "/", path: "." }];
  if (normalized === ".") return crumbs;
  const parts = normalized.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    crumbs.push({ label: part, path: current });
  }
  return crumbs;
}
