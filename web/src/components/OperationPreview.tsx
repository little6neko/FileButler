import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { OpsRequest, PlanItem } from "../api/types";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  request: OpsRequest;
  onJobCreated(id: string): void;
  onClose(): void;
  labels?: UIStrings;
};

export function OperationPreview({ request, onJobCreated, onClose, labels = strings.en }: Props) {
  const [items, setItems] = useState<PlanItem[]>([]);
  const [hasConflict, setHasConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .opsDryRun(request)
      .then((plan) => {
        if (!active) return;
        setItems(plan.items);
        setHasConflict(plan.hasConflict);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : labels.previewFailed))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [request]);

  async function confirm() {
    try {
      const job = await api.opsCreateJob(request);
      onJobCreated(job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.jobCreationFailed);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal" aria-label={labels.operationPreview(request.type)}>
        <header className="modal-header">
          <h2>{labels.operationPreview(request.type)}</h2>
          <button type="button" onClick={onClose}>
            {labels.close}
          </button>
        </header>
        <ErrorBanner message={error} />
        {loading ? <p>{labels.loading}</p> : null}
        <table className="preview-table">
          <thead>
            <tr>
              <th>{labels.source}</th>
              <th>{labels.destination}</th>
              <th>{labels.status}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.sourcePath}-${item.destPath ?? item.targetPath ?? ""}`}>
                <td>{displaySource(item, request)}</td>
                <td>{displayDestination(item, request)}</td>
                <td>{item.conflict ? item.errorText || item.errorCode : labels.ready}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <footer className="modal-actions">
          <button type="button" onClick={confirm} disabled={hasConflict || loading}>
            {labels.confirm}
          </button>
        </footer>
      </section>
    </div>
  );
}

function displaySource(item: PlanItem, request: OpsRequest) {
  if (!item.sourcePath) return "";
  const root = item.sourceRoot ?? request.sourceRoot;
  return root ? `${root}:${displayPath(item.sourcePath)}` : item.sourcePath;
}

function displayDestination(item: PlanItem, request: OpsRequest) {
  const path = item.destPath ?? item.targetPath;
  if (!path) return "";
  const root = item.destRoot ?? request.destRoot;
  if (!root) return path;
  return `${root}:${displayPath(path)}`;
}

function displayPath(path: string) {
  if (path === "." || path === "") return "/";
  return path.startsWith("/") ? path : `/${path}`;
}
