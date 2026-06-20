import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { OpsRequest, PlanItem } from "../api/types";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  request: OpsRequest;
  onJobCreated(id: string): void;
  onClose(): void;
};

export function OperationPreview({ request, onJobCreated, onClose }: Props) {
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
      .catch((err) => setError(err instanceof Error ? err.message : "Preview failed"))
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
      setError(err instanceof Error ? err.message : "Job creation failed");
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal" aria-label="Operation preview">
        <header className="modal-header">
          <h2>{request.type} preview</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <ErrorBanner message={error} />
        {loading ? <p>Loading</p> : null}
        <table className="preview-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Destination</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.sourcePath}-${item.destPath ?? item.targetPath ?? ""}`}>
                <td>{item.sourcePath}</td>
                <td>{item.destPath ?? item.targetPath ?? ""}</td>
                <td>{item.conflict ? item.errorText || item.errorCode : "Ready"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <footer className="modal-actions">
          <button type="button" onClick={confirm} disabled={hasConflict || loading}>
            Confirm
          </button>
        </footer>
      </section>
    </div>
  );
}
